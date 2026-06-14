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
        "Cancela uma reserva ativa quando o lead pede para desmarcar SEM pedir novo horário. Não exige slot.",
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
    const facts = (args.facts ?? {}) as Record<string, unknown>;
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

  if (name === "finalize") {
    return { ok: true, decision: args };
  }

  return { error: `unknown tool: ${name}` };
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
    supabase.from("slot_holds").select("id, slot_datetime, status, expires_at").eq("lead_id", ctx.lead_id).in("status", ["held", "confirmed"]),
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

  // ── Phase 4: centralized pre-flight guards ──────────────────────
  const guard = await assertCanBook(supabase, name, args, {
    facts,
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
  if (name === "cancel_booking") {
    const bookingUid = (typeof args.booking_uid === "string" && args.booking_uid) || guard.activeBookingUid;
    if (!bookingUid) return { ok: false, error: "no active booking" };
    const reason = typeof args.reason === "string" ? args.reason : "Cliente solicitou cancelamento";
    const idempotency_key = await buildIdempotencyKey({
      conversation_id: ctx.conversation_id, lead_id: ctx.lead_id,
      action_type: "cancel", provider_booking_uid: bookingUid,
    });
    const claim = await claimCalendarAction(supabase, {
      idempotency_key, conversation_id: ctx.conversation_id, lead_id: ctx.lead_id, company_id: ctx.company_id,
      action_type: "cancel", provider_booking_uid: bookingUid,
      request_payload: { booking_uid: bookingUid, reason },
    });
    if (claim.kind === "existing") {
      return { ok: true, replayed: true, booking_uid: bookingUid, message_suggestion: "Cancelamento já confirmado anteriormente." };
    }
    try {
      await supabase.from("bookings").update({
        cancellation_source: "sdr",
        cancellation_requested_at: new Date().toISOString(),
      }).eq("calcom_booking_uid", bookingUid);
    } catch (_) {}
    const { data, error } = await supabase.functions.invoke("calcom-booking-cancel", {
      body: { booking_uid: bookingUid, reason, idempotency_key, lead_id: ctx.lead_id, conversation_id: ctx.conversation_id },
    });
    if (error || (data as any)?.error) {
      const errStr = error ? String(error) : String((data as any)?.error);
      await markCalendarActionFailed(supabase, claim.row.id, errStr);
      return { ok: false, error: errStr };
    }
    await markCalendarActionOk(supabase, claim.row.id, { provider_booking_uid: bookingUid, response_payload: (data as any) ?? {} });
    return {
      ok: true, booking_uid: bookingUid,
      message_suggestion: "Tudo bem, cancelei nossa reunião. Se quiser remarcar mais pra frente, é só me chamar.",
    };
  }

  const slotStart = guard.slotIso;

  // ── BOOK ──────────────────────────────────────────────────────
  if (name === "book_slot") {
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
    const { data: booking, error: bookErr } = await supabase.functions.invoke("calcom-confirm-booking", {
      body: { lead_id: ctx.lead_id, selected_slot_hold_id: matchedHold.id, force_placeholder: true },
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
    // Limpa offered_slots_pending da memória.
    try {
      const newFacts = { ...facts };
      if (newFacts.offered_slots_pending) {
        delete newFacts.offered_slots_pending;
        await supabase.from("lead_memory").upsert({ lead_id: ctx.lead_id, facts: newFacts }, { onConflict: "lead_id" });
      }
    } catch (_) {}
    return {
      ok: true, booking_uid: bookingUid, scheduled_at: slotStart,
      message_suggestion: `Pronto! Confirmei a reunião para ${formatBRTLong(slotStart)}. Você vai receber o convite com o link por e-mail. 🙌`,
    };
  }

  // ── RESCHEDULE ────────────────────────────────────────────────
  const bookingUid = (typeof args.booking_uid === "string" && args.booking_uid) || guard.activeBookingUid;
  if (!bookingUid) return { ok: false, error: "no active booking to reschedule" };
  const reason = typeof args.reason === "string" ? args.reason : "Cliente solicitou remarcação";
  const startIso = normalizeSlotStartIsoBrt(slotStart);
  const idempotency_key = await buildIdempotencyKey({
    conversation_id: ctx.conversation_id, lead_id: ctx.lead_id,
    action_type: "reschedule", requested_start: startIso, provider_booking_uid: bookingUid,
  });
  const claim = await claimCalendarAction(supabase, {
    idempotency_key, conversation_id: ctx.conversation_id, lead_id: ctx.lead_id, company_id: ctx.company_id,
    action_type: "reschedule", requested_start: startIso, provider_booking_uid: bookingUid,
    request_payload: { booking_uid: bookingUid, start: startIso, reason },
  });
  if (claim.kind === "existing") {
    return {
      ok: true, replayed: true, booking_uid: bookingUid, scheduled_at: startIso,
      message_suggestion: `Remarcação já confirmada para ${formatBRTLong(startIso)}.`,
    };
  }

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
    await markCalendarActionFailed(supabase, claim.row.id, errStr, {
      calcom_status: resched?.calcom_status ?? null,
      calcom_body: resched?.calcom_body ?? null,
      http_status: reschedResp.status,
    });

    // ── Auto-downgrade: booking no longer exists → fall through to book_slot.
    if (resched?.error_code === "booking_not_found") {
      console.log("[sdr-agent] reschedule→book_slot downgrade (booking_not_found):", bookingUid);
      // The pre-flight in calcom-booking-reschedule already marked the local
      // booking as cancelled, so the next book_slot guard sees no active booking.
      const bookResult = await execBookingTool("book_slot", { slot_start: slotStart }, ctx);
      // Annotate so the agent loop knows this came from a recovery path.
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
  const newUid =
    resched?.booking?.uid ??
    resched?.booking?.calcom_booking_uid ??
    resched?.booking_uid ??
    resched?.calcom_booking_uid ??
    bookingUid;
  await markCalendarActionOk(supabase, claim.row.id, { provider_booking_uid: newUid, response_payload: resched ?? {} });
  return {
    ok: true, booking_uid: newUid, scheduled_at: startIso,
    message_suggestion: `Pronto! Remarquei para ${formatBRTLong(startIso)}. Você vai receber o novo convite por e-mail. 🙌`,
  };
}


async function loadContext(leadId: string) {
  const { data: lead } = await supabase
    .from("leads")
    .select("id, company_id, name, company_name, email, phone, whatsapp, status, source, created_at")
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

function _brtParts(iso: string): { day: number; month: number; hour: number; minute: number } | null {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      day: "numeric", month: "numeric", hour: "numeric", minute: "numeric", hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
    return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
  } catch {
    return null;
  }
}

function _slotPatterns(iso: string): { day: string[]; hour: string[] } {
  const p = _brtParts(iso);
  if (!p) return { day: [], hour: [] };
  const { day, month, hour, minute } = p;
  const d = String(day), dd = String(day).padStart(2, "0");
  const m = String(month), mm = String(month).padStart(2, "0");
  const monShort = MONTH_NAMES_PT[month - 1];
  const monFull = MONTH_FULL_PT[month - 1];
  const h = String(hour), hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  const dayP = [
    `dia ${d}`, `dia ${dd}`,
    `${d}/${m}`, `${dd}/${mm}`, `${d}/${mm}`, `${dd}/${m}`,
    `${d} de ${monShort}`, `${d} de ${monFull}`,
    `${dd} de ${monShort}`, `${dd} de ${monFull}`,
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
  const { lead, company, memory, intents, heldSlots, activeBookings, enrollment, kb } = ctx;
  const activeBooking = (activeBookings || []).find((b: any) => b.status === "confirmed" || b.status === "pending");

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
    "## Reservas existentes (remarcar/cancelar)",
    "- **Agendar/remarcar/cancelar são TOOLS (`book_slot`, `reschedule_booking`, `cancel_booking`), NÃO valores de `decision` na `finalize`.** Você chama a tool, ela executa o agendamento de fato no Cal.com, retorna `{ ok, booking_uid, scheduled_at, message_suggestion }`, e SÓ ENTÃO você chama `finalize` com `decision=send_message` usando o `message_suggestion` como mensagem ao lead (ou refinando-o).",
    "- **NUNCA chame `book_slot`/`reschedule_booking` num turno onde o lead ainda NÃO escolheu explicitamente um horário que você já tinha oferecido antes.** Pedir desculpas ou pedir para 'remarcar' NÃO é confirmação de um novo horário. Se chamar prematuramente, a tool devolve `{ ok:false, downgrade:'ask_confirmation', suggested_message }` — nesse caso finalize com `send_message` e o `suggested_message`.",
    "- **Fluxo correto de PRIMEIRO agendamento (2 turnos):** (1) `check_calendar` + finalize com `offer_slots` (máx 2 horários), (2) AGUARDAR resposta. No turno SEGUINTE, quando o lead apontar UM dos horários oferecidos (ex: 'pode ser quarta 15h', 'esse mesmo', 'confirmo o primeiro'), chame a tool `book_slot({ slot_start: ISO_EXATO })` e depois `finalize({ decision: 'send_message', message: message_suggestion })`.",
    "- **Fluxo correto de REMARCAÇÃO (2 turnos):** quando existe 'Reserva ativa' e o lead pede para mudar, (1) `offer_slots` com 2 novos horários, (2) AGUARDAR. No turno SEGUINTE, quando o lead escolher, chame `reschedule_booking({ slot_start })` e depois `finalize(send_message)`.",
    "- **Interpretação de escolha curta:** respostas como 'dia 1', 'o primeiro', '9h', 'esse mesmo', 'a primeira', 'a segunda opção' SÃO confirmação válida — copie o ISO EXATO do horário oferecido para `slot_start`. Ordinais apontam a POSIÇÃO da lista oferecida. Se a referência for ambígua, peça pra esclarecer (não chame a tool).",
    "- Se o lead pede CANCELAR/desmarcar sem pedir novo horário, chame a tool `cancel_booking({ reason })` e finalize com `send_message`.",
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
    const activeBookingRow = (ctx.activeBookings ?? []).find(
      (b: any) => b.status === "confirmed" || b.status === "pending",
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
    });

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



    const sys =
      buildSystemPrompt(ctx) + "\n\n" +
      renderStateBlock(state) + "\n\n" +
      renderPolicyBlock(policy);
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

    // ── Forced tool short-circuit ─────────────────────────────────
    // When the Policy Engine determined a unique path, execute the tool here
    // and feed the result back as a tool message before letting the LLM only
    // write the user-facing confirmation.
    if (policy.forced_tool && policy.forced_args) {
      const ft0 = Date.now();
      const forcedToolName = policy.forced_tool;
      const forcedArgs = policy.forced_args;
      const result = await execTool(forcedToolName, forcedArgs, {
        lead_id, company_id: ctx.lead.company_id, conversation_id: conversation_id ?? null, mode,
      });
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

      // If the forced tool failed gracefully with a suggested_message, finalize immediately.
      const r = result as any;
      if (r && r.ok === false) {
        const fallbackMsg = typeof r.suggested_message === "string" && r.suggested_message
          ? r.suggested_message
          : "Tive uma instabilidade aqui pra confirmar esse horário. Pode me mandar outro dia/horário que funcione pra você? Vou garantir a reserva.";
        finalDecision = {
          decision: "send_message",
          message: fallbackMsg,
          rationale: `Forced ${forcedToolName} failed: ${r.error_code ?? r.downgrade ?? r.error ?? "unknown"}.`,
        };
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
              "Tive uma instabilidade aqui pra confirmar nosso horário agora. Pode me mandar de novo o dia e a hora que funciona pra você? Vou garantir a reserva.",
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
          const msg = String((finalDecision as any).message || "").trim();
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

          // (2) Validar contra holds reais ativos do lead (tolerância 60s) para
          //     descartar ISOs alucinados que nunca foram reservados.
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
              const ts = new Date(iso).getTime();
              if (isNaN(ts)) return false;
              return holdMs.some((t: number) => Math.abs(t - ts) < 60_000);
            });
            if (validated.length !== offered.length) {
              console.log(`offer_slots: descartando ${offered.length - validated.length} slot(s) sem hold ativo`);
            }
            offered = validated;
          }

          if (offered.length === 0) {
            liveResult = { action: "offer_slots", ok: false, error: "no_valid_holds" };
          } else {
            // (3) Detectar divergência entre msg do LLM e ISOs validados.
            const bulletCount = (msg.match(/(^|\n)\s*(•|📅|[-*])\s+/g) || []).length;
            let needRewrite = !msg || bulletCount > offered.length;
            if (!needRewrite && bulletCount > 0) {
              const tNorm = ` ${_normalizeText(msg)} `;
              const allMatched = offered.every((iso) => {
                const { day, hour } = _slotPatterns(iso);
                const dayHit = day.some((p) => tNorm.includes(_normalizeText(p)));
                const hourHit = hour.some((p) => tNorm.includes(_normalizeText(p)));
                return dayHit && hourHit;
              });
              if (!allMatched) needRewrite = true;
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
              await supabase.from("lead_memory").upsert(
                { lead_id, facts },
                { onConflict: "lead_id" },
              );
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
              } catch (_) { /* best effort */ }
            } catch (_) { /* best effort */ }

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
        } else if (decision === "silence" || decision === "schedule_followup" || decision === "mark_referral") {
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
