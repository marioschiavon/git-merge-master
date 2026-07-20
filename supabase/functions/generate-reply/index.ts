import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json();
    const { company_id, lead, intent, history = [], channel = "email", tone } = body;
    if (!company_id || !intent?.category || !lead) {
      return new Response(JSON.stringify({ error: "company_id, lead e intent são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load knowledge base
    const [knowledgeRes, highlightsRes, aiInstructionsRes] = await Promise.all([
      supabase.from("company_knowledge").select("title, content").eq("company_id", company_id).not("type", "in", "(highlights,ai_instructions)").limit(10),
      supabase.from("company_knowledge").select("content").eq("company_id", company_id).eq("type", "highlights").maybeSingle(),
      supabase.from("company_knowledge").select("content").eq("company_id", company_id).eq("type", "ai_instructions").maybeSingle(),
    ]);
    const knowledgeContext = (knowledgeRes.data || []).map((k: any) => `## ${k.title}\n${k.content}`).join("\n\n");
    const highlightsContext = highlightsRes.data?.content || "";
    const aiInstructionsContext = aiInstructionsRes.data?.content || "";

    const intentPlaybook: Record<string, string> = {
      interest: "Demonstrou interesse. Confirme o interesse e proponha uma reunião curta (15-20 min). Ofereça 2 horários ou peça preferência.",
      info_request: "Pediu informação. Responda objetivamente o que foi perguntado APENAS com base no conhecimento. Sempre termine com CTA de reunião.",
      pricing: "Perguntou preço. Não dê valor direto. Explique que depende de uso/escopo e proponha reunião curta para mostrar e cotar.",
      scheduling: "Quer agendar. Ofereça 2 horários ou confirme o horário sugerido. Curto e direto.",
      rejection: "Recusou. Agradeça gentilmente, deixe porta aberta e encerre.",
      routing: "Indicou outro contato ou disse não ser responsável. Agradeça, peça nome + e-mail/whats da pessoa certa.",
      channel_switch: "Pediu para mudar de canal. Confirme e diga que vai enviar pelo canal pedido.",
      compliance: "Reclamação/opt-out. NÃO promova nada. Confirme remoção e ofereça canal de suporte humano.",
      escalation: "Caso complexo. Diga que vai pedir para um especialista entrar em contato em breve.",
      silence: "Sem resposta há tempo. Reengaje com pergunta curta e sem pressão.",
    };

    const channelRules: Record<string, string> = {
      whatsapp: "Canal WhatsApp: ≤60 palavras, tom direto, sem assinatura formal.",
      email: "Canal Email: ≤100 palavras, tom profissional, abertura curta.",
      linkedin: "Canal LinkedIn: ≤90 palavras, tom profissional informal.",
    };

    const systemPrompt = `Você é um SDR B2B em português brasileiro.

=== BASE DE CONHECIMENTO (ÚNICA FONTE) ===
${highlightsContext ? `DIFERENCIAIS:\n${highlightsContext}\n\n` : ""}${knowledgeContext || "(vazia)"}
${aiInstructionsContext ? `\nINSTRUÇÕES DE ABORDAGEM:\n${aiInstructionsContext}` : ""}
==========================================

REGRAS ANTI-ALUCINAÇÃO:
- Use APENAS fatos da base. Nunca invente features, números, integrações, clientes.
- Se faltar info, diga que confirma com o time na reunião.

INTENT CLASSIFICADO: ${intent.category}${intent.sub_intent ? ` / ${intent.sub_intent}` : ""}
PLAYBOOK: ${intentPlaybook[intent.category] || "Responda de forma profissional."}
${tone ? `TOM REQUERIDO: ${tone}` : ""}

${channelRules[channel] || channelRules.email}

Responda APENAS JSON:
{
  "subject": "<assunto curto OU null se não for email>",
  "body": "<texto da mensagem>"
}`;

    const { fetchAnnotationsContext } = await import("../_shared/annotations-context.ts");
    const annotationsBlock = await fetchAnnotationsContext(supabase, {
      companyId: company_id,
      leadId: (lead as any)?.id ?? null,
    });
    const systemPromptWithNotes = systemPrompt + annotationsBlock;

    const historyText = (history as any[])
      .slice(-10)
      .map((m) => `[${m.direction === "outbound" ? "SDR" : "PROSPECT"}]: ${m.content}`)
      .join("\n");

    const userPrompt = `Lead: ${lead.name || "(sem nome)"} — ${lead.company_name || ""}
Histórico:
${historyText}

Gere a próxima mensagem.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: systemPromptWithNotes },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const status = response.status;
      await response.text();
      if (status === 429) return new Response(JSON.stringify({ error: "Limite de requisições excedido." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Erro ao gerar resposta" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { subject: null, body: content };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-reply error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
