import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, serviceKey);

    const { cadence_id, lead_id } = await req.json();
    if (!cadence_id || !lead_id) {
      return new Response(JSON.stringify({ error: "cadence_id and lead_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all data in parallel
    const [stepsRes, leadRes, cadenceRes] = await Promise.all([
      supabase.from("cadence_steps").select("*").eq("cadence_id", cadence_id).order("step_order", { ascending: true }),
      supabase.from("leads").select("*").eq("id", lead_id).single(),
      supabase.from("cadences").select("*").eq("id", cadence_id).single(),
    ]);

    if (stepsRes.error) throw stepsRes.error;
    if (leadRes.error) throw leadRes.error;
    if (cadenceRes.error) throw cadenceRes.error;

    const steps = stepsRes.data;
    const lead = leadRes.data;
    const cadence = cadenceRes.data;

    if (!steps.length) {
      return new Response(JSON.stringify({ previews: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch knowledge and insights in parallel
    const [knowledgeRes, insightRes] = await Promise.all([
      supabase.from("company_knowledge").select("title, content").eq("company_id", cadence.company_id).limit(10),
      supabase.from("lead_insights").select("insights, raw_summary").eq("lead_id", lead_id).maybeSingle(),
    ]);

    const knowledgeContext = (knowledgeRes.data || [])
      .map((k: any) => `## ${k.title}\n${k.content}`)
      .join("\n\n");

    // Build insights context once
    let insightsContext = "";
    if (insightRes.data?.insights) {
      const ins = insightRes.data.insights as any;
      if (ins.diferenciais?.length) {
        insightsContext = `\n\nDIFERENCIAIS DO PROSPECT (obtidos do website do lead):\n${ins.diferenciais.join(", ")}\n\nUse esses diferenciais para criar um gancho direto entre o que o prospect faz de melhor e como seu produto/serviço potencializa isso.`;
      }
    }

    // Generate previews for each step
    const previews = [];

    for (const step of steps) {
      const useInsights = step.smart_customization !== false;
      const stepInsights = useInsights ? insightsContext : "";

      // For non-smart steps, just do simple template replacement
      if (!useInsights) {
        const simpleMessage = (step.template || "")
          .replace(/\{\{nome\}\}/gi, lead.name)
          .replace(/\{\{empresa\}\}/gi, lead.company_name || "")
          .replace(/\{\{email\}\}/gi, lead.email || "");

        previews.push({
          step_order: step.step_order,
          step_id: step.id,
          channel: step.channel,
          delay_days: step.delay_days,
          smart_customization: false,
          subject: step.subject || null,
          message: simpleMessage,
          template_original: step.template,
        });
        continue;
      }

      // AI generation for smart customization steps
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Você é um SDR especialista em vendas B2B no Brasil. Seu objetivo PRINCIPAL é agendar uma reunião com o prospect.

=== SEU PRODUTO/SERVIÇO (o que você vende) ===
${knowledgeContext || "Sem informações adicionais do produto."}

=== DIFERENCIAIS DO PROSPECT ===
${stepInsights || "Sem diferenciais disponíveis do prospect."}

=== TEMPLATE BASE DO STEP ===
${step.template || "Sem template definido."}

CANAL: ${step.channel}
STEP: ${step.step_order} de ${steps.length}

REGRAS DE PERSONALIZAÇÃO (OBRIGATÓRIAS quando há diferenciais do prospect):
- OBRIGATÓRIO: Escolha 1 diferencial do prospect e faça um gancho direto com 1 benefício/produto específico da base de conhecimento acima
- Estrutura do gancho: "Vi que vocês [diferencial do prospect] → nosso [produto/solução] potencializa isso porque [benefício concreto]"
- Nunca seja genérico — cada mensagem deve parecer escrita à mão para aquele prospect
- O gancho deve conectar naturalmente o que o prospect faz de melhor com o que você oferece

REGRAS GERAIS:
- Mantenha o tom profissional mas humano
- ${step.channel === "whatsapp" ? "WhatsApp: mensagem curta, até 80 palavras, informal" : ""}
- ${step.channel === "email" ? `Email: MÁXIMO 80 palavras. Estrutura obrigatória:
  1. HOOK (1 frase): Comece com algo específico do prospect (do insight do website) que chame atenção
  2. CONEXÃO (1-2 frases): Ligue o hook diretamente a 1 benefício concreto do seu produto/serviço
  3. CTA (1 frase): Pergunta direta para agendar reunião de 15min
  - Subject: máximo 6 palavras, curioso, referenciando o negócio do prospect. NUNCA genérico.
  - PROIBIDO: "Meu nome é...", "Somos uma empresa...", "Gostaria de me apresentar...", introduções longas
  - Tom: direto, confiante, como se já conhecesse o mercado do prospect` : ""}
- ${step.channel === "linkedin" ? "LinkedIn: até 100 palavras, profissional" : ""}
- Se for o primeiro contato, seja mais introdutório
- Se for follow-up (step > 1), referencie contato anterior
- SEMPRE inclua um CTA claro para agendar reunião

Responda APENAS com JSON:
{
  "subject": "assunto do email (apenas para email, null para outros canais)",
  "message": "mensagem personalizada para enviar"
}`,
            },
            {
              role: "user",
              content: `Dados do lead:
- Nome: ${lead.name}
- Email: ${lead.email || "N/A"}
- Telefone: ${lead.phone || "N/A"}
- Empresa: ${lead.company_name || "N/A"}

Gere a mensagem personalizada para o step ${step.step_order}.`,
            },
          ],
        }),
      });

      let subject = step.subject || null;
      let message = step.template || "";

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const aiContent = aiData.choices?.[0]?.message?.content || "";
        try {
          const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiContent];
          const parsed = JSON.parse(jsonMatch[1].trim());
          subject = parsed.subject || subject;
          message = parsed.message || message;
        } catch {
          message = aiContent;
        }
      } else {
        console.error(`AI error for step ${step.step_order}: ${aiRes.status}`);
        await aiRes.text();
      }

      previews.push({
        step_order: step.step_order,
        step_id: step.id,
        channel: step.channel,
        delay_days: step.delay_days,
        smart_customization: true,
        subject,
        message,
        template_original: step.template,
      });
    }

    return new Response(JSON.stringify({ previews, lead }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("preview-cadence-messages error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
