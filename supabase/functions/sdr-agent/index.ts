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
          slot_start: { type: "string", description: "Horário do slot a reservar (se book_slot)" },
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
      const { data, error } = await supabase.functions.invoke("calcom-slots", { body });
      if (error) return { error: String(error) };
      return data ?? { slots: [] };
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

  return { lead, company, memory, messages, intents: intents ?? [], heldSlots: heldSlots ?? [], enrollment, kb };

}

function fmtBrt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof loadContext>>): string {
  const { lead, company, memory, intents, heldSlots, enrollment, kb } = ctx;

  const facts = (memory?.facts ?? {}) as Record<string, unknown>;
  const datePref = (facts.date_preference ?? null) as null | { start_after?: string; end_before?: string; raw?: string };
  const preferredChannel = (facts.preferred_channel ?? null) as string | null;

  const lastIntent = intents[0];

  return [
    `Você é um SDR (Sales Development Representative) de IA que trabalha para "${company?.name ?? "a empresa"}".`,
    company?.value_proposition ? `Proposta de valor: ${company.value_proposition}` : "",
    company?.tone ? `Tom de voz: ${company.tone}` : "Tom: profissional, próximo, consultivo, sem clichês.",
    "",
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
    "- Use update_lead_facts assim que detectar uma preferência nova (janela de data, canal, objeção, papel, urgência).",
    "- SEMPRE finalize chamando a tool `finalize`.",
    "- Português brasileiro. Mensagens curtas (2-3 parágrafos no máximo). Não use 'olá' nem 'tudo bem?' se já está no meio da conversa.",
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
        finalDecision = { decision: "silence", rationale: "Modelo não chamou finalize", raw: msg.content };
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

    // SHADOW mode: do nothing. LIVE mode (future): translate finalDecision into actions.
    return new Response(
      JSON.stringify({
        ok: true,
        run_id: runId,
        mode,
        decision: finalDecision,
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
