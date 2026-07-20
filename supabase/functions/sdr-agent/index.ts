// Unified SDR Agent — runs in shadow mode by default.
// Given a lead + last inbound message, gathers context, decides via tool-calling loop,
// and produces a proposed response/action plan. In shadow mode, nothing is sent or enqueued.
//
// Body: { lead_id, conversation_id?, trigger?: "inbound"|"cron"|"manual", mode?: "shadow"|"live" }

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  chatCompletion,
  createEmbedding,
  type ChatMessage,
  type ToolDef,
} from "../_shared/ai-gateway.ts";
import { extractDateRangeFromText } from "../_shared/date-range.ts";
import { formatBRTLong } from "../_shared/datetime.ts";
import { buildNativeHistory } from "../_shared/history-builder.ts";
import {
  buildIdempotencyKey,
  claimCalendarAction,
  markCalendarActionFailed,
  markCalendarActionOk,
} from "../_shared/idempotency.ts";
import { assertCanBook } from "../_shared/booking-guards.ts";
import { computeState, renderStateBlock, type StructuredState } from "../_shared/state-machine.ts";
import { classifyIntent } from "../_shared/intent-classifier.ts";
import { extractEntities } from "../_shared/entity-extractor.ts";
import { decidePolicy, renderPolicyBlock, type Tool as PolicyTool } from "../_shared/policy-engine.ts";

// Parse a slot_start ISO string. If no timezone offset is present, assume BRT (America/Sao_Paulo, UTC-3).
// Returns epoch ms.
function parseSlotStartAsBrt(s: string): number {
  if (!s) return NaN;
  const trimmed = s.trim();
  // Has explicit TZ: ends with Z or +HH:MM / -HH:MM (after the time part)
  const hasTz = /Z$/i.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed);
  if (hasTz) return Date.parse(trimmed);
  // Naive datetime → treat as BRT (UTC-3): append offset and parse
  return Date.parse(trimmed + "-03:00");
}

// Normalize a naive (no-TZ) slot_start to an ISO with -03:00 offset for downstream APIs (Cal.com).
function normalizeSlotStartIsoBrt(s: string): string {
  if (!s) return s;
  const trimmed = s.trim();
  const hasTz = /Z$/i.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed);
  if (hasTz) return trimmed;
  return trimmed + "-03:00";
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MODEL = "google/gemini-2.5-pro";
const MAX_STEPS = 8;
const HISTORY_LIMIT = 120; // ~3-5 turnos completos por conversa longa

// ────────────────────────────────────────────────────────────────
// Tool definitions exposed to the model
// ────────────────────────────────────────────────────────────────
const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "Busca semântica na base de conhecimento da empresa. Use SEMPRE antes de afirmar qualquer fato sobre produto, preço, processo, prazo, diferenciais, FAQs, política.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Pergunta ou termo de busca" },
          top_k: { type: "integer", default: 5, minimum: 1, maximum: 10 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_calendar",
      description:
        "Lista horários disponíveis no calendário (Cal.com). Respeita a janela de preferência do lead. " +
        "Se o lead já pediu uma faixa (ex: 'daqui a 10 dias', 'semana que vem', 'depois do dia 25'), " +
        "PASSE essa faixa em start_after/end_before mesmo que ela tenha sido mencionada em turno anterior.",
      parameters: {
        type: "object",
        properties: {
          start_after: {
            type: "string",
            description: "ISO datetime — só sugerir slots a partir desta data (inclusive). Ex: '2026-06-22T00:00:00Z'.",
          },
          end_before: {
            type: "string",
            description: "ISO datetime — só sugerir slots antes desta data.",
          },
          exclude_datetimes: {
            type: "array",
            items: { type: "string" },
            description: "Slots já oferecidos anteriormente que devem ser excluídos.",
          },
          exclude_dates: {
            type: "array",
            items: { type: "string" },
            description: "Datas (YYYY-MM-DD) inteiras a evitar (ex: o lead já rejeitou esses dias).",
          },
          days_ahead: {
            type: "integer",
            description: "Atalho: janela default em dias a partir de agora (use só se não souber faixa específica).",
            minimum: 1,
            maximum: 60,
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_lead_facts",
      description:
        "Persiste novos fatos descobertos sobre o lead (objeções, papel, urgência, preferência de canal/horário/data, interesses, restrições). " +
        "Use SEMPRE que detectar uma preferência nova que deva valer nos próximos turnos.",
      parameters: {
        type: "object",
        properties: {
          facts: {
            type: "object",
            description:
              "Objeto livre com as chaves a mesclar em lead_memory.facts. " +
              "Convenção: para janela de datas use { date_preference: { start_after?: ISO, end_before?: ISO, raw: 'daqui a 10 dias' } }; " +
              "para canal use { preferred_channel: 'whatsapp'|'email' }; " +
              "para objeções use { objections: ['preço', 'time pequeno'] }.",
          },
        },
        required: ["facts"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_knowledge",
      description:
        "Lista todos os itens da base de conhecimento da empresa (título, tipo, id e snippet). Use quando search_knowledge não retornar nada útil ou para descobrir o que existe na KB antes de buscar/ler.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_knowledge_item",
      description:
        "Lê o conteúdo COMPLETO de um item da KB pelo id (ou pelo título exato). Use depois de list_knowledge quando precisar do conteúdo inteiro de um documento (ex.: cases, ROI, comparativos).",
      parameters: {
        type: "object",
        properties: {
          knowledge_id: { type: "string", description: "UUID do item em company_knowledge" },
          title: { type: "string", description: "Título exato do item (alternativa ao id)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_slot",
      description:
        "Confirma um agendamento (PRIMEIRA reserva) num horário JÁ OFERECIDO pelo SDR e EXPLICITAMENTE escolhido pelo lead no turno atual. " +
        "PROIBIDO chamar sem confirmação clara do lead. " +
        "Retorna { ok, booking_uid, scheduled_at, message_suggestion } em sucesso, ou { ok:false, downgrade, suggested_message } se a guarda recusar — nesse caso, finalize com send_message usando suggested_message.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          slot_start: {
            type: "string",
            description: "ISO datetime do slot escolhido pelo lead. Deve coincidir EXATAMENTE com um dos slots oferecidos.",
          },
          channel: { type: "string", enum: ["whatsapp", "email"] },
        },
        required: ["slot_start"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reschedule_booking",
      description:
        "Remarca uma reserva ATIVA para um novo horário JÁ OFERECIDO pelo SDR e EXPLICITAMENTE escolhido pelo lead. " +
        "Mesma guarda de confirmação de book_slot.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          slot_start: { type: "string", description: "ISO datetime do novo horário escolhido." },
          booking_uid: { type: "string", description: "UID Cal.com. Se omitido, usa a reserva ativa do lead." },
          reason: { type: "string" },
        },
        required: ["slot_start"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description:
        "Cancela uma reserva ativa quando o lead pede para desmarcar SEM pedir novo horário. Não exige slot. Após ok:true, o retorno traz `next_action` (`offer_slots` | `ask_reschedule` | `none`) — siga-o no mesmo turno para manter o controle da conversa (reoferecer 2 horários ou perguntar quando reagendar).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          booking_uid: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finalize",
      description:
        "Encerra o raciocínio e devolve a decisão final: mensagem a enviar, ação (encaminhar/escalar) ou silêncio. " +
        "Para agendamentos use as tools book_slot/reschedule_booking/cancel_booking ANTES e finalize com send_message contendo a confirmação.",
      parameters: {
        type: "object",
        properties: {
          decision: {
            type: "string",
            enum: [
              "send_message",
              "schedule_followup",
              "escalate_to_human",
              "silence",
              "mark_referral",
              "offer_slots",
            ],
          },
          channel: {
            type: "string",
            enum: ["whatsapp", "email"],
            description: "Canal de envio se decision=send_message ou offer_slots",
          },
          message: { type: "string", description: "Texto a enviar (se aplicável)" },
          offered_slots: {
            type: "array",
            items: { type: "string" },
            description: "Slots ISO a oferecer (se decision=offer_slots)",
          },
          followup_at: { type: "string", description: "ISO datetime para próximo follow-up (se aplicável)" },
          referrer_lead_id: { type: "string", description: "Lead que indicou (se mark_referral)" },
          rationale: {
            type: "string",
            description:
              "Explicação curta do raciocínio, citando explicitamente quais preferências do lead foram respeitadas.",
          },
        },
        required: ["decision", "rationale"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_new_contact",
      description:
        "Cria um novo lead a partir de uma indicação recebida na conversa atual. " +
        "Use SOMENTE quando o lead atual indicou outra pessoa e forneceu pelo menos email OU telefone. " +
        "O novo lead entra automaticamente no pipeline de enriquecimento/cadência.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Nome do indicado (se conhecido). NÃO use email como nome." },
          email: { type: "string" },
          phone: { type: "string" },
          role: { type: "string", description: "Cargo do indicado, se mencionado." },
          company_name: { type: "string", description: "Empresa do indicado, se diferente da empresa do lead atual." },
          website: { type: "string", description: "Site da empresa do indicado, se mencionado." },
          context: { type: "string", description: "Contexto curto: por que o lead atual indicou esta pessoa." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_referrer",
      description:
        "Marca o lead da conversa atual como INDICANTE (referral_stage='is_referrer'). " +
        "Use logo após create_new_contact. Inclui permission_to_mention se o lead autorizou citar o nome dele.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          permission_to_mention: { type: "boolean", default: true },
        },
      },
    },
  },
];


  

// ────────────────────────────────────────────────────────────────
// Tool executors
// ────────────────────────────────────────────────────────────────
async function execTool(
  name: string,
  args: Record<string, unknown>,
  ctx: { lead_id: string; company_id: string; conversation_id?: string | null; mode?: "shadow" | "live" },
): Promise<unknown> {

  if (name === "search_knowledge") {
    const query = String(args.query ?? "");
    const topK = Number(args.top_k ?? 5);
    if (!query) return { error: "query required" };
    const emb = await createEmbedding({ input: query });
    const vec = emb.data[0].embedding;
    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      p_company_id: ctx.company_id,
      p_query_embedding: `[${vec.join(",")}]`,
      p_match_count: topK,
    });
    if (error) return { error: error.message };
    return {
      matches: (data ?? []).map((d: { chunk: string; metadata: Record<string, unknown>; similarity: number }) => ({
        chunk: d.chunk,
        title: (d.metadata as { title?: string })?.title,
        similarity: Number(d.similarity?.toFixed?.(3) ?? d.similarity),
      })),
    };
  }

  if (name === "check_calendar") {
    // Guard: se acabamos de receber o e-mail que pedimos, o slot JÁ está
    // acordado — não buscar novos horários, ir direto pra book_slot.
    {
      const resolved = (ctx as any).pending_email_resolved as
        | { slot_iso?: string }
        | undefined;
      if (resolved?.slot_iso) {
        return {
          ok: false,
          downgrade: "book_now",
          reason: "slot já acordado; lead acabou de fornecer e-mail — reservar direto",
          next_action: `Chame book_slot({ slot_start: "${resolved.slot_iso}" }) imediatamente.`,
        };
      }
    }
    // Slots no passado (ou nos próximos ~30min) são inúteis para oferecer.
    const MIN_LEAD_MS = 30 * 60 * 1000;
    const earliestAllowed = new Date(Date.now() + MIN_LEAD_MS);
    const filterFutureSlots = (slots: any[]): any[] => {
      return (slots || []).filter((s: any) => {
        const iso = typeof s === "string"
          ? s
          : (s?.start ?? s?.slot ?? s?.datetime ?? s?.slot_datetime ?? null);
        if (!iso) return true;
        const ts = parseSlotStartAsBrt(String(iso));
        return !isNaN(ts) && ts >= earliestAllowed.getTime();
      });
    };

    const fetchSlots = async (b: Record<string, unknown>): Promise<{ slots: any[]; raw: any; httpError: boolean }> => {
      const { data, error } = await supabase.functions.invoke("calcom-slots", { body: b });
      if (error) {
        return { slots: [], raw: { error: String(error) }, httpError: true };
      }
      const slots = filterFutureSlots((data as any)?.slots ?? []);
      const raw = { ...(data ?? {}), slots };
      return { slots, raw, httpError: false };
    };

    try {
      const body: Record<string, unknown> = {
        company_id: ctx.company_id,
        lead_id: ctx.lead_id,
        conversation_id: ctx.conversation_id ?? undefined,
      };
      // Hard floor: nunca pedir slots que comecem no passado ou nos próximos 30min.
      const startAfterArg = typeof args.start_after === "string" ? args.start_after : null;
      const startAfterTs = startAfterArg ? Date.parse(startAfterArg) : NaN;
      body.start_after = (!isNaN(startAfterTs) && startAfterTs > earliestAllowed.getTime())
        ? startAfterArg!
        : earliestAllowed.toISOString();
      if (typeof args.end_before === "string") body.end_before = args.end_before;
      if (Array.isArray(args.exclude_datetimes)) body.exclude_datetimes = args.exclude_datetimes;
      if (Array.isArray(args.exclude_dates)) body.exclude_dates = args.exclude_dates;
      if (typeof args.days_ahead === "number" && !body.end_before) {
        body.end_before = new Date(Date.now() + Number(args.days_ahead) * 86400000).toISOString();
      }
      const requestedWindow = { start_after: body.start_after ?? null, end_before: body.end_before ?? null };
      const first = await fetchSlots(body);

      const hasWindow = !!body.end_before;
      if (first.slots.length === 0 && hasWindow) {
        const widenFrom = new Date(String(body.end_before));
        const widenTo = new Date(widenFrom.getTime() + 14 * 86400000);
        const widenBody: Record<string, unknown> = {
          company_id: ctx.company_id,
          lead_id: ctx.lead_id,
          conversation_id: ctx.conversation_id ?? undefined,
          start_after: widenFrom.toISOString(),
          end_before: widenTo.toISOString(),
        };
        if (Array.isArray(args.exclude_datetimes)) widenBody.exclude_datetimes = args.exclude_datetimes;
        if (Array.isArray(args.exclude_dates)) widenBody.exclude_dates = args.exclude_dates;
        const widen = await fetchSlots(widenBody);
        const nextAvailable = widen.slots.slice(0, 2);
        return {
          slots: nextAvailable,
          slots_in_window: [],
          next_available: nextAvailable,
          requested_window: requestedWindow,
          reason: nextAvailable.length > 0 ? "no_slots_in_window" : "no_availability",
        };
      }

      if (first.httpError) return { error: String((first.raw as any)?.error ?? "calcom-slots failed") };
      return first.raw;
    } catch (e) {
      return { error: String(e) };
    }
  }

  if (name === "update_lead_facts") {
    // Chaves "managed-by-system" — a LLM NÃO pode escrever/zerar. O pipeline
    // determinístico em sdr-agent é o dono. Se a LLM tentar, ignoramos.
    const PROTECTED_FACT_KEYS = new Set([
      "referral_pending_name",
    ]);
    const incoming = (args.facts ?? {}) as Record<string, unknown>;
    const facts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (PROTECTED_FACT_KEYS.has(k)) continue;
      facts[k] = v;
    }
    const { data: existing } = await supabase
      .from("lead_memory")
      .select("facts")
      .eq("lead_id", ctx.lead_id)
      .maybeSingle();
    const merged = { ...(existing?.facts ?? {}), ...facts };

    await supabase.from("lead_memory").upsert(
      {
        lead_id: ctx.lead_id,
        company_id: ctx.company_id,
        facts: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" },
    );
    // Side effect: se o agente extraiu um whatsapp/phone novo do lead, persiste na coluna do lead
    // (para que a cadência consiga enviar via WhatsApp dali em diante).
    const leadPatch: Record<string, unknown> = {};
    const wpp = typeof facts.whatsapp === "string" ? (facts.whatsapp as string).trim() : null;
    const phn = typeof facts.phone === "string" ? (facts.phone as string).trim() : null;
    if (wpp) { leadPatch.whatsapp = wpp; leadPatch.whatsapp_valid = true; }
    if (phn) { leadPatch.phone = phn; }
    if (Object.keys(leadPatch).length > 0) {
      await supabase.from("leads").update(leadPatch as any).eq("id", ctx.lead_id);
    }
    return { ok: true, facts: merged };
  }

  if (name === "list_knowledge") {
    const { data, error } = await supabase
      .from("company_knowledge")
      .select("id, title, type, content")
      .eq("company_id", ctx.company_id)
      .limit(50);
    if (error) return { error: error.message };
    return {
      items: (data ?? []).map((d: { id: string; title: string; type: string; content: string }) => ({
        id: d.id,
        title: d.title,
        type: d.type,
        snippet: (d.content ?? "").slice(0, 300),
      })),
    };
  }

  if (name === "read_knowledge_item") {
    const id = typeof args.knowledge_id === "string" ? args.knowledge_id : null;
    const title = typeof args.title === "string" ? args.title : null;
    if (!id && !title) return { error: "knowledge_id or title required" };
    let q = supabase
      .from("company_knowledge")
      .select("id, title, type, content")
      .eq("company_id", ctx.company_id)
      .limit(1);
    if (id) q = q.eq("id", id);
    else if (title) q = q.eq("title", title);
    const { data, error } = await q.maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "not found" };
    return data;
  }

  if (name === "book_slot" || name === "reschedule_booking" || name === "cancel_booking") {
    return await execBookingTool(name, args, ctx);
  }

  if (name === "create_new_contact" || name === "mark_referrer") {
    if (ctx.mode === "shadow") {
      return { ok: true, simulated: true, shadow: true, tool: name, args };
    }
    const action_type = name === "create_new_contact" ? "create_new_contact" : "mark_current_contact_as_referrer";
    const { data, error } = await supabase.functions.invoke("execute-action", {
      body: {
        company_id: ctx.company_id,
        lead_id: ctx.lead_id,
        conversation_id: ctx.conversation_id ?? null,
        action_type,
        params: args,
      },
    });
    if (error) return { ok: false, error: String(error) };
    return { ok: true, ...((data as any)?.result ?? data ?? {}) };
  }

  if (name === "finalize") {
    return { ok: true, decision: args };
  }


  return { error: `unknown tool: ${name}` };
}


// ────────────────────────────────────────────────────────────────
// Post-actions runner (deterministic side-effects after policy decision)
// ────────────────────────────────────────────────────────────────
async function runPostActions(
  policy: any,
  args: {
    lead_id: string;
    ctx: { lead: { company_id: string } };
    conversation_id: string | null | undefined;
    mode?: "shadow" | "live";
    entities: any;
    steps: Array<Record<string, unknown>>;
  },
): Promise<{ failures: Array<{ action: string; error: string; user_message?: string }> }> {
  const failures: Array<{ action: string; error: string; user_message?: string }> = [];
  const { lead_id, ctx, conversation_id, mode, entities, steps } = args;
  const postActions = (policy as any).post_actions as string[] | undefined;
  if (!postActions || postActions.length === 0 || mode === "shadow") return { failures };
  for (const pa of postActions) {
    try {
      if (pa === "mark_referrer") {
        const permission = (entities as any)?.referral_contact?.permission_to_mention ?? true;
        const paRes = await execTool("mark_referrer", { permission_to_mention: permission }, {
          lead_id, company_id: ctx.lead.company_id, conversation_id: conversation_id ?? null, mode,
        });
        steps.push({ event: "post_action", action: pa, result: paRes });
      } else if (pa === "release_slot_holds") {
        const { data: rel, error: relErr } = await supabase
          .from("slot_holds")
          .update({ status: "released" })
          .eq("lead_id", lead_id)
          .eq("status", "held")
          .select("id");
        steps.push({ event: "post_action", action: pa, released: rel?.length ?? 0, error: relErr ? String(relErr) : null });
      } else if (pa === "cancel_active_booking") {
        const { data: activeBk } = await supabase
          .from("bookings")
          .select("calcom_booking_uid")
          .eq("lead_id", lead_id)
          .eq("status", "confirmed")
          .not("calcom_booking_uid", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (activeBk?.calcom_booking_uid) {
          await supabase.from("bookings").update({
            cancellation_source: "sdr",
            cancellation_requested_at: new Date().toISOString(),
          }).eq("calcom_booking_uid", activeBk.calcom_booking_uid);
          const { data: cxlData, error: cxlErr } = await supabase.functions.invoke("calcom-booking-cancel", {
            body: { booking_uid: activeBk.calcom_booking_uid, reason: "Lead redirecionou o contato para outra pessoa", lead_id },
          });
          steps.push({ event: "post_action", action: pa, booking_uid: activeBk.calcom_booking_uid, ok: !cxlErr, error: cxlErr ? String(cxlErr) : null, result: cxlData ?? null });
        } else {
          steps.push({ event: "post_action", action: pa, skipped: "no_active_booking" });
        }
      } else if (pa === "add_guests_to_active_booking") {
        // Estratégia: usar o endpoint nativo POST /v2/bookings/{uid}/guests
        // do Cal.com (via edge function `calcom-add-guests`). Sem cancelar,
        // sem recriar — o Cal.com atualiza o evento no Google Calendar e
        // dispara e-mail para os novos convidados.
        const requested = Array.isArray(policy?.forced_args?.guest_emails)
          ? (policy.forced_args.guest_emails as unknown[])
              .map((g) => String(g || "").trim().toLowerCase())
              .filter((g) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(g))
          : [];
        if (requested.length === 0) {
          steps.push({ event: "post_action", action: pa, skipped: "no_guests" });
          continue;
        }
        const { data: activeBk } = await supabase
          .from("bookings")
          .select("id, calcom_booking_uid, scheduled_at, conversation_id, company_id")
          .eq("lead_id", lead_id)
          .eq("status", "confirmed")
          .not("calcom_booking_uid", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!activeBk?.calcom_booking_uid) {
          steps.push({ event: "post_action", action: pa, skipped: "no_active_booking" });
          continue;
        }

        let addFail: string | null = null;
        let addData: any = null;
        try {
          const { data, error } = await supabase.functions.invoke("calcom-add-guests", {
            body: {
              booking_uid: activeBk.calcom_booking_uid,
              guests: requested,
              lead_id,
              conversation_id: conversation_id ?? null,
            },
          });
          if (error) {
            addFail = String(error);
          } else if ((data as any)?.error) {
            addFail = String((data as any).error);
          } else {
            addData = data;
          }
        } catch (e) {
          addFail = String(e);
        }

        if (addFail) {
          const userMsg = `Tive uma instabilidade ao incluir ${requested.join(", ")} no convite. Sua reunião segue confirmada como estava. Pode me reenviar o e-mail do convidado em alguns minutos? Vou tentar de novo.`;
          steps.push({
            event: "post_action",
            action: pa,
            stage: "add_guests_failed_no_op",
            error: addFail,
            note: "booking original intacto",
            user_message: userMsg,
          });
          failures.push({ action: pa, error: addFail, user_message: userMsg });
          continue;
        }

        steps.push({
          event: "post_action",
          action: pa,
          booking_uid: activeBk.calcom_booking_uid,
          added_guests: (addData as any)?.added_guests ?? requested,
          total_guests: (addData as any)?.total_guests ?? null,
          skipped: (addData as any)?.skipped ?? null,
        });
      }

    } catch (e) {
      steps.push({ event: "post_action", action: pa, error: String(e) });
      failures.push({ action: pa, error: String(e) });
    }
  }
  return { failures };
}

// ────────────────────────────────────────────────────────────────
// Context loader
// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// Booking tools (book_slot / reschedule_booking / cancel_booking)
// Executados DENTRO do loop de tools — não são mais ações pós-finalize.
// ────────────────────────────────────────────────────────────────
async function execBookingTool(
  name: "book_slot" | "reschedule_booking" | "cancel_booking",
  args: Record<string, unknown>,
  ctx: { lead_id: string; company_id: string; conversation_id?: string | null; mode?: "shadow" | "live" },
): Promise<Record<string, unknown>> {
  // SHADOW MODE: nunca executa ações reais no Cal.com nem grava calendar_actions/bookings.
  // Retorna preview sintético para o LLM seguir o fluxo (gerar finalize/mensagem) sem mutar estado.
  if (ctx.mode === "shadow") {
    const slotStart = typeof args.slot_start === "string" ? args.slot_start : null;
    const reason = typeof args.reason === "string" ? args.reason : null;
    const previewMsg = name === "cancel_booking"
      ? "[shadow] Cancelamento simulado — nada foi enviado ao Cal.com."
      : `[shadow] Reserva simulada para ${slotStart ?? "(slot)"} — nada foi enviado ao Cal.com.`;
    return {
      ok: true,
      simulated: true,
      shadow: true,
      booking_uid: "shadow",
      scheduled_at: slotStart,
      reason,
      message_suggestion: previewMsg,
    };
  }

  // Recarrega estado fresco (memória, holds, última inbound/outbound).
  const [{ data: memRow }, { data: holdsRaw }, { data: bookingsRaw }, { data: convs }] = await Promise.all([
    supabase.from("lead_memory").select("facts").eq("lead_id", ctx.lead_id).maybeSingle(),
    supabase.from("slot_holds").select("id, slot_datetime, status, expires_at").eq("lead_id", ctx.lead_id).eq("status", "held"),
    supabase.from("bookings").select("id, calcom_booking_uid, status, scheduled_at, updated_at").eq("lead_id", ctx.lead_id).in("status", ["confirmed", "pending", "rescheduled"]).order("updated_at", { ascending: false }).limit(5),
    supabase.from("conversations").select("id").eq("lead_id", ctx.lead_id),
  ]);
  const convIds = (convs ?? []).map((c: any) => c.id);
  let lastInbound = "";
  let lastOutbound = "";
  if (convIds.length > 0) {
    const { data: msgs } = await supabase.from("messages")
      .select("direction, content, sent_at").in("conversation_id", convIds)
      .order("sent_at", { ascending: false }).limit(20);
    for (const m of (msgs ?? [])) {
      if (!lastInbound && m.direction === "inbound") lastInbound = String(m.content || "");
      if (!lastOutbound && m.direction === "outbound") lastOutbound = String(m.content || "");
      if (lastInbound && lastOutbound) break;
    }
  }

  const facts = (memRow?.facts ?? {}) as Record<string, unknown>;
  const pendingEmailResolved = (ctx as any).pending_email_resolved as
    | { slot_iso?: string | null; hold_id?: string | null; email?: string | null }
    | undefined;
  const guardFacts = pendingEmailResolved?.slot_iso
    ? {
        ...facts,
        email_just_resolved_slot: {
          ...((facts as any).email_just_resolved_slot ?? {}),
          slot_iso: pendingEmailResolved.slot_iso,
          hold_id: pendingEmailResolved.hold_id ?? (facts as any).email_just_resolved_slot?.hold_id ?? null,
          email: pendingEmailResolved.email ?? (facts as any).email_just_resolved_slot?.email ?? null,
          expires_at: (facts as any).email_just_resolved_slot?.expires_at ?? new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
      }
    : facts;

  // ── Phase 4: centralized pre-flight guards ──────────────────────
  const guard = await assertCanBook(supabase, name, args, {
    facts: guardFacts,
    holds: (holdsRaw ?? []) as any,
    bookings: (bookingsRaw ?? []) as any,
    lastInbound,
    lastOutbound,
    isLikelyConfirmation,
    matchesSlotReference,
    implicitOfferFromOutbound,
    parseSlotStartAsBrt,
    formatBRTLong,
    lead_id: ctx.lead_id,
    company_id: ctx.company_id,
    conversation_id: ctx.conversation_id ?? null,
  });
  if (!guard.ok) {
    return {
      ok: false,
      error_code: guard.error_code,
      downgrade: guard.downgrade,
      reason: guard.hint,
      candidates: guard.candidates,
      suggested_message: guard.suggested_message,
      next_action: guard.next_action ?? "Chame finalize com decision=send_message e message=suggested_message.",
    };
  }

  // ── CANCEL ────────────────────────────────────────────────────
  // Idempotency is owned entirely by calcom-booking-cancel — claiming here too
  // caused a double-claim and a spurious 409 (in_flight).
  if (name === "cancel_booking") {
    const bookingUid = (typeof args.booking_uid === "string" && args.booking_uid) || guard.activeBookingUid;
    if (!bookingUid) return { ok: false, error: "no active booking" };
    const reason = typeof args.reason === "string" ? args.reason : "Cliente solicitou cancelamento";
    const idempotency_key = await buildIdempotencyKey({
      conversation_id: ctx.conversation_id, lead_id: ctx.lead_id,
      action_type: "cancel", provider_booking_uid: bookingUid,
    });
    try {
      await supabase.from("bookings").update({
        cancellation_source: "sdr",
        cancellation_requested_at: new Date().toISOString(),
      }).eq("calcom_booking_uid", bookingUid);
    } catch (_) {}

    const fnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/calcom-booking-cancel`;
    const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callCancel = async () => {
      let data: any = null;
      let httpStatus = 0;
      let networkErr: any = null;
      try {
        const res = await fetch(fnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${srk}`, apikey: srk },
          body: JSON.stringify({ booking_uid: bookingUid, reason, idempotency_key, lead_id: ctx.lead_id, conversation_id: ctx.conversation_id }),
        });
        httpStatus = res.status;
        const txt = await res.text();
        try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
      } catch (e) {
        networkErr = e;
      }
      return { data, httpStatus, networkErr };
    };

    // Up to 3 attempts; if we get in_flight (409 with success=false from our own
    // claim), back off and retry — the previous run is finishing.
    let last = await callCancel();
    for (let attempt = 2; attempt <= 3; attempt++) {
      const inFlight = last.httpStatus === 409 && last.data && last.data.in_flight === true;
      const hardFail = !inFlight && (last.networkErr || (last.data && last.data.success === false) || (last.httpStatus >= 500));
      if (!inFlight && !hardFail) break;
      console.log(`[sdr-agent] cancel_booking attempt ${attempt - 1} (http=${last.httpStatus}, in_flight=${!!inFlight}):`, JSON.stringify({ body: last.data, err: last.networkErr ? String(last.networkErr) : null }));
      await new Promise((r) => setTimeout(r, 800 * attempt));
      last = await callCancel();
    }

    const { data, httpStatus, networkErr } = last;
    const ok = !networkErr && httpStatus >= 200 && httpStatus < 300 && data && data.success !== false;
    if (ok) {
      // Heurística: o lead desistiu de vez? Então não reoferecer.
      const GIVEUP = /\b(n[ãa]o\s+(quero|tenho\s+interesse|vou\s+(?:querer|seguir))|desisti|perdi\s+o\s+interesse|n[ãa]o\s+faz\s+sentido|cancela\s+tudo|n[ãa]o\s+precisa\s+remarcar)\b/i;
      // Heurística: lead pediu adiamento indefinido? Pergunta aberta.
      const DEFER = /\b(depois\s+te\s+(aviso|falo|chamo|retorno)|semana\s+que\s+vem\s+te\s+(aviso|falo)|preciso\s+ver\s+(minha\s+)?agenda|te\s+retorno|qualquer\s+coisa\s+(eu\s+)?(te\s+)?aviso|mais\s+pra\s+frente)\b/i;
      const inb = String(lastInbound || "");
      let nextAction: "none" | "ask_reschedule" | "offer_slots" = "offer_slots";
      let suggestion = "Pronto, desmarquei nossa reunião. Quer que eu já te envie 2 novos horários ou prefere me dizer qual dia fica melhor pra você?";
      if (GIVEUP.test(inb)) {
        nextAction = "none";
        suggestion = "Tudo bem, cancelei nossa reunião. Se mudar de ideia ou quiser retomar mais pra frente, é só me chamar.";
      } else if (DEFER.test(inb)) {
        nextAction = "ask_reschedule";
        suggestion = "Tranquilo, desmarquei. Quando puder, me diz um dia que fique bom pra você — ou se preferir, eu já te mando 2 opções pra semana que vem.";
      }
      return {
        ok: true,
        booking_uid: bookingUid,
        next_action: nextAction,
        message_suggestion: suggestion,
        followup_hint: nextAction === "offer_slots"
          ? "Você DEVE no mesmo turno chamar `check_calendar` para gerar 2 novos horários e oferecê-los via finalize(offer_slots), OU enviar a `message_suggestion` que já contém pergunta de reagendamento. Nunca encerre sem reabrir o agendamento."
          : nextAction === "ask_reschedule"
            ? "Use a `message_suggestion` no finalize(send_message). NÃO ofereça slots agora — o lead pediu pra avisar depois."
            : "Lead desistiu — confirme o cancelamento sem reoferecer e considere escalate_to_human/mark_lost se a política exigir.",
      };
    }

    // Still in_flight after retries → internal lock, NOT a Cal.com failure.
    if (httpStatus === 409 && data && data.in_flight === true) {
      console.error("[sdr-agent] cancel_booking still in_flight after retries:", JSON.stringify(data));
      return {
        ok: false,
        error: "cancel_in_flight",
        error_code: "in_flight",
        suggested_message: "Recebi seu pedido de cancelamento e estou processando. Te confirmo em instantes.",
      };
    }

    const calStatus = data?.cal_status ?? null;
    const calBody = data?.cal_body ?? null;
    const calMessage = data?.cal_message || data?.error || (networkErr ? String(networkErr) : `HTTP ${httpStatus}`);
    const errStr = `cancel_failed http=${httpStatus} cal_status=${calStatus} msg=${calMessage}`;
    console.error("[sdr-agent] cancel_booking real failure:", JSON.stringify({ httpStatus, calStatus, calBody, calMessage, raw: data }));
    return {
      ok: false,
      error: errStr,
      cal_status: calStatus,
      cal_body: calBody,
      cal_message: calMessage,
      suggested_message: "Tive um problema técnico aqui pra processar o cancelamento agora. Anotei seu pedido e vou tentar de novo em alguns minutos — confirmo assim que conseguir. Tudo bem?",
    };
  }

  const slotStart = guard.slotIso;

  // ── BOOK ──────────────────────────────────────────────────────
  if (name === "book_slot") {
    // ── E-mail real obrigatório antes de confirmar ────────────────
    // Sem e-mail válido o Cal.com não consegue enviar o convite. Em vez
    // de agendar com placeholder (noreply+…@…), interrompemos o fluxo,
    // persistimos o slot pretendido em lead_memory.facts e pedimos o
    // e-mail ao lead. No próximo turno o e-mail é capturado, persistido
    // em leads.email, e o LLM é instruído a chamar book_slot de novo.
    {
      const { data: leadRow } = await supabase
        .from("leads")
        .select("email")
        .eq("id", ctx.lead_id)
        .maybeSingle();
      let convChannel: string | null = null;
      if (ctx.conversation_id) {
        const { data: cv } = await supabase
          .from("conversations")
          .select("channel")
          .eq("id", ctx.conversation_id)
          .maybeSingle();
        convChannel = (cv?.channel ?? null) as string | null;
      }
      const currentEmail = String(leadRow?.email || "").trim().toLowerCase();
      const isPlaceholder = /^noreply\+[a-f0-9-]+@/i.test(currentEmail);
      const isValidEmail = /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(currentEmail) && !isPlaceholder;
      if (!isValidEmail && convChannel !== "email") {
        try {
          const newFacts = {
            ...facts,
            pending_email_for_slot: {
              slot_iso: slotStart,
              hold_id: guard.matchedHold?.id ?? null,
            },
          };
          await supabase.from("lead_memory").upsert(
            {
              lead_id: ctx.lead_id,
              company_id: ctx.company_id,
              facts: newFacts,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "lead_id" },
          );
        } catch (e) {
          console.error("pending_email_for_slot upsert failed:", e);
        }
        return {
          ok: false,
          downgrade: "request_email",
          reason: "lead sem e-mail cadastrado — peça o e-mail antes de confirmar",
          suggested_message:
            "Pra eu confirmar e te mandar o convite da reunião, qual é o melhor e-mail pra te marcar?",
          next_action: "Chame finalize com decision=send_message e message=suggested_message.",
        };
      }
    }

    const idempotency_key = await buildIdempotencyKey({
      conversation_id: ctx.conversation_id, lead_id: ctx.lead_id,
      action_type: "book", requested_start: slotStart,
    });
    const claim = await claimCalendarAction(supabase, {
      idempotency_key, conversation_id: ctx.conversation_id, lead_id: ctx.lead_id, company_id: ctx.company_id,
      action_type: "book", requested_start: slotStart,
      request_payload: { slot_start: slotStart },
    });
    if (claim.kind === "existing") {
      const resp = (claim.row.response_payload ?? {}) as any;
      return {
        ok: true, replayed: true,
        booking_uid: claim.row.provider_booking_uid,
        scheduled_at: resp?.booking?.scheduled_at ?? resp?.scheduled_at ?? slotStart,
        message_suggestion: `Reserva já confirmada para ${formatBRTLong(slotStart)}.`,
      };
    }
    const matchedHold = guard.matchedHold;
    if (!matchedHold) {
      await markCalendarActionFailed(supabase, claim.row.id, "no matching held slot");
      return { ok: false, error: "no matching held slot for " + slotStart };
    }
    const guestEmails = Array.isArray((args as any).guest_emails)
      ? ((args as any).guest_emails as unknown[])
          .map((g) => String(g || "").trim().toLowerCase())
          .filter((g) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(g))
      : [];
    // Persiste guests no metadata do hold ANTES de invocar o booking para
    // garantir que, mesmo se a invocação cair, o próximo retry preserve.
    if (guestEmails.length > 0) {
      try {
        const prevMeta = ((matchedHold as any).metadata ?? {}) as Record<string, unknown>;
        const merged = Array.from(new Set([
          ...((prevMeta.guest_emails as string[] | undefined) ?? []),
          ...guestEmails,
        ]));
        await supabase.from("slot_holds").update({
          metadata: { ...prevMeta, guest_emails: merged },
        }).eq("id", matchedHold.id);
      } catch (_) { /* best effort */ }
    }
    const { data: booking, error: bookErr } = await supabase.functions.invoke("calcom-confirm-booking", {
      body: { lead_id: ctx.lead_id, selected_slot_hold_id: matchedHold.id, force_placeholder: false, guest_emails: guestEmails },
    });
    if (bookErr || (booking as any)?.error) {
      const errStr = bookErr ? String(bookErr) : String((booking as any)?.error);
      await markCalendarActionFailed(supabase, claim.row.id, errStr);
      return { ok: false, error: errStr };
    }
    const bookingUid =
      (booking as any)?.booking?.uid ??
      (booking as any)?.booking?.calcom_booking_uid ??
      (booking as any)?.booking_uid ??
      (booking as any)?.calcom_booking_uid ??
      null;
    await markCalendarActionOk(supabase, claim.row.id, {
      provider_booking_uid: bookingUid,
      response_payload: (booking as any) ?? {},
    });
    // Limpa offered_slots_pending, email_just_resolved_slot e pending_email_for_slot da memória.
    try {
      const newFacts = { ...facts };
      let changed = false;
      if ((newFacts as any).offered_slots_pending) { delete (newFacts as any).offered_slots_pending; changed = true; }
      if ((newFacts as any).email_just_resolved_slot) { delete (newFacts as any).email_just_resolved_slot; changed = true; }
      if ((newFacts as any).pending_email_for_slot) { delete (newFacts as any).pending_email_for_slot; changed = true; }
      if (changed) {
        const { error: memErr } = await supabase.from("lead_memory").upsert(
          { lead_id: ctx.lead_id, company_id: ctx.company_id, facts: newFacts, updated_at: new Date().toISOString() },
          { onConflict: "lead_id" },
        );
        if (memErr) console.error("lead_memory upsert (clear post-book flags) failed:", memErr);
      }
    } catch (e) { console.error("lead_memory upsert (clear post-book flags) threw:", e); }
    const guestSuffix = guestEmails.length > 0
      ? ` Também incluí ${guestEmails.join(", ")} no convite — eles vão receber o invite por e-mail.`
      : "";
    return {
      ok: true, booking_uid: bookingUid, scheduled_at: slotStart, guest_emails: guestEmails,
      message_suggestion: `Pronto! Confirmei a reunião para ${formatBRTLong(slotStart)}. Você vai receber o convite com o link por e-mail.${guestSuffix} 🙌`,
    };
  }

  // ── RESCHEDULE ────────────────────────────────────────────────
  // Idempotency is owned entirely by the calcom-booking-reschedule edge
  // function — claiming it here too caused a double-claim and 425 (in_flight).
  const bookingUid = (typeof args.booking_uid === "string" && args.booking_uid) || guard.activeBookingUid;
  if (!bookingUid) return { ok: false, error: "no active booking to reschedule" };
  const reason = typeof args.reason === "string" ? args.reason : "Cliente solicitou remarcação";
  const startIso = normalizeSlotStartIsoBrt(slotStart);
  const idempotency_key = await buildIdempotencyKey({
    conversation_id: ctx.conversation_id, lead_id: ctx.lead_id,
    action_type: "reschedule", requested_start: startIso, provider_booking_uid: bookingUid,
  });

  // Use raw fetch so we can read the structured error body that the edge
  // function returns on non-2xx (supabase.functions.invoke throws and drops it).
  const reschedUrl = `${Deno.env.get("SUPABASE_URL")!}/functions/v1/calcom-booking-reschedule`;
  const reschedResp = await fetch(reschedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    },
    body: JSON.stringify({ booking_uid: bookingUid, start: startIso, reason, lead_id: ctx.lead_id, conversation_id: ctx.conversation_id, idempotency_key }),
  });
  const reschedText = await reschedResp.text();
  let resched: any; try { resched = reschedText ? JSON.parse(reschedText) : {}; } catch { resched = { raw: reschedText }; }

  if (!reschedResp.ok || resched?.success === false || resched?.error) {
    const errStr = String(resched?.error ?? `HTTP ${reschedResp.status}`);

    // ── Auto-downgrade: booking no longer exists → fall through to book_slot.
    if (resched?.error_code === "booking_not_found") {
      console.log("[sdr-agent] reschedule→book_slot downgrade (booking_not_found):", bookingUid);
      const bookResult = await execBookingTool("book_slot", { slot_start: slotStart }, ctx);
      return { ...(bookResult as object), downgraded_from: "reschedule_booking" };
    }

    // Structured errors from Cal.com → return suggested_message so the loop
    // (and the forced-tool short-circuit) can finalize cleanly instead of looping.
    const suggested = typeof resched?.suggested_message === "string"
      ? resched.suggested_message
      : "Tive um problema técnico ao confirmar esse horário. Pode escolher outro dia/hora pra eu reservar?";
    return {
      ok: false,
      error: errStr,
      error_code: resched?.error_code ?? "reschedule_failed",
      downgrade: resched?.error_code === "slot_unavailable" ? "reoffer_slots" : "ask_confirmation",
      calcom_status: resched?.calcom_status ?? null,
      calcom_body: resched?.calcom_body ?? null,
      suggested_message: suggested,
    };
  }

  if (resched?.idempotent_replay) {
    return {
      ok: true, replayed: true, booking_uid: resched.booking_uid ?? bookingUid, scheduled_at: startIso,
      message_suggestion: `Remarcação já confirmada para ${formatBRTLong(startIso)}.`,
    };
  }

  const newUid =
    resched?.booking?.uid ??
    resched?.booking?.calcom_booking_uid ??
    resched?.booking_uid ??
    resched?.calcom_booking_uid ??
    bookingUid;
  return {
    ok: true, booking_uid: newUid, scheduled_at: startIso,
    message_suggestion: `Pronto! Remarquei para ${formatBRTLong(startIso)}. Você vai receber o novo convite por e-mail. 🙌`,
  };
}


async function loadContext(leadId: string) {
  const { data: lead } = await supabase
    .from("leads")
    .select("id, company_id, name, company_name, email, phone, whatsapp, status, source, created_at, referral_source_lead_id, referrer_name, referrer_company")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) throw new Error("lead not found");

  const { data: company } = await supabase
    .from("companies")
    .select("id, name, niche, tone, value_proposition")
    .eq("id", lead.company_id)
    .maybeSingle();

  const { data: memory } = await supabase
    .from("lead_memory")
    .select("summary, facts")
    .eq("lead_id", leadId)
    .maybeSingle();

  const { data: convs } = await supabase
    .from("conversations")
    .select("id, channel")
    .eq("lead_id", leadId);
  const convIds = (convs ?? []).map((c) => c.id);

  let messages: Array<{
    direction: string;
    content: string;
    created_at: string;
    metadata?: Record<string, unknown> | null;
    channel?: string | null;
  }> = [];
  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("direction, content, sent_at, metadata, channel")
      .in("conversation_id", convIds)
      .order("sent_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    messages = (msgs ?? []).map((m: { direction: string; content: string; sent_at: string; metadata: Record<string, unknown> | null; channel: string | null }) => ({
      direction: m.direction,
      content: m.content,
      created_at: m.sent_at,
      metadata: m.metadata,
      channel: m.channel,
    })).reverse();

  }

  const { data: intents } = await supabase
    .from("lead_intents_log")
    .select("category, sub_intent, confidence, entities, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(8);

  // Active scheduling state — held slots + confirmed booking
  const { data: heldSlots } = await supabase
    .from("slot_holds")
    .select("slot_datetime, status, expires_at")
    .eq("lead_id", leadId)
    .in("status", ["held", "confirmed"])
    .order("slot_datetime", { ascending: true });

  const { data: activeBookings } = await supabase
    .from("bookings")
    .select("id, calcom_booking_uid, status, scheduled_at, updated_at")
    .eq("lead_id", leadId)
    .in("status", ["confirmed", "pending"])
    .order("updated_at", { ascending: false })
    .order("scheduled_at", { ascending: false })
    .limit(5);

  const { data: enrollment } = await supabase
    .from("cadence_enrollments")
    .select("id, status, paused_reason, current_step")
    .eq("lead_id", leadId)
    .in("status", ["active", "paused"])
    .maybeSingle();

  // Curated KB: highlights, ai_instructions, and catalog of documents
  const [highlightsRes, aiInstrRes, kbDocsRes] = await Promise.all([
    supabase.from("company_knowledge").select("content").eq("company_id", lead.company_id).eq("type", "highlights").maybeSingle(),
    supabase.from("company_knowledge").select("content").eq("company_id", lead.company_id).eq("type", "ai_instructions").maybeSingle(),
    supabase.from("company_knowledge").select("id, title, type").eq("company_id", lead.company_id).not("type", "in", "(highlights,ai_instructions)").order("created_at", { ascending: false }).limit(30),
  ]);
  const kb = {
    highlights: highlightsRes.data?.content ?? null,
    ai_instructions: aiInstrRes.data?.content ?? null,
    docs: (kbDocsRes.data ?? []) as Array<{ id: string; title: string; type: string }>,
  };

  return { lead, company, memory, messages, intents: intents ?? [], heldSlots: heldSlots ?? [], activeBookings: activeBookings ?? [], enrollment, kb };

}

function fmtBrt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

// Regex de confirmação explícita do lead para um horário já oferecido.
// Combina expressões comuns em PT-BR ("confirmo", "fechado", "pode ser", "esse mesmo",
// "tá bom", "ok pra mim", "esse horário", "esse aí" etc).
const CONFIRMATION_REGEX =
  /\b(confirmo|confirmado|confirma|confirmar|fechado|fechou|pode (ser|marcar|agendar|fechar|reservar|sim)|podemos sim|sim pode|esse (mesmo|aí|ai|horário|horario)|esse hor[aá]rio|isso( mesmo)?|é isso( mesmo)?|tá (bom|ótimo|otimo)|ta (bom|otimo)|t[áa] (ok|certo)|ok\s+(pra mim|pra n[oó]s|pra gente|por mim)|perfeito|beleza|combinado|bora|partiu|manda ver|topo|com certeza|claro|quero (esse|essa|o de|a de|marcar|agendar)|vou (com|de)|fica (esse|essa|o de|a de))\b/i;

// Palavras-chave de assentimento curto. Usadas só quando a mensagem é muito curta.
const SHORT_ACK_REGEX = /(\bsim\b|\bok\b|\bokay\b|\bblz\b|\bvaleu\b|\bisso\b|\bclaro\b|\bcerto\b|\bbora\b|\btopo\b|\bpartiu\b|\bpode\b|👍|✅|🤝|🙌)/i;

function isLikelyConfirmation(text: string): boolean {
  const raw = (text || "").trim();
  if (!raw) return false;
  if (CONFIRMATION_REGEX.test(raw)) return true;
  const normalized = _normalizeText(raw);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  // Mensagem curta (até 4 palavras) + palavra de assentimento = confirmação.
  if (wordCount <= 4 && SHORT_ACK_REGEX.test(raw)) return true;
  return false;
}

function lastInboundContent(messages: Array<{ direction: string; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === "inbound") return String(messages[i].content || "");
  }
  return "";
}

function lastOutboundContent(messages: Array<{ direction: string; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === "outbound") return String(messages[i].content || "");
  }
  return "";
}

/**
 * Detecta oferta verbal de um único slot na última mensagem outbound.
 * Se o agente perguntou confirmação sobre UM horário específico (em texto livre,
 * sem chamar `offer_slots`), retorna o ISO correspondente entre os holds ativos.
 */
function implicitOfferFromOutbound(outboundText: string, candidateIsos: string[]): string | null {
  if (!outboundText || candidateIsos.length === 0) return null;
  const matched: string[] = [];
  for (const iso of candidateIsos) {
    const ref = matchesSlotReference(outboundText, [iso]);
    if (ref.iso) matched.push(iso);
  }
  return matched.length === 1 ? matched[0] : null;
}

// ──────────────────────────────────────────────────────────────────────
// Reconhecimento de seleção de slot por referência curta (pt-BR).
// Ex.: "Dia 1", "1/7", "1 de julho", "9h", "09:00", "o primeiro".
// ──────────────────────────────────────────────────────────────────────
const MONTH_NAMES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTH_FULL_PT = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function _normalizeText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function _brtParts(iso: string): { day: number; month: number; hour: number; minute: number; weekday: number } | null {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      day: "numeric", month: "numeric", hour: "numeric", minute: "numeric", hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
    const wkStr = String(parts.find((p) => p.type === "weekday")?.value || "").toLowerCase();
    const WK: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute"), weekday: WK[wkStr] ?? -1 };
  } catch {
    return null;
  }
}

// Nomes de dia da semana em PT-BR (já sem acento — bate com _normalizeText).
// Índice 0=domingo … 6=sabado.
const WEEKDAY_NAMES_PT: Array<string[]> = [
  ["domingo", "dom"],
  ["segunda-feira", "segunda feira", "segunda", "seg"],
  ["terca-feira", "terca feira", "terca", "ter"],
  ["quarta-feira", "quarta feira", "quarta", "qua"],
  ["quinta-feira", "quinta feira", "quinta", "qui"],
  ["sexta-feira", "sexta feira", "sexta", "sex"],
  ["sabado", "sab"],
];

function _slotPatterns(iso: string): { day: string[]; hour: string[] } {
  const p = _brtParts(iso);
  if (!p) return { day: [], hour: [] };
  const { day, month, hour, minute, weekday } = p;
  const d = String(day), dd = String(day).padStart(2, "0");
  const m = String(month), mm = String(month).padStart(2, "0");
  const monShort = MONTH_NAMES_PT[month - 1];
  const monFull = MONTH_FULL_PT[month - 1];
  const h = String(hour), hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  const wkNames = weekday >= 0 ? WEEKDAY_NAMES_PT[weekday] : [];
  const dayP = [
    `dia ${d}`, `dia ${dd}`,
    `${d}/${m}`, `${dd}/${mm}`, `${d}/${mm}`, `${dd}/${m}`,
    `${d} de ${monShort}`, `${d} de ${monFull}`,
    `${dd} de ${monShort}`, `${dd} de ${monFull}`,
    ...wkNames,
    ...(day === 1 ? ["primeiro", "1o", "1 de "] : []),
  ];
  const hourP: string[] = [
    `${hh}:${min}`,
    `${h}:${min}`,
  ];
  if (minute === 0) {
    hourP.push(`${h}h`, `as ${h}h`, `as ${h} `, `${h} horas`);
  } else {
    hourP.push(`${h}h${min}`, `${h}:${min}`);
  }
  return { day: dayP, hour: hourP };
}

// Ordinais posicionais: "primeira opção" → índice 0, "última" → último.
// CUIDADO: "segunda" também é dia da semana — só conta como ordinal se NÃO
// vier acompanhada de "feira" (com ou sem hífen).
const ORDINAL_PATTERNS: Array<{ re: RegExp; idx: number }> = [
  { re: /\b(primeira|primeiro|1[aº°o]?|opcao 1|a 1)\b/, idx: 0 },
  { re: /\b(segunda|segundo|2[aº°o]?|opcao 2|a 2)\b/, idx: 1 },
  { re: /\b(terceira|terceiro|3[aº°o]?|opcao 3|a 3)\b/, idx: 2 },
  { re: /\b(quarta|quarto|4[aº°o]?|opcao 4|a 4)\b/, idx: 3 },
  { re: /\b(ultima|ultimo)\b/, idx: -1 },
];

function _resolveOrdinal(text: string, n: number): { idx: number | null; ambiguous: boolean } {
  // Remove dias da semana para não disparar falso-positivo em "segunda-feira" etc.
  const cleaned = text
    .replace(/\b(segunda|terca|quarta|quinta|sexta)[\s-]+feira\b/g, " ")
    .replace(/\b(segunda|terca|quarta|quinta|sexta)-feira\b/g, " ");
  const hits: number[] = [];
  for (const { re, idx } of ORDINAL_PATTERNS) {
    if (re.test(cleaned)) {
      const realIdx = idx === -1 ? n - 1 : idx;
      if (realIdx >= 0 && realIdx < n && !hits.includes(realIdx)) hits.push(realIdx);
    }
  }
  if (hits.length === 0) return { idx: null, ambiguous: false };
  if (hits.length === 1) return { idx: hits[0], ambiguous: false };
  return { idx: null, ambiguous: true };
}

function matchesSlotReference(text: string, candidateIsos: string[]): { iso: string | null; ambiguous: boolean } {
  const t = ` ${_normalizeText(text)} `;
  if (!t.trim() || candidateIsos.length === 0) return { iso: null, ambiguous: false };

  // 1) Tenta resolução por ordinal posicional ("primeira", "terceira", "última").
  const ord = _resolveOrdinal(t, candidateIsos.length);
  if (ord.idx !== null) return { iso: candidateIsos[ord.idx], ambiguous: false };
  if (ord.ambiguous) return { iso: null, ambiguous: true };

  // 2) Resolução por dia/hora.
  const scored = candidateIsos.map((iso) => {
    const { day, hour } = _slotPatterns(iso);
    const dayMatch = day.some((p) => t.includes(_normalizeText(p)));
    const hourMatch = hour.some((p) => t.includes(_normalizeText(p)));
    return { iso, score: (dayMatch ? 1 : 0) + (hourMatch ? 1 : 0) };
  });
  const positives = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (positives.length === 0) return { iso: null, ambiguous: false };
  if (positives.length === 1) return { iso: positives[0].iso, ambiguous: false };
  if (positives[0].score > positives[1].score) return { iso: positives[0].iso, ambiguous: false };
  return { iso: null, ambiguous: true };
}

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof loadContext>>): string {
  const { lead, company, memory, intents, heldSlots, activeBookings, enrollment, kb, messages } = ctx as any;
  const activeBooking = (activeBookings || []).find((b: any) => b.status === "confirmed" || b.status === "pending");
  const lastOutbound = (messages || []).find((m: any) => m.direction === "outbound");
  const lastInbound = (messages || []).find((m: any) => m.direction === "inbound");
  const cancelQuestionAsked = lastOutbound && /\b(devo|posso|quer(?:es)?\s+que\s+eu|gostaria\s+que\s+eu)\s+(cancel(?:ar|o)|desmarc(?:ar|o))/i.test(String(lastOutbound.content || ""));
  const leadAffirmed = lastInbound && /^(isso(?:\s+mesmo)?|sim|pode|combinado|ok|claro|por\s+favor|fechado)\b/i.test(String(lastInbound.content || "").trim());


  const facts = (memory?.facts ?? {}) as Record<string, unknown>;
  const datePref = (facts.date_preference ?? null) as null | { start_after?: string; end_before?: string; raw?: string };
  const preferredChannel = (facts.preferred_channel ?? null) as string | null;

  const lastIntent = intents[0];

  return [
    `Você é um SDR (Sales Development Representative) de IA que trabalha para "${company?.name ?? "a empresa"}".`,
    company?.value_proposition ? `Proposta de valor: ${company.value_proposition}` : "",
    company?.tone ? `Tom de voz: ${company.tone}` : "Tom: profissional, próximo, consultivo, sem clichês.",
    "",
    "## Base de conhecimento da empresa (curada — já carregada, sem precisar de tool)",
    kb.highlights ? `### Diferenciais (highlights)\n${kb.highlights}` : "### Diferenciais: (não cadastrados)",
    kb.ai_instructions ? `### Instruções de abordagem\n${kb.ai_instructions}` : "",
    kb.docs.length
      ? `### Documentos disponíveis (use list_knowledge / read_knowledge_item para abrir):\n${kb.docs.map((d) => `- [${d.id}] (${d.type}) ${d.title}`).join("\n")}`
      : "### Documentos: (catálogo vazio)",

    "## Missão",
    "- Conduzir o lead a agendar uma conversa.",
    "- Tirar dúvidas com base na KB (use search_knowledge ANTES de afirmar fatos).",
    "- Identificar e responder objeções com empatia.",
    "- Reconhecer indicações (referral) e encerros (não tem interesse).",
    "",
    "## Regras críticas",
    "- NUNCA invente preços, prazos, condições, horários, integrações ou políticas — busque na KB ou no calendário.",
    "- SEMPRE leia TODO o histórico antes de decidir. Preferências que o lead já manifestou em qualquer turno anterior CONTINUAM VALENDO até ele mudar de ideia explicitamente.",
    "- Se o lead já pediu uma janela de datas (ex: 'daqui a 10 dias', 'semana que vem', 'só depois do dia 25'), TODAS as próximas ofertas de horário DEVEM respeitar essa janela. Passe start_after/end_before para check_calendar — mesmo que a faixa tenha sido mencionada turnos atrás.",
    "- Se o lead REJEITOU os slots oferecidos e pediu mais opções, ofereça NOVOS slots ainda dentro da janela que ele pediu. NÃO volte a sugerir as datas já rejeitadas. Use exclude_datetimes/exclude_dates.",
    "- Se EXISTE `date_preference` na memória do lead, é **PROIBIDO** usar `schedule_followup` ou responder coisas como 'vou entrar em contato', 'te aviso quando tiver disponibilidade', 'retorno em breve'. Você DEVE chamar `check_calendar` passando `start_after`/`end_before` da janela e finalizar com `offer_slots` (ou `send_message` contendo os horários formatados). Se realmente não houver slots na janela, então sim, escalate_to_human ou schedule_followup explicando o motivo.",
    "- **PROIBIDO ABSOLUTAMENTE** responder com frases de espera tipo 'só um momento', 'já te retorno', 'vou verificar e te aviso', 'me dá um instante', 'aguarde um momento' quando o lead pediu horários. Você NÃO tem um turno futuro garantido — se prometer voltar, vai abandonar o lead. SEMPRE execute `check_calendar` + `offer_slots` no MESMO turno.",
    "- Se a MENSAGEM ATUAL do lead já contém uma janela temporal explícita (hoje, amanhã, depois de amanhã, semana que vem, segunda, terça, dia X, próxima semana, etc.) e ele pergunta sobre horários ou disponibilidade, trate como `date_preference` IMEDIATA (não espere estar na memória): chame `update_lead_facts` registrando a janela, depois `check_calendar` cobrindo essa janela, e finalize com `offer_slots` — tudo no mesmo turno.",
    "- Se `check_calendar` retornar `reason: 'no_slots_in_window'`, é PROIBIDO responder 'instabilidade no sistema', 'aguarde', ou 'já te retorno'. Reconheça naturalmente que não há horário no dia/janela pedida (ex.: 'amanhã é sábado e não atendo nesse dia', 'não tenho horário no dia X') e finalize com `offer_slots` usando os `next_available` retornados. A mensagem deve ser natural, sem culpar sistema.",
    "- Se `check_calendar` retornar `reason: 'no_availability'`, explique que a agenda está cheia pelos próximos dias e peça uma janela maior ao lead, ou use `escalate_to_human` se for crítico. Nunca diga 'sistema instável'.",
    "- NUNCA ofereça slots fora da janela `date_preference`. Se `check_calendar` retornar slots fora dela, descarte-os e chame `check_calendar` de novo com a janela correta (start_after maior).",
    "- Chame `check_calendar` no máximo UMA vez por turno. Se já chamou e recebeu slots, use ESSES mesmos slots — não chame de novo na mesma decisão (isso gera reservas duplicadas).",
    "- Se `heldSlots` já contém slots ativos dentro da janela do lead, ofereça ESSES (não chame `check_calendar`).",
    "- **NUNCA ofereça mais de 2 horários por turno.** Mensagens com 3+ horários sobrecarregam o lead. Escolha os 2 melhores dentro da janela pedida.",
    "- **O texto da sua mensagem e o array `offered_slots` DEVEM coincidir 1:1.** É proibido listar no texto datas/horas que não estejam em `offered_slots` (isso seria alucinação — esses horários não estão reservados e o lead não conseguirá agendá-los).",
    "- Se você já ofereceu 4 ou mais horários nos últimos turnos e o lead AINDA não aceitou nem rejeitou explicitamente (apenas pediu 'outros', 'mais opções', etc.), PARE de propor horários novos. Em vez disso, peça uma janela específica: 'Para encurtar a busca, me diga um período da semana que costuma funcionar melhor pra você (ex: manhã de terça/quinta, tarde de sexta).' Isso evita a sensação de spam de horários.",
    "- Use update_lead_facts assim que detectar uma preferência nova (janela de data, canal, objeção, papel, urgência).",
    "- SEMPRE finalize chamando a tool `finalize`.",
    "- Português brasileiro. Mensagens curtas (2-3 parágrafos no máximo). Não use 'olá' nem 'tudo bem?' se já está no meio da conversa.",

    "",
    "## Indicações (referral)",
    "- Se `Fonte` do lead é `referral` e ele NÃO tem WhatsApp cadastrado (veja `Canais` abaixo), você DEVE, na primeira resposta dele, pedir educadamente o número de WhatsApp para agilizar a conversa. Exemplo: 'Pra gente conversar mais rápido, qual o melhor número de WhatsApp pra te chamar?'. Inclua o pedido junto da resposta normal — não envie uma mensagem só pra isso.",
    "- Depois de pedir, chame `update_lead_facts({ facts: { whatsapp_asked: true } })` para não repetir nos próximos turnos.",
    "- Quando o lead RESPONDER com um número de telefone/WhatsApp, chame `update_lead_facts({ facts: { whatsapp: '<numero normalizado +55...>' } })`. Isso persiste o número no cadastro do lead e a cadência passa a usar WhatsApp.",
    "- Sempre que possível, mencione naturalmente quem indicou (use o campo `Indicado por` abaixo) para criar conexão — sem soar artificial.",

    "",
    "## Reservas existentes (remarcar/cancelar)",
    "- **Agendar/remarcar/cancelar são TOOLS (`book_slot`, `reschedule_booking`, `cancel_booking`), NÃO valores de `decision` na `finalize`.** Você chama a tool, ela executa o agendamento de fato no Cal.com, retorna `{ ok, booking_uid, scheduled_at, message_suggestion }`, e SÓ ENTÃO você chama `finalize` com `decision=send_message` usando o `message_suggestion` como mensagem ao lead (ou refinando-o).",
    "- **NUNCA chame `book_slot`/`reschedule_booking` num turno onde o lead ainda NÃO escolheu explicitamente um horário que você já tinha oferecido antes.** Pedir desculpas ou pedir para 'remarcar' NÃO é confirmação de um novo horário. Se chamar prematuramente, a tool devolve `{ ok:false, downgrade:'ask_confirmation', suggested_message }` — nesse caso finalize com `send_message` e o `suggested_message`.",
    "- **Fluxo correto de PRIMEIRO agendamento (2 turnos):** (1) `check_calendar` + finalize com `offer_slots` (máx 2 horários), (2) AGUARDAR resposta. No turno SEGUINTE, quando o lead apontar UM dos horários oferecidos (ex: 'pode ser quarta 15h', 'esse mesmo', 'confirmo o primeiro'), chame a tool `book_slot({ slot_start: ISO_EXATO })` e depois `finalize({ decision: 'send_message', message: message_suggestion })`.",
    "- **Fluxo correto de REMARCAÇÃO (2 turnos):** quando existe 'Reserva ativa' e o lead pede para mudar, (1) `offer_slots` com 2 novos horários, (2) AGUARDAR. No turno SEGUINTE, quando o lead escolher, chame `reschedule_booking({ slot_start })` e depois `finalize(send_message)`.",
    "- **Interpretação de escolha curta:** respostas como 'dia 1', 'o primeiro', '9h', 'esse mesmo', 'a primeira', 'a segunda opção' SÃO confirmação válida — copie o ISO EXATO do horário oferecido para `slot_start`. Ordinais apontam a POSIÇÃO da lista oferecida. Se a referência for ambígua, peça pra esclarecer (não chame a tool).",
    "- Se o lead pede CANCELAR/desmarcar sem pedir novo horário, chame a tool `cancel_booking({ reason })` e finalize com `send_message`.",
    "- **REGRA DURA:** se na sua mensagem você vai dizer 'vou cancelar', 'cancelei', 'vou desmarcar', 'desmarquei', 'cancelar nosso horário/agendamento/reunião' e existe Reserva ativa, é OBRIGATÓRIO chamar `cancel_booking` ANTES do `finalize`. Se você perguntou no turn anterior 'devo cancelar?' / 'posso cancelar?' e o lead respondeu afirmativamente (isso/sim/pode/combinado/ok), é OBRIGATÓRIO chamar `cancel_booking` agora antes de responder.",
    "- **APÓS `cancel_booking` com `ok:true` — MANTER O CONTROLE DA CONVERSA:** o retorno traz `next_action`. (a) Se `next_action='offer_slots'` (padrão): chame `check_calendar` NO MESMO TURNO para buscar 2 novos horários e finalize com `decision='offer_slots'` (confirmando o cancelamento + oferecendo os 2 novos). (b) Se `next_action='ask_reschedule'`: finalize com `send_message` usando o `message_suggestion` (confirmação + pergunta de quando reagendar). (c) Se `next_action='none'` (lead desistiu): finalize com `send_message` usando o `message_suggestion` (sem reoferecer). NUNCA encerre um cancelamento sem reabrir o agendamento (salvo no caso 'none').",
    "- A confirmação da remarcação/cancelamento (depois de feita) deve vir no campo `message` da finalize.",
    "",
    "## Antes de escalar para humano (escalate_to_human) você DEVE esgotar a KB:",
    "1. Tentar `search_knowledge` com PELO MENOS 2 reformulações diferentes (sinônimos, termos do segmento do lead, perguntas relacionadas).",
    "2. Chamar `list_knowledge` para ver TODO o catálogo de documentos da empresa.",
    "3. Usar `read_knowledge_item` em qualquer documento cujo título seja relacionado à dúvida.",
    "4. Se ainda assim faltar um DADO ESPECÍFICO (número, prazo, integração técnica), responda combinando os DIFERENCIAIS (highlights) + PROPOSTA DE VALOR já carregados no contexto, personalizando ao segmento/empresa do lead, e proponha a reunião para detalhar — sem inventar números. Isso é venda consultiva legítima, NÃO é alucinação.",
    "- Só use escalate_to_human para: reclamação formal, jurídico/compliance, pedido fora do escopo comercial, ou objeção complexa que exija negociação humana. NÃO escale por 'KB não tem essa palavra exata'.",
    "- Perguntas do tipo 'quais as vantagens pra mim/minha clínica/meu negócio?' são SEMPRE respondíveis: use highlights + value_proposition + contexto do lead e convide para a reunião.",

    "",
    `## Lead atual`,
    `Nome: ${lead.name ?? "?"}`,
    `Empresa: ${lead.company_name ?? "?"}`,
    `Status: ${lead.status ?? "?"} | Fonte: ${lead.source ?? "?"} | Criado: ${lead.created_at ? fmtBrt(lead.created_at) : "?"}`,
    `Canais: ${[lead.whatsapp && `whatsapp:${lead.whatsapp}`, lead.email && `email:${lead.email}`, lead.phone && `phone:${lead.phone}`].filter(Boolean).join(", ") || "—"}`,
    (lead as any).source === "referral" && ((lead as any).referrer_name || (lead as any).referral_source_lead_id)
      ? `Indicado por: ${(lead as any).referrer_name ?? "(indicante)"}${(lead as any).referrer_company ? ` — ${(lead as any).referrer_company}` : ""}`
      : "",
    (lead as any).source === "referral" && !lead.whatsapp && !facts?.whatsapp_asked
      ? `⚠️ AÇÃO OBRIGATÓRIA: este lead veio por indicação e ainda não tem WhatsApp. Peça o número nesta resposta e chame update_lead_facts({ whatsapp_asked: true }).`
      : "",
    preferredChannel ? `Canal preferido: ${preferredChannel}` : "",
    "",
    `## Memória do lead (persiste entre turnos)`,
    memory?.summary ? `Resumo: ${memory.summary}` : "Resumo: (sem resumo ainda)",
    Object.keys(facts).length ? `Fatos: ${JSON.stringify(facts)}` : "Fatos: (vazio)",
    datePref
      ? `⚠️ JANELA DE DATAS PREFERIDA: ${datePref.raw ?? ""} → start_after=${datePref.start_after ?? "—"}, end_before=${datePref.end_before ?? "—"}. USE essa janela ao chamar check_calendar.`
      : "",
    "",
    `## Estado de agendamento`,
    activeBooking
      ? `⚠️ Reserva ativa: status=${activeBooking.status}, agendada para ${fmtBrt(activeBooking.scheduled_at)}, booking_uid=${activeBooking.calcom_booking_uid}. Se o lead quiser mudar de horário, use \`reschedule_booking\` (NÃO use book_slot).`
      : "Sem reserva ativa.",
    activeBooking && cancelQuestionAsked
      ? `⚠️ AÇÃO OBRIGATÓRIA: no turn anterior você perguntou se deveria cancelar a reunião. ${leadAffirmed ? "O lead JÁ CONFIRMOU. " : ""}Se for prosseguir com o cancelamento, chame \`cancel_booking({ booking_uid: "${activeBooking.calcom_booking_uid}", reason })\` AGORA antes do finalize.`
      : "",
    (ctx as any).pending_email_resolved
      ? [
          `⚠️ AÇÃO OBRIGATÓRIA — RESERVAR JÁ:`,
          `O lead acabou de informar o e-mail (${(ctx as any).pending_email_resolved.email}) que pedimos pra agendar. Já salvei em \`leads.email\`. O horário ${(ctx as any).pending_email_resolved.slot_iso} JÁ FOI ACORDADO antes — está apenas esperando a reserva sair.`,
          ``,
          `PROIBIDO neste turno:`,
          `- NÃO chame \`check_calendar\` nem ofereça novos horários.`,
          `- NÃO pergunte "podemos confirmar?", "tudo certo?", "fechado?" — o slot JÁ está acordado.`,
          `- NÃO peça o e-mail de novo.`,
          ``,
          `OBRIGATÓRIO neste turno (nessa ordem):`,
          `1. Chame \`book_slot({ slot_start: "${(ctx as any).pending_email_resolved.slot_iso}" })\`.`,
          `2. Chame \`finalize({ decision: "send_message", message: <texto> })\`.`,
          `   Texto deve apenas agradecer e confirmar (sem perguntas). Exemplo: "Perfeito! Reunião confirmada para <data/hora em pt-BR>. Você vai receber o convite por e-mail. Até lá!"`,
        ].join("\n")
      : "",
    heldSlots.length
      ? `Slots já oferecidos/segurados: ${heldSlots.map((s) => `${fmtBrt(s.slot_datetime)} (${s.status})`).join(", ")}. NÃO ofereça esses mesmos slots novamente — passe-os em exclude_datetimes se for buscar novos.`
      : "Nenhum slot ativo segurado.",
    enrollment
      ? `Enrollment: status=${enrollment.status}, motivo_pausa=${enrollment.paused_reason ?? "—"}, step=${enrollment.current_step ?? "?"}.`
      : "Sem cadência ativa.",
    "",
    `## Últimas intenções classificadas (mais recente primeiro)`,
    intents.length
      ? intents
          .map(
            (i) =>
              `- ${fmtBrt(i.created_at)}: ${i.category}/${i.sub_intent ?? "—"} (conf=${i.confidence})${i.entities ? ` ent=${JSON.stringify(i.entities)}` : ""}`,
          )
          .join("\n")
      : "(nenhuma)",
    "",
    lastIntent ? `Intenção mais recente: **${lastIntent.category}/${lastIntent.sub_intent ?? "—"}** — use isso como pista do que o lead acabou de pedir.` : "",
  ].filter(Boolean).join("\n");
}

// `buildHistoryAsUserMessage` foi removido: o histórico agora é serializado em
// roles nativos via `_shared/history-builder.ts#buildNativeHistory`.

// ────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const { lead_id, conversation_id, trigger = "manual", mode = "shadow" } = body as {
    lead_id?: string;
    conversation_id?: string;
    trigger?: string;
    mode?: "shadow" | "live";
  };

  if (!lead_id) {
    return new Response(JSON.stringify({ error: "lead_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let runId: string | null = null;
  try {
    // Guard: respeita Humano-no-loop. Se a conversa-alvo (ou qualquer conversa
    // do lead, quando conversation_id não veio) está em human_takeover, não rode.
    {
      let humanOn = false;
      if (conversation_id) {
        const { data: c } = await supabase
          .from("conversations")
          .select("human_takeover")
          .eq("id", conversation_id)
          .maybeSingle();
        humanOn = !!c?.human_takeover;
      } else {
        const { data: cs } = await supabase
          .from("conversations")
          .select("id")
          .eq("lead_id", lead_id)
          .eq("human_takeover", true)
          .limit(1);
        humanOn = !!(cs && cs.length > 0);
      }
      if (humanOn) {
        console.log(`sdr-agent: skip (human_takeover) lead=${lead_id} conv=${conversation_id || "any"}`);
        return new Response(JSON.stringify({ ok: true, skipped: "human_takeover" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }


    const ctx = await loadContext(lead_id);


    // Lock por lead em modo live: se já existe um sdr_agent_runs status='running'
    // para este lead nos últimos 90s, pula esta execução (evita 2 respostas paralelas
    // se algo escapar do debounce ou se o cron disparar duas vezes em sequência).
    if (mode === "live") {
      const since = new Date(Date.now() - 90_000).toISOString();
      const { data: ongoing } = await supabase
        .from("sdr_agent_runs")
        .select("id, created_at")
        .eq("lead_id", lead_id)
        .eq("status", "running")
        .gte("created_at", since)
        .limit(1);

      if (ongoing && ongoing.length > 0) {
        console.log(`sdr-agent: skip (already running) lead=${lead_id}`);
        return new Response(JSON.stringify({ ok: true, skipped: "already_running" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Create run record
    const { data: run } = await supabase
      .from("sdr_agent_runs")
      .insert({
        company_id: ctx.lead.company_id,
        lead_id,
        conversation_id: conversation_id ?? null,
        trigger,
        mode,
        status: "running",
        model: MODEL,
      })
      .select("id")
      .single();
    runId = run?.id ?? null;


    // Pre-extract date_preference from the latest inbound message and merge into lead_memory.
    // This guarantees the LLM sees the window even when it would fail to parse it itself.
    try {
      const lastInbound = [...ctx.messages].reverse().find((m) => m.direction === "inbound");
      if (lastInbound?.content) {
        const hint = extractDateRangeFromText(lastInbound.content);
        if (hint && (hint.start_after || hint.end_before)) {
          const existing = ((ctx.memory?.facts as Record<string, unknown> | undefined)?.date_preference ?? null) as
            | null
            | { start_after?: string; end_before?: string; raw?: string };
          const changed =
            !existing ||
            existing.start_after !== hint.start_after ||
            existing.end_before !== hint.end_before;
          if (changed) {
            const newPref = {
              start_after: hint.start_after,
              end_before: hint.end_before,
              raw: lastInbound.content.slice(0, 200),
              source: hint.reason,
            };
            const mergedFacts = { ...((ctx.memory?.facts as Record<string, unknown>) ?? {}), date_preference: newPref };
            await supabase.from("lead_memory").upsert(
              {
                lead_id,
                company_id: ctx.lead.company_id,
                facts: mergedFacts,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "lead_id" },
            );
            ctx.memory = { ...(ctx.memory ?? { summary: null }), facts: mergedFacts } as typeof ctx.memory;
            console.log("sdr-agent pre-extracted date_preference:", newPref);
          }
        }
      }
    } catch (e) {
      console.error("date pre-extraction failed:", e);
    }

    // ── Fase 3: estado estruturado calculado em código ────────────
    const lastInbound = lastInboundContent(ctx.messages);
    const factsNow = (ctx.memory?.facts ?? {}) as Record<string, unknown>;
    const state: StructuredState = computeState({
      hasInbound: !!lastInbound,
      lastInbound,
      lastIntent: ctx.intents[0] ?? null,
      factsOfferedSlotsPending: (factsNow.offered_slots_pending ?? null) as any,
      heldSlots: (ctx.heldSlots ?? []) as any,
      activeBookings: (ctx.activeBookings ?? []) as any,
      datePreference: (factsNow.date_preference ?? null) as any,
      matchesSlotRef: matchesSlotReference,
      isLikelyConfirmation,
    });
    console.log("sdr-agent state:", JSON.stringify({
      stage: state.conversation_stage,
      allowed: state.allowed_actions,
      finalize_allowed: state.finalize_allowed,
      pending: state.pending_action,
    }));

    // ── Fase 4: Intent classifier → Entity extractor → Policy engine ───
    // Bookings remarcados (status='rescheduled') continuam reservando o horário
    // no Cal.com — devem contar como ativo. Apenas cancelled/no_show/completed
    // liberam o slot.
    const activeBookingRow = (ctx.activeBookings ?? []).find(
      (b: any) => b.status === "confirmed" || b.status === "pending" || b.status === "rescheduled",
    );
    const offeredSlotsNow: string[] = Array.isArray((factsNow.offered_slots_pending as any)?.slots)
      ? ((factsNow.offered_slots_pending as any).slots as string[])
      : [];
    const heldSlotIsos: string[] = (ctx.heldSlots ?? [])
      .filter((h: any) => h.status === "held")
      .map((h: any) => h.slot_datetime as string);

    const intentResult = await classifyIntent({
      lastInbound,
      recentHistory: ctx.messages.map((m) => ({ direction: m.direction, content: m.content })),
      state: {
        hasActiveBooking: !!activeBookingRow,
        activeBookingAt: activeBookingRow?.scheduled_at ?? null,
        offeredSlots: offeredSlotsNow,
      },
    });

    const entities = extractEntities({
      lastInbound,
      offeredSlots: offeredSlotsNow,
      heldSlots: heldSlotIsos,
      activeBookingAt: activeBookingRow?.scheduled_at ?? null,
      matchesSlotRef: matchesSlotReference,
    });

    // ── Fallback LLM: nome do referral quando o regex não capturou ──
    // O extractor marca `name_needs_llm=true` quando detecta CONTEXTO de
    // nome ("fala com a Dra.", "quem cuida disso é …") mas não consegue
    // extrair um nome completo confiável. Custa ~1 chamada barata
    // (gemini-flash) só nesse caso — não em todo inbound.
    try {
      const rcInit = entities.referral_contact;
      if (rcInit?.name_needs_llm && !rcInit.name) {
        const shouldCall = !!(rcInit.redirect_signal || rcInit.email || rcInit.phone)
          || true; // Sempre que houver contexto de nome, tentar — barato.
        if (shouldCall) {
          const { data: nameResp, error: nameErr } = await supabase.functions.invoke(
            "extract-referral-name",
            { body: { text: lastInbound } },
          );
          if (nameErr) {
            console.warn("sdr-agent extract-referral-name failed:", nameErr);
          } else if (nameResp?.name && nameResp.confidence === "high") {
            (entities.referral_contact as any).name = String(nameResp.name).trim();
            console.log("sdr-agent referral name (llm):", nameResp.name);
          } else {
            console.log("sdr-agent referral name (llm) inconclusive:", nameResp);
          }
        }
        delete (entities.referral_contact as any).name_needs_llm;
      }
    } catch (e) {
      console.warn("sdr-agent referral name llm fallback error:", e);
    }


    // ── Fallback: herdar emails de convidados do histórico recente ──
    // Quando o lead já passou emails em turnos anteriores (intent=add_guests)
    // e a inbound atual é só uma clarificação ("esse é outro Eduardo"),
    // o detector de entidades do turno atual devolve []. Sem isso, o policy
    // engine força allowed_tools=["finalize"] e o LLM "mente" dizendo que
    // incluiu sem que `add_guests_to_active_booking` jamais rode.
    if (intentResult.intent === "add_guests" && entities.guest_emails.length === 0) {
      const leadEmailLc = String((ctx.lead as any)?.email || "").toLowerCase();
      const EMAIL_RE_G = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;
      const recentInbound = [...ctx.messages]
        .filter((m: any) => m.direction === "inbound")
        .slice(-6);
      const fromHistory: string[] = [];
      for (const m of recentInbound) {
        const ems = (String(m.content || "").match(EMAIL_RE_G) || []).map((e) => e.toLowerCase());
        for (const e of ems) if (e && e !== leadEmailLc && !fromHistory.includes(e)) fromHistory.push(e);
      }
      if (fromHistory.length > 0) {
        console.log("sdr-agent guest_emails inherited from history:", fromHistory);
        (entities as any).guest_emails = fromHistory;
      }
    }


    // ── Referral: persistir/hidratar nome pendente do indicado ──
    // Caso 1: lead disse o NOME mas ainda não passou contato → salva em facts
    //         para usarmos quando o e-mail/telefone chegar nos turnos seguintes.
    // Caso 2: lead passou contato sem nome agora, mas existe um nome salvo
    //         de turnos anteriores → hidrata o entity para create_new_contact
    //         usar o nome certo (e não derivar do e-mail).
    // Correção: nome NOVO sempre tem prioridade sobre o salvo (lead corrige).
    try {
      const rc = entities.referral_contact;
      const hasContact = !!(rc && (rc.email || rc.phone));
      const factsRef = (ctx.memory?.facts ?? {}) as Record<string, unknown>;
      const savedName = typeof factsRef.referral_pending_name === "string"
        ? (factsRef.referral_pending_name as string)
        : null;

      if (rc?.name && !hasContact) {
        // Persiste o nome novo (ou correção) para uso futuro.
        if (savedName !== rc.name) {
          const merged = { ...factsRef, referral_pending_name: rc.name };
          await supabase.from("lead_memory").upsert(
            { lead_id, company_id: ctx.lead.company_id, facts: merged, updated_at: new Date().toISOString() },
            { onConflict: "lead_id" },
          );
          ctx.memory = { ...(ctx.memory ?? { summary: null }), facts: merged } as typeof ctx.memory;
          console.log("sdr-agent referral_pending_name persisted:", rc.name);
        }
      } else if (hasContact) {
        if (!rc!.name && savedName) {
          (entities.referral_contact as any).name = savedName;
          console.log("sdr-agent referral_pending_name hydrated:", savedName);
        }
        // Após criar o contato (forced_tool=create_new_contact rodará logo abaixo),
        // limpamos o nome pendente para não vazar pra próximas indicações.
        if (factsRef.referral_pending_name) {
          const merged = { ...factsRef };
          delete (merged as any).referral_pending_name;
          await supabase.from("lead_memory").upsert(
            { lead_id, company_id: ctx.lead.company_id, facts: merged, updated_at: new Date().toISOString() },
            { onConflict: "lead_id" },
          );
          ctx.memory = { ...(ctx.memory ?? { summary: null }), facts: merged } as typeof ctx.memory;
        }
      }
    } catch (e) {
      console.error("referral_pending_name hydration failed:", e);
    }

    // ── Captura: lead acabou de enviar o e-mail que pedimos ──────────
    // Se em turno anterior o SDR pediu o e-mail (pending_email_for_slot
    // em lead_memory.facts) e a inbound atual contém um e-mail válido,
    // persistimos em leads.email, limpamos a flag e injetamos um hint
    // pra o LLM disparar book_slot de novo no MESMO turno.
    try {
      const factsRef = (ctx.memory?.facts ?? {}) as Record<string, unknown>;
      const pending = factsRef.pending_email_for_slot as
        | { slot_iso?: string; hold_id?: string | null }
        | undefined;
      if (pending && typeof pending === "object") {
        const m = String(lastInbound || "").match(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i);
        const found = m?.[0]?.toLowerCase() ?? "";
        if (found && !/^noreply\+/i.test(found)) {
          await supabase.from("leads").update({ email: found }).eq("id", lead_id);
          (ctx.lead as any).email = found;
          const merged = { ...factsRef };
          delete (merged as any).pending_email_for_slot;
          // Persiste flag com TTL pra sobreviver caso o LLM ignore o hint
          // e mande mensagem sem reservar — assim no próximo turno a gente
          // ainda sabe que o slot foi acordado.
          (merged as any).email_just_resolved_slot = {
            slot_iso: pending.slot_iso ?? null,
            hold_id: pending.hold_id ?? null,
            email: found,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          };
          await supabase.from("lead_memory").upsert(
            { lead_id, company_id: ctx.lead.company_id, facts: merged, updated_at: new Date().toISOString() },
            { onConflict: "lead_id" },
          );
          ctx.memory = { ...(ctx.memory ?? { summary: null }), facts: merged } as typeof ctx.memory;
          (ctx as any).pending_email_resolved = {
            slot_iso: pending.slot_iso ?? null,
            hold_id: pending.hold_id ?? null,
            email: found,
          };
          console.log("sdr-agent: captured lead email and cleared pending_email_for_slot:", found);
        }
      }
      // Hidratação: se não acabou de chegar mas ainda há um flag persistido
      // não-expirado, restaurar pending_email_resolved.
      if (!(ctx as any).pending_email_resolved) {
        const stash = (ctx.memory?.facts as Record<string, unknown> | undefined)?.email_just_resolved_slot as
          | { slot_iso?: string; hold_id?: string | null; email?: string; expires_at?: string }
          | undefined;
        if (stash?.slot_iso && stash?.expires_at && new Date(stash.expires_at).getTime() > Date.now()) {
          (ctx as any).pending_email_resolved = {
            slot_iso: stash.slot_iso,
            hold_id: stash.hold_id ?? null,
            email: stash.email ?? "",
          };
        }
      }
    } catch (e) {
      console.error("pending_email_for_slot capture failed:", e);
    }





    // Heurística leve para a Policy: o lead tem pergunta pendente?
    // Nossa última explicação foi curta? — usado pelo branch referral
    // para priorizar responder antes de coletar contato.
    const pendingQRe = /(\?|\bcomo\b|funciona|explica|me\s+conta|exemplo|diferen[cç]|pre[çc]o|valor|prazo|integra|pra\s+que|para\s+que\s+serve|o\s+que\s+[ée])/i;
    const lastOutboundLen = (lastOutboundContent(ctx.messages) || "").length;
    const policy = decidePolicy({
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      entities,
      state: {
        has_active_booking: !!activeBookingRow,
        active_booking_at: activeBookingRow?.scheduled_at ?? null,
        active_booking_uid: activeBookingRow?.calcom_booking_uid ?? null,
        offered_slots: offeredSlotsNow,
        held_slots: heldSlotIsos,
      },
      context: {
        last_inbound_has_pending_question: pendingQRe.test(lastInbound || ""),
        last_outbound_short: lastOutboundLen > 0 && lastOutboundLen < 200,
        implicit_single_offer_iso: implicitOfferFromOutbound(
          lastOutboundContent(ctx.messages) || "",
          Array.from(new Set([...offeredSlotsNow, ...heldSlotIsos])),
        ),
      },
    });

    // Override: lead acabou de mandar o e-mail pendente → força book_slot
    // com o slot já acordado, independente do intent classificado.
    const _per = (ctx as any).pending_email_resolved as { slot_iso?: string } | undefined;
    if (_per?.slot_iso) {
      (policy as any).stage = "scheduling_confirming_now";
      (policy as any).allowed_tools = ["book_slot", "finalize"];
      (policy as any).forced_tool = "book_slot";
      (policy as any).forced_args = { slot_start: _per.slot_iso };
      (policy as any).reason = "email_just_resolved_for_pending_slot";
    }




    console.log("sdr-agent pipeline:", JSON.stringify({
      intent: intentResult.intent,
      conf: intentResult.confidence,
      selected: entities.selected_slot_iso,
      stage: policy.stage,
      forced: policy.forced_tool,
      allowed: policy.allowed_tools,
    }));

    // Filter the TOOLS exposed to the LLM to the policy-allowed subset.
    const TOOLS_ALLOWED = TOOLS.filter((t) =>
      (policy.allowed_tools as string[]).includes(t.function.name),
    );



    const { fetchAnnotationsContext } = await import("../_shared/annotations-context.ts");
    const annotationsBlock = await fetchAnnotationsContext(supabase, {
      companyId: (ctx as any).company_id ?? ctx.lead?.company_id,
      leadId: (ctx as any).lead_id ?? ctx.lead?.id ?? null,
    });

    const sys =
      buildSystemPrompt(ctx) + "\n\n" +
      renderStateBlock(state) + "\n\n" +
      renderPolicyBlock(policy) +
      annotationsBlock;
    const nativeHistory = buildNativeHistory(ctx.messages);

    const messages: ChatMessage[] = [
      { role: "system", content: sys },
      ...nativeHistory,
      {
        role: "user",
        content:
          `=== TAREFA (turno atual) ===\n` +
          `Intent classificada: ${intentResult.intent} (conf=${intentResult.confidence.toFixed(2)}).\n` +
          `Stage: ${policy.stage}. ` +
          (policy.forced_tool
            ? `A tool ${policy.forced_tool} já será executada — você precisa apenas redigir a mensagem final.`
            : `Use SOMENTE tools listadas em allowed_tools. Termine com finalize.`),
      },
    ];


    const steps: Array<Record<string, unknown>> = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let finalDecision: Record<string, unknown> | null = null;
    // Watchdog: contagem de falhas por tool com `downgrade`. Se a mesma tool
    // falhar 2× e tiver `suggested_message`, finaliza automaticamente para evitar
    // loop infinito (que mata a function por timeout sem gravar status).
    const toolFailureCount = new Map<string, number>();
    let lastDowngradeSuggestion: { tool: string; message: string } | null = null;

    // Fase 7: snapshot inicial do turno (estado estruturado + preview do prompt).
    const truncate = (s: unknown, n = 600) => {
      const str = typeof s === "string" ? s : JSON.stringify(s);
      return str.length > n ? str.slice(0, n) + `…[+${str.length - n}]` : str;
    };
    const messagesPreview = messages.map((m) => ({
      role: m.role,
      content_preview: truncate(m.content ?? ""),
      tool_call_id: (m as any).tool_call_id,
      tool_calls: (m as any).tool_calls?.map((c: any) => ({ name: c.function?.name, id: c.id })),
    }));
    steps.push({
      event: "turn_context",
      structured_state: state,
      allowed_actions: state.allowed_actions,
      finalize_allowed: state.finalize_allowed,
      pending_action: state.pending_action,
      intent: { intent: intentResult.intent, confidence: intentResult.confidence, reasoning: intentResult.reasoning },
      entities,
      policy: { stage: policy.stage, allowed_tools: policy.allowed_tools, forced_tool: policy.forced_tool, reason: policy.reason },
      messages_sent: messagesPreview,
      facts_in: factsNow,
    });

    // ── Post-actions WITHOUT forced tool ──────────────────────────
    // Algumas decisões (ex.: add_guests com booking ativo) não têm forced_tool
    // mas precisam rodar side-effects determinísticos antes do LLM escrever.
    let postActionFailures: Array<{ action: string; error: string; user_message?: string }> = [];
    if (!policy.forced_tool && (policy as any).post_actions?.length > 0) {
      const paRes = await runPostActions(policy, { lead_id, ctx, conversation_id, mode, entities, steps });
      postActionFailures = paRes.failures;
      // Injeta nota para o LLM saber que a side-effect falhou e ajustar a mensagem.
      for (const f of postActionFailures) {
        messages.push({
          role: "user",
          content:
            `⚠️ SIDE-EFFECT FALHOU: ${f.action} — ${f.error}.\n` +
            `NÃO confirme ao lead que a ação foi concluída. ` +
            (f.user_message
              ? `Use ESTA mensagem (ou equivalente honesto): "${f.user_message}"`
              : `Explique brevemente que houve uma instabilidade e que você tentará novamente.`),
        });
      }
    }

    // ── Forced tool short-circuit ─────────────────────────────────
    // When the Policy Engine determined a unique path, execute the tool here
    // and feed the result back as a tool message before letting the LLM only
    // write the user-facing confirmation.
    if (policy.forced_tool && policy.forced_args) {
      const ft0 = Date.now();
      let forcedToolName = policy.forced_tool;
      let forcedArgs = policy.forced_args;
      let result = await execTool(forcedToolName, forcedArgs, {
        lead_id, company_id: ctx.lead.company_id, conversation_id: conversation_id ?? null, mode,
      });

      // ── Auto-downgrade: book_slot rejeitado por booking ativo → reschedule_booking.
      // Espelha o downgrade reverso (reschedule→book em booking_not_found) e cobre
      // o caso em que o estado local não reflete o booking real no Cal.com.
      const r0 = result as any;
      if (
        forcedToolName === "book_slot" &&
        r0 && r0.ok === false &&
        (r0.error_code === "active_booking_conflict" || r0.downgrade === "use_reschedule")
      ) {
        console.log("[sdr-agent] book_slot→reschedule_booking downgrade (active_booking_conflict)");
        const reschedArgs = { slot_start: (forcedArgs as any).slot_start };
        const reschedResult = await execTool("reschedule_booking", reschedArgs, {
          lead_id, company_id: ctx.lead.company_id, conversation_id: conversation_id ?? null, mode,
        });
        forcedToolName = "reschedule_booking";
        forcedArgs = reschedArgs;
        result = { ...(reschedResult as object), downgraded_from: "book_slot" };
      }

      const synthCallId = `forced_${forcedToolName}_${Date.now()}`;
      messages.push({
        role: "assistant",
        content: "",
        tool_calls: [{
          id: synthCallId,
          type: "function",
          function: { name: forcedToolName, arguments: JSON.stringify(forcedArgs) },
        }],
      });
      messages.push({
        role: "tool",
        tool_call_id: synthCallId,
        name: forcedToolName,
        content: JSON.stringify(result),
      });
      steps.push({
        event: "forced_tool_call",
        tool: forcedToolName,
        args: forcedArgs,
        result,
        latency_ms: Date.now() - ft0,
      });

      // ── Post-actions: deterministic side-effects after the forced tool ──
      const paResForced = await runPostActions(policy, { lead_id, ctx, conversation_id, mode, entities, steps });
      postActionFailures.push(...paResForced.failures);
      for (const f of paResForced.failures) {
        messages.push({
          role: "user",
          content:
            `⚠️ SIDE-EFFECT FALHOU: ${f.action} — ${f.error}.\n` +
            `NÃO confirme ao lead que a ação foi concluída. ` +
            (f.user_message
              ? `Use ESTA mensagem (ou equivalente honesto): "${f.user_message}"`
              : `Explique brevemente que houve uma instabilidade e que você tentará novamente.`),
        });
      }



      // If the forced tool failed gracefully with a suggested_message, finalize immediately.
      const r = result as any;
      if (r && r.ok === false) {
        const honestByTool: Record<string, string> = {
          cancel_booking: "Tive um problema técnico aqui pra processar o cancelamento agora. Anotei seu pedido e vou tentar de novo em alguns minutos — confirmo assim que conseguir. Tudo bem?",
          reschedule_booking: "Tive um problema técnico pra remarcar agora. Sua reunião segue no horário atual. Vou tentar de novo e te confirmo em seguida.",
          book_slot: "Não consegui confirmar esse horário agora. Pode me mandar outro dia/horário que funcione pra você? Vou tentar de novo.",
        };
        const pendingEmailResolvedForFailure = (ctx as any).pending_email_resolved as { slot_iso?: string } | undefined;
        const requestedForcedSlot = typeof (forcedArgs as any)?.slot_start === "string" ? String((forcedArgs as any).slot_start) : "";
        const emailResolvedNoConfirmationFailure = forcedToolName === "book_slot" &&
          r.error_code === "no_confirmation" &&
          pendingEmailResolvedForFailure?.slot_iso &&
          requestedForcedSlot &&
          Math.abs(new Date(pendingEmailResolvedForFailure.slot_iso).getTime() - new Date(requestedForcedSlot).getTime()) < 5 * 60_000;
        const fallbackMsg = emailResolvedNoConfirmationFailure
          ? "Recebi seu e-mail. Tive uma instabilidade para confirmar no calendário agora; vou tentar novamente e te confirmo em seguida."
          : typeof r.suggested_message === "string" && r.suggested_message
          ? r.suggested_message
          : (honestByTool[forcedToolName] || "Tive um problema técnico aqui agora. Vou tentar de novo em alguns minutos.");
        finalDecision = {
          decision: "send_message",
          message: fallbackMsg,
          rationale: `Forced ${forcedToolName} failed: ${r.error_code ?? r.downgrade ?? r.error ?? "unknown"}.`,
          tool_failure: {
            tool: forcedToolName,
            error: String(r.error_code ?? r.downgrade ?? r.error ?? "unknown"),
          },
        } as any;
      } else if (r && r.ok && typeof r.message_suggestion === "string") {
        // Happy path: ask LLM ONE turn to either echo or refine the suggestion.
        messages.push({
          role: "user",
          content:
            `Tool ${forcedToolName} executou com sucesso. Chame APENAS finalize com decision=send_message ` +
            `e message igual (ou levemente personalizada) a: "${r.message_suggestion}". Não chame outras tools.`,
        });
      }
    }


    for (let step = 0; step < MAX_STEPS && !finalDecision; step++) {
      const t0 = Date.now();
      const res = await chatCompletion({
        model: MODEL,
        messages,
        tools: TOOLS_ALLOWED,
        tool_choice: "auto",
        temperature: 0.3,
      });
      const modelLatency = Date.now() - t0;

      const choice = res.choices[0];
      const msg = choice.message;
      totalPromptTokens += res.usage?.prompt_tokens ?? 0;
      totalCompletionTokens += res.usage?.completion_tokens ?? 0;

      steps.push({
        step,
        event: "model_response",
        finish_reason: choice.finish_reason,
        latency_ms: modelLatency,
        usage: res.usage ?? null,
        text: truncate(msg.content ?? ""),
        tool_calls: msg.tool_calls?.map((c: any) => ({
          id: c.id,
          name: c.function?.name,
          args_preview: truncate(c.function?.arguments ?? "", 400),
        })) ?? null,
      });

      // Append assistant message
      messages.push({
        role: "assistant",
        content: (msg.content as string) ?? "",
        tool_calls: msg.tool_calls,
      });

      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        const rawText = (msg.content as string) ?? "";
        const requiredToolByPending: Record<string, string> = {
          answer_with_kb: "search_knowledge",
          offer_slots: "check_calendar",
          offer_new_slots: "check_calendar",
          book_then_confirm: "book_slot",
          reschedule_then_confirm: "reschedule_booking",
          cancel_then_confirm: "cancel_booking",
        };
        const forcedTool = state.finalize_allowed
          ? "finalize"
          : (state.pending_action && requiredToolByPending[state.pending_action]) || "finalize";
        steps.push({ step, event: "tool_retry", raw: truncate(rawText), forced: forcedTool, stage: state.conversation_stage });
        try {
          const tRetry0 = Date.now();
          const retry = await chatCompletion({
            model: MODEL,
            messages: [
              ...messages,
              {
                role: "user",
                content: forcedTool === "finalize"
                  ? `Você terminou sem chamar uma tool. Converta sua última resposta em uma chamada de \`finalize\` agora ` +
                    `(decision: send_message, offer_slots, escalate_to_human, etc.) usando o texto que escreveu como \`message\`. ` +
                    `Não adicione comentários — apenas chame a tool.`
                  : `Você respondeu em texto mas o estado deste turno exige a tool \`${forcedTool}\` (pending_action=${state.pending_action}). ` +
                    `Chame \`${forcedTool}\` agora com os argumentos corretos. Não use \`finalize\` nem responda em texto livre.`,
              },
            ],
            tools: TOOLS_ALLOWED,
            tool_choice: { type: "function", function: { name: forcedTool } } as unknown as "auto",
            temperature: 0.1,
          });
          const retryLatency = Date.now() - tRetry0;
          totalPromptTokens += retry.usage?.prompt_tokens ?? 0;
          totalCompletionTokens += retry.usage?.completion_tokens ?? 0;
          const rcall = retry.choices[0]?.message?.tool_calls?.[0];
          if (rcall && rcall.function.name === forcedTool) {
            let rargs: Record<string, unknown> = {};
            try { rargs = JSON.parse(rcall.function.arguments || "{}"); } catch { rargs = {}; }
            if (forcedTool === "finalize") {
              finalDecision = rargs;
              steps.push({ step, event: "tool_retry_finalize_ok", latency_ms: retryLatency, args: rargs });
            } else {
              messages.push({ role: "assistant", content: "", tool_calls: rcall ? [rcall] : undefined });
              const tt0 = Date.now();
              const tresult = await execTool(forcedTool, rargs, {
                lead_id, company_id: ctx.lead.company_id, conversation_id: conversation_id ?? null, mode,
              });

              steps.push({
                step, event: "tool_call",
                tool: forcedTool, args: rargs, result: tresult,
                latency_ms: Date.now() - tt0,
                idempotency_key: (tresult as any)?.idempotency_key ?? null,
                forced: true,
              });
              messages.push({ role: "tool", tool_call_id: rcall.id, name: forcedTool, content: JSON.stringify(tresult) });
              continue;
            }
          }
        } catch (e) {
          steps.push({ step, event: "tool_retry_failed", error: String(e) });
        }
        if (!finalDecision) {
          finalDecision = rawText
            ? { decision: "send_message", message: rawText, channel: "whatsapp", rationale: "fallback: modelo não chamou tool" }
            : { decision: "silence", rationale: "Modelo não chamou tool e não produziu texto" };
        }
        break;
      }

      let finalized = false;
      for (const call of calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments || "{}");
        } catch {
          parsedArgs = {};
        }
        const tc0 = Date.now();
        const result = await execTool(call.function.name, parsedArgs, {
          lead_id,
          company_id: ctx.lead.company_id,
          conversation_id: conversation_id ?? null,
          mode,
        });

        steps.push({
          step, event: "tool_call",
          tool: call.function.name,
          args: parsedArgs,
          result,
          latency_ms: Date.now() - tc0,
          idempotency_key: (result as any)?.idempotency_key ?? null,
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });

        if (call.function.name === "finalize") {
          finalDecision = parsedArgs;
          finalized = true;
        } else {
          // Watchdog: detectar tool failures repetidas com downgrade.
          const r = result as any;
          if (r && r.ok === false && typeof r.suggested_message === "string" && r.suggested_message) {
            const key = call.function.name;
            const next = (toolFailureCount.get(key) ?? 0) + 1;
            toolFailureCount.set(key, next);
            lastDowngradeSuggestion = { tool: key, message: r.suggested_message };
            if (next >= 2) {
              steps.push({
                step,
                event: "watchdog_force_finalize",
                tool: key,
                failures: next,
                reason: "repeated_tool_failure_with_downgrade",
              });
              finalDecision = {
                decision: "send_message",
                channel: undefined,
                message: r.suggested_message,
                rationale: `Watchdog: ${key} falhou ${next}× com downgrade=${r.downgrade}. Usando suggested_message.`,
              };
              finalized = true;
              break;
            }
          }
        }
      }
      if (finalized) break;
    }

    if (!finalDecision) {
      // Fallback final: nunca terminar em silêncio se houve tentativa de tool.
      // Usa última suggested_message conhecida ou pede para o lead reenviar.
      if (lastDowngradeSuggestion) {
        finalDecision = {
          decision: "send_message",
          message: lastDowngradeSuggestion.message,
          rationale: `MAX_STEPS atingido; usando suggested_message de ${lastDowngradeSuggestion.tool}.`,
        };
      } else {
        // Procura por qualquer tool_call que tenha falhado no histórico de steps.
        const hadFailedTool = steps.some((s) =>
          (s.event === "tool_call" || s.event === "forced_tool_call") &&
          (s as any).result && (s as any).result.ok === false,
        );
        if (hadFailedTool) {
          finalDecision = {
            decision: "send_message",
            message:
              "Tive um problema técnico aqui agora pra processar sua solicitação. Vou tentar de novo em alguns minutos e te confirmo em seguida.",
            rationale: "MAX_STEPS atingido sem finalize; tools falharam — evitando silêncio.",
          };
        } else {
          finalDecision = { decision: "silence", rationale: "MAX_STEPS atingido sem finalize" };
        }
      }
    }

    // Fase 7: snapshot final (state_delta + mensagem efetiva).
    try {
      const { data: memAfter } = await supabase
        .from("lead_memory").select("facts").eq("lead_id", lead_id).maybeSingle();
      const factsAfter = (memAfter?.facts ?? {}) as Record<string, unknown>;
      const stateDelta: Record<string, { before: unknown; after: unknown }> = {};
      const keys = new Set([...Object.keys(factsNow ?? {}), ...Object.keys(factsAfter ?? {})]);
      for (const k of keys) {
        const a = (factsNow as any)?.[k];
        const b = (factsAfter as any)?.[k];
        if (JSON.stringify(a) !== JSON.stringify(b)) stateDelta[k] = { before: a, after: b };
      }
      steps.push({
        event: "turn_finalized",
        decision: (finalDecision as any)?.decision,
        final_message: truncate((finalDecision as any)?.message ?? "", 1000),
        state_delta: stateDelta,
      });
    } catch (_) { /* best-effort */ }



    await supabase
      .from("sdr_agent_runs")
      .update({
        status: "succeeded",
        steps,
        final_output: finalDecision,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        total_tokens: totalPromptTokens + totalCompletionTokens,
        latency_ms: Date.now() - started,
      })
      .eq("id", runId!);

    // LIVE mode: traduzir finalDecision em ações reais (envio, handoff, etc).
    let liveResult: Record<string, unknown> | null = null;
    if (mode === "live" && finalDecision) {
      try {
        const decision = String(finalDecision.decision || "");
        if (decision === "send_message") {
          let msg = String((finalDecision as any).message || "").trim();
          // ── SAFETY NET pós-action: se add_guests_to_active_booking falhou,
          // sobrescreve a mensagem para não enganar o lead.
          const guestFail = postActionFailures.find((f) => f.action === "add_guests_to_active_booking");
          if (guestFail) {
            const honest = guestFail.user_message ||
              "Tive uma instabilidade aqui ao incluir o convidado. Sua reunião segue confirmada como estava — me reenvia o e-mail em alguns minutos que eu tento de novo.";
            // Se a mensagem do LLM ignorou o aviso e ainda promete inclusão, override.
            const PROMISES_INCLUDE = /\b(incluir|incluo|adicion(?:ar|ei|o)|conv[ií]dei|j[áa] (?:incl|adic))/i;
            if (!msg || PROMISES_INCLUDE.test(msg)) {
              console.log("[sdr-agent] safety-net: add_guests falhou — sobrescrevendo mensagem outbound");
              msg = honest;
              (finalDecision as any).message = msg;
              (finalDecision as any).rationale = `safety_net_override: add_guests failed (${guestFail.error})`;
            }
          }
          // ── SAFETY NET anti-alucinação: intent add_guests + msg promete
          // inclusão MAS nenhum add_guests_to_active_booking bem-sucedido
          // rodou neste turno → sobrescreve para evitar mentir ao lead.
          try {
            const PROMISES_INCLUDE2 = /\b(incluir|inclu[íi]|incluo|adicion(?:ar|ei|o|ado|ada)|conv[ií]dei|acabei?\s+de\s+(?:incluir|adicionar)|j[áa]\s+(?:incl|adic|est[áa]\s+no\s+convite|foi\s+inclu))/i;
            const guestActionOk = steps.some((s: any) =>
              s.event === "post_action" &&
              s.action === "add_guests_to_active_booking" &&
              !s.error && !s.skipped && !s.stage,
            );
            const guestActionFailed = postActionFailures.some((f) => f.action === "add_guests_to_active_booking");
            if (
              intentResult.intent === "add_guests" &&
              msg &&
              PROMISES_INCLUDE2.test(msg) &&
              !guestActionOk &&
              !guestActionFailed
            ) {
              console.log("[sdr-agent] safety-net: msg promete inclusão sem add_guests rodar — sobrescrevendo");
              const activeBkRow = (ctx.activeBookings || []).find((b: any) => b.status === "confirmed" || b.status === "pending");
              const honest = activeBkRow
                ? "Preciso confirmar antes — pode me reenviar o e-mail do convidado que você quer adicionar? Vou incluir agora no convite."
                : "Pode me reenviar o e-mail do convidado? Vou incluir assim que confirmar.";
              msg = honest;
              (finalDecision as any).message = msg;
              (finalDecision as any).rationale = "safety_net_override: add_guests promised but not executed";
            }
          } catch (e) {
            console.error("[sdr-agent] safety-net add_guests hallucination check failed:", e);
          }

          // ── SAFETY NET: se o texto promete cancelar e há reserva ativa
          // sem cancel_booking executado nesta run, cancela programaticamente
          // antes de enviar a mensagem.
          try {
            const PROMISES_CANCEL = /\b(vou\s+cancel(?:ar|o)|cancelei|vou\s+desmarc(?:ar|o)|desmarquei|cancelar\s+(?:nosso|o|a)\s+(?:hor[áa]rio|agendamento|reuni[ãa]o))\b/i;
            const activeBookingRow = (ctx.activeBookings || []).find((b: any) => b.status === "confirmed" || b.status === "pending");
            const cancelSucceeded = steps.some((s: any) => s.event === "tool_call" && s.tool === "cancel_booking" && s.result?.ok === true);
            if (msg && PROMISES_CANCEL.test(msg) && activeBookingRow?.calcom_booking_uid && !cancelSucceeded) {
              console.log("[sdr-agent] safety-net: cancellation promised but cancel_booking not called — invoking calcom-booking-cancel.");
              // Marcar a fonte do cancelamento ANTES de invocar o cancel,
              // para que o webhook do Cal.com não dispare acknowledge_cancellation
              // (mensagem "Vi que você cancelou...") — esse follow-up só deve
              // sair quando o próprio lead cancela pelo link.
              try {
                await supabase.from("bookings").update({
                  cancellation_source: "sdr",
                  cancellation_requested_at: new Date().toISOString(),
                }).eq("calcom_booking_uid", activeBookingRow.calcom_booking_uid);
              } catch (e) {
                console.error("[sdr-agent] safety-net: falha ao marcar cancellation_source:", e);
              }
              const idempotency_key = await buildIdempotencyKey({
                conversation_id: conversation_id ?? null, lead_id,
                action_type: "cancel", provider_booking_uid: activeBookingRow.calcom_booking_uid,
              });

              const { data: cxlData, error: cxlErr } = await supabase.functions.invoke("calcom-booking-cancel", {
                body: {
                  booking_uid: activeBookingRow.calcom_booking_uid,
                  reason: "SDR safety-net: mensagem prometia cancelamento",
                  idempotency_key,
                  lead_id,
                  conversation_id: conversation_id ?? null,
                },
              });
              steps.push({
                event: "safety_net_cancel_booking",
                ok: !cxlErr && !((cxlData as any)?.error),
                booking_uid: activeBookingRow.calcom_booking_uid,
                result: cxlData ?? null,
                error: cxlErr ? String(cxlErr) : ((cxlData as any)?.error ?? null),
              });
            }
          } catch (e) {
            console.error("[sdr-agent] safety-net cancel failed:", e);
            steps.push({ event: "safety_net_cancel_booking_error", error: String(e) });
          }

          // ── SAFETY NET: depois de qualquer cancelamento bem-sucedido (tool ou safety-net),
          // garantir que a mensagem final reabre o agendamento. Se não cita novo horário
          // nem pergunta sobre reagendamento, anexar gancho proativo.
          try {
            const cancelOk = steps.some(
              (s: any) =>
                (s.event === "tool_call" && s.tool === "cancel_booking" && s.result?.ok === true) ||
                (s.event === "safety_net_cancel_booking" && s.ok === true),
            );
            if (cancelOk && msg) {
              const HAS_RESCHEDULE_HOOK =
                /(reagend|remarc|novo\s+hor[áa]rio|outra\s+data|outro\s+dia|quando\s+(?:fica|seria|melhor|puder)|qual\s+(?:dia|hor[áa]rio)|me\s+diz(?:er)?|prefere|2\s+op(?:ç[ãa]o|ções)|duas\s+op(?:ç[ãa]o|ções))/i;
              const HAS_TIME_OFFER = /\b\d{1,2}h\d{0,2}\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\/\d{1,2}\b|\b(segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)\b/i;
              const GIVEUP = /\b(n[ãa]o\s+(quero|tenho\s+interesse|vou\s+(?:querer|seguir))|desisti|perdi\s+o\s+interesse|n[ãa]o\s+faz\s+sentido|cancela\s+tudo|n[ãa]o\s+precisa\s+remarcar)\b/i;
              let inb = "";
              try {
                const { data: convs2 } = await supabase
                  .from("conversations")
                  .select("id")
                  .eq("lead_id", lead_id);
                const convIds2 = (convs2 ?? []).map((c: any) => c.id);
                if (convIds2.length > 0) {
                  const { data: m2 } = await supabase
                    .from("messages")
                    .select("direction, content, sent_at")
                    .in("conversation_id", convIds2)
                    .eq("direction", "inbound")
                    .order("sent_at", { ascending: false })
                    .limit(1);
                  inb = String(m2?.[0]?.content || "");
                }
              } catch (_) { /* ignore */ }

              if (!GIVEUP.test(inb) && !HAS_RESCHEDULE_HOOK.test(msg) && !HAS_TIME_OFFER.test(msg)) {
                const hook = " Quer que eu já te envie 2 novos horários ou prefere me dizer qual dia fica melhor pra você?";
                const trimmed = msg.trimEnd();
                const sep = (trimmed.endsWith(".") || trimmed.endsWith("!") || trimmed.endsWith("?")) ? "" : ".";
                msg = trimmed + sep + hook;
                (finalDecision as any).message = msg;
                (finalDecision as any).rationale = ((finalDecision as any).rationale || "") + " | safety_net: post_cancel_reschedule_hook_appended";
                steps.push({ event: "safety_net_post_cancel_hook", appended: true });
                console.log("[sdr-agent] safety-net: anexei gancho de reagendamento pós-cancelamento.");
              }
            }
          } catch (e) {
            console.error("[sdr-agent] safety-net post-cancel hook failed:", e);
          }

          if (msg) {
            const { data: exec, error: execErr } = await supabase.functions.invoke("execute-action", {
              body: {
                company_id: ctx.lead.company_id,
                lead_id,
                conversation_id: conversation_id ?? null,
                action_type: "send_reply",
                params: {
                  message: msg,
                  channel: (finalDecision as any).channel || undefined,
                  _ctx: (finalDecision as any).tool_failure ? { tool_failure: (finalDecision as any).tool_failure } : undefined,
                },
              },
            });
            const sent = !execErr && (exec as any)?.result?.sent === true;
            liveResult = { action: "send_reply", ok: !execErr, sent, result: exec, error: execErr ? String(execErr) : ((exec as any)?.result?.error ?? (exec as any)?.result?.reason ?? null) };
          } else {
            liveResult = { action: "send_reply", skipped: "empty_message" };
          }
        } else if (decision === "escalate_to_human") {
          await supabase
            .from("leads")
            .update({
              handoff_required: true,
              handoff_reason: String((finalDecision as any).rationale || "Agente SDR solicitou handoff"),
              handoff_at: new Date().toISOString(),
            })
            .eq("id", lead_id);
          liveResult = { action: "handoff", ok: true };
        } else if (decision === "offer_slots") {
          // Slots já foram segurados (hold) quando o agente chamou check_calendar.
          // Aqui apenas enviamos a mensagem ao lead com os horários propostos.
          const fd = finalDecision as any;
          let msg = String(fd.message || "").trim();
          let offered: string[] = Array.isArray(fd.offered_slots)
            ? fd.offered_slots.filter((s: unknown) => typeof s === "string" && (s as string).length > 0)
            : [];

          // (1) Hard-cap: nunca mais de 2 horários por turno.
          if (offered.length > 2) {
            console.log(`offer_slots: LLM enviou ${offered.length} slots; cortando para 2`);
            offered = offered.slice(0, 2);
          }

          // (2) Validar contra holds reais ativos do lead (tolerância 5min) para
          //     descartar ISOs alucinados que nunca foram reservados.
          //     OBS: ISOs do LLM podem vir sem timezone — usar parseSlotStartAsBrt
          //     pra evitar mismatch contra slot_datetime (UTC) do banco.
          if (offered.length > 0) {
            const { data: liveHolds } = await supabase
              .from("slot_holds")
              .select("slot_datetime")
              .eq("lead_id", lead_id)
              .eq("status", "held")
              .gt("expires_at", new Date().toISOString());
            const holdMs = (liveHolds || [])
              .map((h: any) => new Date(h.slot_datetime).getTime())
              .filter((t: number) => !isNaN(t));
            const validated = offered.filter((iso) => {
              const ts = parseSlotStartAsBrt(iso);
              if (!Number.isFinite(ts)) return false;
              return holdMs.some((t: number) => Math.abs(t - ts) < 5 * 60_000);
            });
            if (validated.length !== offered.length) {
              console.log(`offer_slots: descartando ${offered.length - validated.length} slot(s) sem hold ativo`);
            }
            offered = validated;
          }

          if (offered.length === 0) {
            // Sem holds válidos — NÃO descartar a mensagem. Envia mesmo assim
            // com aviso curto pra não silenciar o turno e perder o lead.
            const fallbackMsg = (String(fd.message || "").trim() ||
              "Os horários que mencionei podem ter sido preenchidos. Me confirma qual funciona pra você e eu reservo na hora.");
            const { data: exec, error: execErr } = await supabase.functions.invoke("execute-action", {
              body: {
                company_id: ctx.lead.company_id,
                lead_id,
                conversation_id: conversation_id ?? null,
                action_type: "send_reply",
                params: { message: fallbackMsg, channel: fd.channel || undefined },
              },
            });
            const sent = !execErr && (exec as any)?.result?.sent === true;
            liveResult = { action: "offer_slots", ok: !execErr, sent, result: exec, error: "no_valid_holds_sent_anyway" };
          } else {
            // (3) Detectar divergência entre msg do LLM e ISOs validados.
            //     SEMPRE valida que cada slot oferecido aparece (dia + hora) no
            //     texto — independente de bullets — para evitar mensagens
            //     genéricas tipo "Tenho estes dois horários disponíveis" sem
            //     listar nada.
            let needRewrite = !msg;
            if (!needRewrite) {
              const tNorm = ` ${_normalizeText(msg)} `;
              const allMatched = offered.every((iso) => {
                const { day, hour } = _slotPatterns(iso);
                const dayHit = day.some((p) => tNorm.includes(_normalizeText(p)));
                const hourHit = hour.some((p) => tNorm.includes(_normalizeText(p)));
                return dayHit && hourHit;
              });
              if (!allMatched) needRewrite = true;
              const bulletCount = (msg.match(/(^|\n)\s*(•|📅|[-*])\s+/g) || []).length;
              if (bulletCount > offered.length) needRewrite = true;
            }
            if (needRewrite) {
              const formatted = offered.map((s: string) => `📅 ${formatBRTLong(s)}`).join("\n");
              msg = `Tenho estas opções disponíveis:\n\n${formatted}\n\nQual funciona melhor pra você?`;
              console.log("offer_slots: reescrevendo mensagem para coincidir com ISOs validados");
            }

            // Persistir slots oferecidos para validar a confirmação no turno seguinte.
            try {
              const facts = { ...((ctx.memory?.facts ?? {}) as Record<string, unknown>) };
              facts.offered_slots_pending = {
                slots: offered,
                offered_at: new Date().toISOString(),
              };
              const { error: memErr } = await supabase.from("lead_memory").upsert(
                { lead_id, company_id: ctx.lead.company_id, facts, updated_at: new Date().toISOString() },
                { onConflict: "lead_id" },
              );
              if (memErr) console.error("lead_memory upsert (offered_slots_pending) failed:", memErr);
              // Liberar holds antigos do lead que NÃO estejam nos novos `offered`.
              try {
                const { data: oldHolds } = await supabase
                  .from("slot_holds")
                  .select("id, slot_datetime")
                  .eq("lead_id", lead_id)
                  .eq("status", "held");
                const keep = new Set(offered.map((s) => new Date(s).getTime()));
                const stale = (oldHolds || []).filter(
                  (h: any) => !Array.from(keep).some(
                    (t) => Math.abs(new Date(h.slot_datetime).getTime() - (t as number)) < 5 * 60_000,
                  ),
                );
                if (stale.length > 0) {
                  await supabase.from("slot_holds")
                    .update({ status: "released" })
                    .in("id", stale.map((h: any) => h.id));
                }
              } catch (e) { console.error("stale slot_holds release failed:", e); }
            } catch (e) { console.error("lead_memory upsert (offered_slots_pending) threw:", e); }

            const { data: exec, error: execErr } = await supabase.functions.invoke("execute-action", {
              body: {
                company_id: ctx.lead.company_id,
                lead_id,
                conversation_id: conversation_id ?? null,
                action_type: "send_reply",
                params: { message: msg, channel: fd.channel || undefined },
              },
            });
            const sent = !execErr && (exec as any)?.result?.sent === true;
            liveResult = { action: "offer_slots", ok: !execErr, sent, result: exec, error: execErr ? String(execErr) : ((exec as any)?.result?.error ?? (exec as any)?.result?.reason ?? null) };
          }
        // book_slot / reschedule_booking / cancel_booking não são mais decisões
        // pós-finalize — viraram tools executadas DENTRO do loop do agente
        // (ver execBookingTool). Aqui só restam as decisões puramente comunicacionais.
        } else if (decision === "mark_referral") {
          // mark_referral é uma DECISÃO LEGADA. Hoje o referral correto vem por
          // forced_tool=create_new_contact + post_actions=mark_referrer. Mas o LLM
          // às vezes ainda escolhe mark_referral diretamente — quando isso acontece
          // E há texto a entregar, ENVIE a mensagem em vez de descartá-la.
          const fd = finalDecision as any;
          const msg = String(fd.message || "").trim();
          if (msg) {
            const { data: exec, error: execErr } = await supabase.functions.invoke("execute-action", {
              body: {
                company_id: ctx.lead.company_id,
                lead_id,
                conversation_id: conversation_id ?? null,
                action_type: "send_reply",
                params: { message: msg, channel: fd.channel || undefined },
              },
            });
            const sent = !execErr && (exec as any)?.result?.sent === true;
            liveResult = { action: "mark_referral", ok: !execErr, sent, result: exec, error: execErr ? String(execErr) : ((exec as any)?.result?.error ?? null) };
          } else {
            liveResult = { action: "mark_referral", ok: true, note: "no outbound (empty message)" };
          }
        } else if (decision === "silence" || decision === "schedule_followup") {
          liveResult = { action: decision, ok: true, note: "no outbound" };

        } else {
          liveResult = { action: decision, ok: false, error: "live_action_not_implemented" };
        }
      } catch (e) {
        liveResult = { ok: false, error: String(e) };
      }
      await supabase
        .from("sdr_agent_runs")
        .update({
          final_output: { ...(finalDecision as any), live: liveResult },
        })
        .eq("id", runId!);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        mode,
        decision: finalDecision,
        live: liveResult,
        steps_count: steps.length,
        tokens: totalPromptTokens + totalCompletionTokens,
        latency_ms: Date.now() - started,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("sdr-agent error", e);
    if (runId) {
      await supabase
        .from("sdr_agent_runs")
        .update({
          status: "failed",
          error: String(e),
          latency_ms: Date.now() - started,
        })
        .eq("id", runId);
    }
    return new Response(JSON.stringify({ error: String(e), run_id: runId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
