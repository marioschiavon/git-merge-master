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
const MAX_STEPS = 12;
const HISTORY_LIMIT = 30;

// ────────────────────────────────────────────────────────────────
// Tool definitions exposed to the model
// ────────────────────────────────────────────────────────────────
const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "Busca semântica na base de conhecimento da empresa. Use para responder dúvidas sobre produto, preço, processo, diferenciais, FAQs.",
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
        "Lista horários disponíveis no calendário (Cal.com) para os próximos N dias.",
      parameters: {
        type: "object",
        properties: {
          days_ahead: { type: "integer", default: 7, minimum: 1, maximum: 30 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_lead_facts",
      description:
        "Persiste novos fatos descobertos sobre o lead (objeções, papel, urgência, horários, interesses).",
      parameters: {
        type: "object",
        properties: {
          facts: {
            type: "object",
            description: "Objeto com os fatos a mesclar em lead_memory.facts",
          },
        },
        required: ["facts"],
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
            enum: ["send_message", "schedule_followup", "escalate_to_human", "silence", "book_slot", "mark_referral"],
          },
          channel: { type: "string", enum: ["whatsapp", "email"], description: "Canal de envio se decision=send_message" },
          message: { type: "string", description: "Texto a enviar (se aplicável)" },
          followup_at: { type: "string", description: "ISO datetime para próximo follow-up (se aplicável)" },
          slot_start: { type: "string", description: "Horário do slot a reservar (ISO)" },
          referrer_lead_id: { type: "string", description: "Lead que indicou (se mark_referral)" },
          rationale: { type: "string", description: "Explicação curta do raciocínio" },
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
  ctx: { lead_id: string; company_id: string },
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
    const days = Number(args.days_ahead ?? 7);
    try {
      const { data, error } = await supabase.functions.invoke("calcom-slots", {
        body: { company_id: ctx.company_id, days_ahead: days },
      });
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
    .select("id, company_id, name, company_name, email, phone, whatsapp, status, source")
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
    .select("id")
    .eq("lead_id", leadId);
  const convIds = (convs ?? []).map((c) => c.id);

  let messages: Array<{ direction: string; content: string; created_at: string }> = [];
  if (convIds.length > 0) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("direction, content, created_at")
      .in("conversation_id", convIds)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    messages = (msgs ?? []).reverse();
  }

  const { data: intents } = await supabase
    .from("lead_intents_log")
    .select("category, sub_intent, confidence, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(5);

  return { lead, company, memory, messages, intents: intents ?? [] };
}

function buildSystemPrompt(ctx: Awaited<ReturnType<typeof loadContext>>): string {
  const { lead, company, memory, intents } = ctx;
  const facts = memory?.facts ?? {};
  return [
    `Você é um SDR (Sales Development Representative) de IA que trabalha para "${company?.name ?? "a empresa"}".`,
    company?.value_proposition ? `Proposta de valor: ${company.value_proposition}` : "",
    company?.tone ? `Tom de voz: ${company.tone}` : "Tom: profissional, próximo, consultivo, sem clichês.",
    "",
    "Sua missão:",
    "- Conduzir o lead a agendar uma conversa (use check_calendar se ele topar).",
    "- Tirar dúvidas com base na base de conhecimento (use search_knowledge antes de afirmar fatos sobre produto/preço/processo).",
    "- Identificar objeções e responder com empatia.",
    "- Reconhecer indicações (referral) e encerros (não tem interesse).",
    "",
    "Regras importantes:",
    "- NUNCA invente preços, prazos, condições ou horários — busque na KB ou no calendário.",
    "- Se faltar informação crítica, escale para humano com escalate_to_human.",
    "- Use update_lead_facts para registrar objeções, papel, urgência ou preferências novas.",
    "- SEMPRE finalize chamando a tool `finalize` com sua decisão.",
    "- Português brasileiro. Mensagens curtas, no máximo 3 parágrafos.",
    "",
    `## Lead atual`,
    `Nome: ${lead.name ?? "?"}`,
    `Empresa: ${lead.company_name ?? "?"}`,
    `Status: ${lead.status ?? "?"} | Fonte: ${lead.source ?? "?"}`,
    `Canais conhecidos: ${[lead.whatsapp && `whatsapp:${lead.whatsapp}`, lead.email && `email:${lead.email}`, lead.phone && `phone:${lead.phone}`].filter(Boolean).join(", ") || "—"}`,
    "",
    `## Memória do lead`,
    memory?.summary ? `Resumo: ${memory.summary}` : "Resumo: (sem resumo ainda)",
    Object.keys(facts).length ? `Fatos: ${JSON.stringify(facts)}` : "Fatos: (vazio)",
    "",
    `## Últimas intenções classificadas`,
    intents.length
      ? intents.map((i) => `- ${i.category}/${i.sub_intent ?? "—"} (${i.confidence})`).join("\n")
      : "(nenhuma)",
  ].filter(Boolean).join("\n");
}

function buildHistoryAsUserMessage(messages: Array<{ direction: string; content: string }>): string {
  if (messages.length === 0) return "(sem histórico ainda — esta é a primeira interação)";
  return messages
    .map((m) => `[${m.direction === "outbound" ? "SDR" : "Lead"}] ${m.content}`)
    .join("\n");
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
        content: `Histórico da conversa (mais recente por último):\n${history}\n\nDecida o próximo passo. Use as tools que precisar e termine com finalize.`,
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
        temperature: 0.4,
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
        // Model didn't call any tool — force finalize fallback
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
