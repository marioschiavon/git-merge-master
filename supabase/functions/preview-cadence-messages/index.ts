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
      const parts = [];
      if (ins.proposta_valor) parts.push(`- Proposta de valor: ${ins.proposta_valor}`);
      if (ins.produtos?.length) parts.push(`- Produtos/Serviços: ${ins.produtos.join(", ")}`);
      if (ins.diferenciais?.length) parts.push(`- Diferenciais: ${ins.diferenciais.join(", ")}`);
      if (ins.pain_points?.length) parts.push(`- Pain points: ${ins.pain_points.join(", ")}`);
      if (ins.publico_alvo) parts.push(`- Público-alvo: ${ins.publico_alvo}`);
      if (ins.oportunidades_abordagem?.length) parts.push(`- Sugestões de abordagem: ${ins.oportunidades_abordagem.join("; ")}`);
      if (parts.length > 0) {
        insightsContext = `\n\nINSIGHTS DO PROSPECT (obtidos do website do lead):\n${parts.join("\n")}\n\nUse esses insights para personalizar a mensagem. Mencione algo específico do negócio do prospect para mostrar que você pesquisou sobre a empresa dele.`;
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

=== INSIGHTS ESTRATÉGICOS DO PROSPECT ===
${stepInsights || "Sem insights disponíveis do prospect."}

=== TEMPLATE BASE DO STEP ===
${step.template || "Sem template definido."}

CANAL: ${step.channel}
STEP: ${step.step_order} de ${steps.length}

REGRAS DE PERSONALIZAÇÃO (OBRIGATÓRIAS quando há insights do prospect):
- OBRIGATÓRIO: Conecte pelo menos 1 pain point do prospect com 1 benefício específico do seu produto/serviço
- Mencione algo específico do negócio do prospect (produto, mercado, diferencial) para mostrar que você pesquisou
- Mostre como seu produto/serviço resolve uma dor REAL que o prospect provavelmente tem
- Use o contexto do mercado do prospect para justificar por que seu produto é relevante para ELE
- Nunca seja genérico — cada mensagem deve parecer escrita à mão para aquele prospect
- Se o prospect tem diferenciais, use como gancho: "Vi que vocês se destacam em X, e nosso produto potencializa isso com Y"

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
