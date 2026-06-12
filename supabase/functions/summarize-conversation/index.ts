// Updates rolling conversation summary + extracted lead facts (lead_memory).
// Called per lead, or in bulk for stale conversations.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { chatCompletion } from "../_shared/ai-gateway.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUMMARY_MODEL = "google/gemini-2.5-flash-lite";
const REFRESH_EVERY = 10; // re-summarize after N new messages

interface Msg {
  direction: string;
  content: string;
  created_at: string;
}

async function summarizeLead(leadId: string) {
  const { data: lead } = await supabase
    .from("leads")
    .select("id, company_id, name, company_name, email, phone, whatsapp")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { lead_id: leadId, skipped: "lead not found" };

  const { data: convs } = await supabase
    .from("conversations")
    .select("id, summary, summary_message_count")
    .eq("lead_id", leadId);
  const convIds = (convs ?? []).map((c) => c.id);
  if (convIds.length === 0) return { lead_id: leadId, skipped: "no conversations" };

  const { data: msgs } = await supabase
    .from("messages")
    .select("direction, content, created_at")
    .in("conversation_id", convIds)
    .order("created_at", { ascending: true });
  const all: Msg[] = msgs ?? [];
  if (all.length === 0) return { lead_id: leadId, skipped: "no messages" };

  // Check if summary is stale
  const { data: existing } = await supabase
    .from("lead_memory")
    .select("last_message_count, summary, facts")
    .eq("lead_id", leadId)
    .maybeSingle();

  if (existing && all.length - existing.last_message_count < REFRESH_EVERY) {
    return { lead_id: leadId, skipped: "fresh", message_count: all.length };
  }

  const history = all
    .map((m) => `[${m.direction === "outbound" ? "SDR" : "Lead"}] ${m.content}`)
    .join("\n");

  const sys = `Você é um analista que resume conversas de SDR com leads em português brasileiro.
Retorne JSON com:
{
  "summary": "resumo conciso (até 600 chars) do estado da conversa, decisões tomadas, próximos passos",
  "facts": {
    "papel": "cargo/função se mencionado",
    "objecoes": ["lista de objeções levantadas"],
    "interesses": ["interesses/dores mencionados"],
    "horarios_preferidos": "preferência de horário se mencionada",
    "urgencia": "alta|média|baixa|desconhecida",
    "canal_preferido": "whatsapp|email|outro|desconhecido",
    "observacoes": "qualquer outro fato relevante"
  }
}
Omita campos sem informação. Seja factual, sem inventar.`;

  const user = `Lead: ${lead.name ?? "?"} (${lead.company_name ?? "?"})
Histórico completo (${all.length} mensagens):
${history}`;

  const res = await chatCompletion({
    model: SUMMARY_MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const raw = res.choices[0]?.message?.content;
  let parsed: { summary?: string; facts?: Record<string, unknown> } = {};
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : "{}");
  } catch {
    parsed = { summary: typeof raw === "string" ? raw : "" };
  }

  // Upsert lead_memory
  await supabase
    .from("lead_memory")
    .upsert(
      {
        lead_id: leadId,
        company_id: lead.company_id,
        summary: parsed.summary ?? "",
        facts: parsed.facts ?? {},
        last_message_count: all.length,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" },
    );

  // Update each conversation's summary marker
  for (const c of convs ?? []) {
    await supabase
      .from("conversations")
      .update({
        summary: parsed.summary ?? "",
        summary_updated_at: new Date().toISOString(),
        summary_message_count: all.length,
      })
      .eq("id", c.id);
  }

  return {
    lead_id: leadId,
    message_count: all.length,
    summary_chars: (parsed.summary ?? "").length,
    facts_keys: Object.keys(parsed.facts ?? {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { lead_id, lead_ids, stale_only } = body as {
      lead_id?: string;
      lead_ids?: string[];
      stale_only?: boolean;
    };

    let ids: string[] = [];
    if (lead_id) ids = [lead_id];
    else if (lead_ids?.length) ids = lead_ids;
    else if (stale_only) {
      // pick leads with recent messages whose memory is stale
      const { data } = await supabase
        .from("conversations")
        .select("lead_id, summary_message_count, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50);
      ids = Array.from(new Set((data ?? []).map((c) => c.lead_id).filter(Boolean)));
    } else {
      return new Response(
        JSON.stringify({ error: "Provide lead_id, lead_ids, or stale_only=true" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results = [];
    for (const id of ids) {
      try {
        results.push(await summarizeLead(id));
      } catch (e) {
        results.push({ lead_id: id, error: String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("summarize-conversation error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
