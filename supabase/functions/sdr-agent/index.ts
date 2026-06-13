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
const MAX_STEPS = 14;
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
      name: "finalize",
      description:
        "Encerra o raciocínio e devolve a decisão final: mensagem a enviar, ação (agendar/encaminhar/escalar) ou silêncio.",
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
              "book_slot",
              "reschedule_booking",
              "cancel_booking",
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
          slot_start: { type: "string", description: "Horário ISO do slot (book_slot ou reschedule_booking)" },
          booking_uid: { type: "string", description: "UID Cal.com do booking a remarcar/cancelar (opcional — se omitido, usamos a reserva ativa do lead)" },
          reason: { type: "string", description: "Motivo (reschedule_booking ou cancel_booking)" },
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
  ctx: { lead_id: string; company_id: string; conversation_id?: string | null },
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
    const fetchSlots = async (b: Record<string, unknown>): Promise<{ slots: any[]; raw: any; httpError: boolean }> => {
      const { data, error } = await supabase.functions.invoke("calcom-slots", { body: b });
      if (error) {
        // 404 with "Não há slots" payload is reported as FunctionsHttpError; treat as empty
        return { slots: [], raw: { error: String(error) }, httpError: true };
      }
      const slots = (data as any)?.slots ?? [];
      return { slots: Array.isArray(slots) ? slots : [], raw: data ?? {}, httpError: false };
    };

    try {
      const body: Record<string, unknown> = {
        company_id: ctx.company_id,
        lead_id: ctx.lead_id,
        conversation_id: ctx.conversation_id ?? undefined,
      };
      if (typeof args.start_after === "string") body.start_after = args.start_after;
      if (typeof args.end_before === "string") body.end_before = args.end_before;
      if (Array.isArray(args.exclude_datetimes)) body.exclude_datetimes = args.exclude_datetimes;
      if (Array.isArray(args.exclude_dates)) body.exclude_dates = args.exclude_dates;
      if (typeof args.days_ahead === "number" && !body.end_before && !body.start_after) {
        const start = new Date();
        const end = new Date(Date.now() + Number(args.days_ahead) * 86400000);
        body.start_after = start.toISOString();
        body.end_before = end.toISOString();
      }
      const requestedWindow = { start_after: body.start_after ?? null, end_before: body.end_before ?? null };
      const first = await fetchSlots(body);

      const hasWindow = !!(body.start_after || body.end_before);
      if (first.slots.length === 0 && hasWindow) {
        // Janela pedida vazia (ou erro 404 "sem slots") → amplia +14 dias
        const widenFrom = body.end_before ? new Date(String(body.end_before)) : new Date(String(body.start_after));
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

  if (name === "finalize") {
    return { ok: true, decision: args };
  }

  return { error: `unknown tool: ${name}` };
}


// ────────────────────────────────────────────────────────────────
// Context loader
// ────────────────────────────────────────────────────────────────
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
    "- Use update_lead_facts assim que detectar uma preferência nova (janela de data, canal, objeção, papel, urgência).",
    "- SEMPRE finalize chamando a tool `finalize`.",
    "- Português brasileiro. Mensagens curtas (2-3 parágrafos no máximo). Não use 'olá' nem 'tudo bem?' se já está no meio da conversa.",
    "",
    "## Reservas existentes (remarcar/cancelar)",
    "- Se EXISTE uma 'Reserva ativa' abaixo e o lead pede para MUDAR o horário (remarcar, adiar, antecipar, 'pode ser X em vez de Y'), use `decision=reschedule_booking` com `slot_start` = novo horário ISO e `booking_uid` da reserva ativa. NUNCA use `book_slot` quando já existe reserva ativa — isso cria reserva duplicada.",
    "- Antes de finalizar `reschedule_booking`, valide com `check_calendar` (passando start_after/end_before cobrindo o horário pedido) que o novo slot está disponível. Se não estiver, ofereça alternativas próximas via `offer_slots`.",
    "- Se o lead pede para CANCELAR/desmarcar definitivamente, use `decision=cancel_booking` com `reason` curta. Inclua `message` se ainda valer convidar a remarcar depois.",
    "- A confirmação da remarcação/cancelamento deve vir no campo `message` da finalize (vamos enviar pelo mesmo canal da conversa).",
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

function buildHistoryAsUserMessage(messages: Array<{ direction: string; content: string; created_at: string; metadata?: Record<string, unknown> | null; channel?: string | null }>): string {
  if (messages.length === 0) return "(sem histórico ainda — esta é a primeira interação)";
  return messages
    .map((m) => {
      const who = m.direction === "outbound" ? "SDR" : "Lead";
      const when = fmtBrt(m.created_at);
      const ch = m.channel ? ` ${m.channel}` : "";
      const meta = m.metadata && typeof m.metadata === "object"
        ? Object.keys(m.metadata).length
          ? ` meta=${JSON.stringify(m.metadata).slice(0, 240)}`
          : ""
        : "";
      return `[${when}${ch} ${who}]${meta}\n${m.content}`;
    })
    .join("\n\n");
}

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

    const sys = buildSystemPrompt(ctx);
    const history = buildHistoryAsUserMessage(ctx.messages);


    const messages: ChatMessage[] = [
      { role: "system", content: sys },
      {
        role: "user",
        content:
          `=== HISTÓRICO COMPLETO DA CONVERSA (mais recente por último) ===\n${history}\n\n` +
          `=== TAREFA ===\nDecida o próximo passo do SDR. ` +
          `Leia TODO o histórico acima e respeite as preferências persistentes da memória. ` +
          `Use as tools que precisar (search_knowledge, check_calendar, update_lead_facts) e termine SEMPRE com finalize.`,
      },
    ];

    const steps: Array<Record<string, unknown>> = [];
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let finalDecision: Record<string, unknown> | null = null;

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await chatCompletion({
        model: MODEL,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.3,
      });

      const choice = res.choices[0];
      const msg = choice.message;
      totalPromptTokens += res.usage?.prompt_tokens ?? 0;
      totalCompletionTokens += res.usage?.completion_tokens ?? 0;

      steps.push({
        step,
        finish_reason: choice.finish_reason,
        text: msg.content,
        tool_calls: msg.tool_calls ?? null,
      });

      // Append assistant message
      messages.push({
        role: "assistant",
        content: (msg.content as string) ?? "",
        tool_calls: msg.tool_calls,
      });

      const calls = msg.tool_calls ?? [];
      if (calls.length === 0) {
        // Modelo respondeu em texto livre sem chamar finalize.
        // Forçar uma chamada extra com tool_choice = finalize para converter o texto em decisão estruturada.
        const rawText = (msg.content as string) ?? "";
        steps.push({ step, event: "finalize_retry", raw: rawText });
        try {
          const retry = await chatCompletion({
            model: MODEL,
            messages: [
              ...messages,
              {
                role: "user",
                content:
                  `Você terminou sem chamar a tool \`finalize\`. ` +
                  `Converta sua última resposta em uma chamada de \`finalize\` agora, ` +
                  `escolhendo o \`decision\` apropriado (send_message, offer_slots, escalate_to_human, etc.) ` +
                  `e usando exatamente o texto que você escreveu como \`message\` (se for o caso de enviar mensagem). ` +
                  `Não adicione comentários — apenas chame a tool.`,
              },
            ],
            tools: TOOLS,
            tool_choice: { type: "function", function: { name: "finalize" } } as unknown as "auto",
            temperature: 0.1,
          });
          totalPromptTokens += retry.usage?.prompt_tokens ?? 0;
          totalCompletionTokens += retry.usage?.completion_tokens ?? 0;
          const rcall = retry.choices[0]?.message?.tool_calls?.[0];
          if (rcall && rcall.function.name === "finalize") {
            try {
              finalDecision = JSON.parse(rcall.function.arguments || "{}");
            } catch {
              finalDecision = null;
            }
            steps.push({ step, event: "finalize_retry_ok", args: finalDecision });
          }
        } catch (e) {
          steps.push({ step, event: "finalize_retry_failed", error: String(e) });
        }
        if (!finalDecision) {
          // Último fallback: tratar o texto livre como send_message para não perder a resposta do agente.
          finalDecision = rawText
            ? { decision: "send_message", message: rawText, channel: "whatsapp", rationale: "fallback: modelo não chamou finalize" }
            : { decision: "silence", rationale: "Modelo não chamou finalize e não produziu texto" };
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
        const result = await execTool(call.function.name, parsedArgs, {
          lead_id,
          company_id: ctx.lead.company_id,
          conversation_id: conversation_id ?? null,
        });
        steps.push({ step, tool: call.function.name, args: parsedArgs, result });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result),
        });

        if (call.function.name === "finalize") {
          finalDecision = parsedArgs;
          finalized = true;
        }
      }
      if (finalized) break;
    }

    if (!finalDecision) {
      finalDecision = { decision: "silence", rationale: "MAX_STEPS atingido sem finalize" };
    }

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
          if (!msg && Array.isArray(fd.offered_slots) && fd.offered_slots.length > 0) {
            const formatted = fd.offered_slots
              .map((s: string) => `• ${formatBRTLong(s)}`)
              .join("\n");
            msg = `Tenho estes horários disponíveis:\n\n${formatted}\n\nQual deles funciona melhor pra você?`;
          }
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
            liveResult = { action: "offer_slots", ok: !execErr, sent, result: exec, error: execErr ? String(execErr) : ((exec as any)?.result?.error ?? (exec as any)?.result?.reason ?? null) };
          } else {
            liveResult = { action: "offer_slots", ok: false, error: "no message and no offered_slots" };
          }
        } else if (decision === "book_slot") {
          const fd = finalDecision as any;
          const slotStart = String(fd.slot_start || "");
          const fallbackChannel = fd.channel || "whatsapp";

          const sendFallback = async (reason: string) => {
            try {
              await supabase
                .from("leads")
                .update({
                  handoff_required: true,
                  handoff_reason: `book_slot falhou: ${reason}`,
                  handoff_at: new Date().toISOString(),
                })
                .eq("id", lead_id);
            } catch (_) { /* best effort */ }
            try {
              await supabase.functions.invoke("execute-action", {
                body: {
                  company_id: ctx.lead.company_id,
                  lead_id,
                  conversation_id: conversation_id ?? null,
                  action_type: "send_reply",
                  params: {
                    message:
                      "Deixa eu confirmar esse horário aqui pra você e já te retorno em instantes. ",
                    channel: fallbackChannel,
                  },
                },
              });
            } catch (_) { /* best effort */ }
          };

          if (!slotStart) {
            await sendFallback("missing slot_start");
            liveResult = { action: "book_slot", ok: false, error: "missing slot_start" };
          } else {
            // Find the matching held slot (tolerate small time diffs, BRT-aware)
            const target = parseSlotStartAsBrt(slotStart);
            const { data: holds } = await supabase
              .from("slot_holds")
              .select("id, slot_datetime, status")
              .eq("lead_id", lead_id)
              .eq("status", "held")
              .order("created_at", { ascending: false });
            const match = (holds || []).find((h: any) =>
              Math.abs(new Date(h.slot_datetime).getTime() - target) < 5 * 60_000,
            );

            if (!match) {
              await sendFallback("no matching held slot");
              liveResult = { action: "book_slot", ok: false, error: "no matching held slot for " + slotStart };
            } else {
              const { data: booking, error: bookErr } = await supabase.functions.invoke("calcom-confirm-booking", {
                body: {
                  lead_id,
                  selected_slot_hold_id: match.id,
                  force_placeholder: true,
                },
              });
              if (bookErr || (booking as any)?.error) {
                const errStr = bookErr ? String(bookErr) : String((booking as any)?.error);
                await sendFallback(errStr);
                liveResult = { action: "book_slot", ok: false, error: errStr };
              } else {
                const confirmMsg = String(fd.message || "").trim() ||
                  `Pronto, ${ctx.lead.name?.split(" ")[0] || ""}! Confirmei a reunião para ${formatBRTLong(slotStart)}. Você vai receber o convite com o link por e-mail. 🙌`;
                const { data: exec, error: execErr } = await supabase.functions.invoke("execute-action", {
                  body: {
                    company_id: ctx.lead.company_id,
                    lead_id,
                    conversation_id: conversation_id ?? null,
                    action_type: "send_reply",
                    params: { message: confirmMsg, channel: fd.channel || fallbackChannel },
                  },
                });
                const sent = !execErr && (exec as any)?.result?.sent === true;
                liveResult = { action: "book_slot", ok: !execErr, sent, booking, result: exec, error: execErr ? String(execErr) : ((exec as any)?.result?.error ?? (exec as any)?.result?.reason ?? null) };
              }
            }
          }
        } else if (decision === "reschedule_booking" || decision === "cancel_booking") {
          const fd = finalDecision as any;
          const fallbackChannel = fd.channel || "whatsapp";
          // Resolve booking_uid
          let bookingUid = typeof fd.booking_uid === "string" ? fd.booking_uid : null;
          if (!bookingUid) {
            const { data: existing } = await supabase
              .from("bookings")
              .select("calcom_booking_uid")
              .eq("lead_id", lead_id)
              .in("status", ["confirmed", "pending"])
              .order("updated_at", { ascending: false })
              .order("scheduled_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            bookingUid = (existing as any)?.calcom_booking_uid ?? null;
          }

          const buildFallbackMessage = () => {
            const agentMsg = String(fd.message || "").trim();
            if (agentMsg) {
              if (decision === "cancel_booking" && !/remarc|reagend|quando.*quiser|me chama/i.test(agentMsg)) {
                return `${agentMsg}\n\nSe quiser, é só me dizer quando ficar mais tranquilo que a gente reagenda.`;
              }
              return agentMsg;
            }
            return decision === "reschedule_booking"
              ? "Deixa eu confirmar essa alteração de horário aqui e já te retorno."
              : "Sem problemas. Cancelei nosso encontro. Se quiser, é só me dizer quando ficar mais tranquilo que a gente reagenda.";
          };

          const sendFallback = async (reason: string) => {
            try {
              await supabase
                .from("leads")
                .update({
                  handoff_required: true,
                  handoff_reason: `${decision} falhou: ${reason}`,
                  handoff_at: new Date().toISOString(),
                })
                .eq("id", lead_id);
            } catch (_) {}
            try {
              await supabase.functions.invoke("execute-action", {
                body: {
                  company_id: ctx.lead.company_id,
                  lead_id,
                  conversation_id: conversation_id ?? null,
                  action_type: "send_reply",
                  params: {
                    message: buildFallbackMessage(),
                    channel: fallbackChannel,
                  },
                },
              });
            } catch (_) {}
          };

          if (!bookingUid) {
            await sendFallback("nenhuma reserva ativa encontrada");
            liveResult = { action: decision, ok: false, error: "no active booking" };
          } else if (decision === "reschedule_booking" && !fd.slot_start) {
            await sendFallback("slot_start ausente");
            liveResult = { action: decision, ok: false, error: "missing slot_start" };
          } else {
            const params: Record<string, unknown> =
              decision === "reschedule_booking"
                ? { booking_uid: bookingUid, start: normalizeSlotStartIsoBrt(String(fd.slot_start)), reason: fd.reason || "Cliente solicitou remarcação" }
                : { booking_uid: bookingUid, reason: fd.reason || "Cliente solicitou cancelamento" };

            const { data: actionRes, error: actionErr } = await supabase.functions.invoke("execute-action", {
              body: {
                company_id: ctx.lead.company_id,
                lead_id,
                conversation_id: conversation_id ?? null,
                action_type: decision,
                params,
              },
            });
            const actionOk = !actionErr && (actionRes as any)?.ok !== false && !(actionRes as any)?.error;
            if (!actionOk) {
              const errStr = actionErr ? String(actionErr) : String((actionRes as any)?.error ?? "unknown");
              await sendFallback(errStr);
              liveResult = { action: decision, ok: false, error: errStr, result: actionRes };
            } else {
              const defaultMsg =
                decision === "reschedule_booking"
                  ? `Pronto, ${ctx.lead.name?.split(" ")[0] || ""}! Remarquei para ${formatBRTLong(fd.slot_start)}. Você vai receber o novo convite por e-mail. 🙌`
                  : `Tudo bem, ${ctx.lead.name?.split(" ")[0] || ""}, cancelei nossa reunião. Se quiser remarcar mais pra frente, é só me chamar.`;
              const confirmMsg = String(fd.message || "").trim() || defaultMsg;
              const { data: exec, error: execErr } = await supabase.functions.invoke("execute-action", {
                body: {
                  company_id: ctx.lead.company_id,
                  lead_id,
                  conversation_id: conversation_id ?? null,
                  action_type: "send_reply",
                  params: { message: confirmMsg, channel: fd.channel || fallbackChannel },
                },
              });
              const sent = !execErr && (exec as any)?.result?.sent === true;
              liveResult = { action: decision, ok: !execErr, sent, result: exec, action_result: actionRes, error: execErr ? String(execErr) : ((exec as any)?.result?.error ?? null) };
            }
          }
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
