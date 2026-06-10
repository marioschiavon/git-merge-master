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

    const { cadence_id, lead_id, force_regenerate, only_first_step, variations } = await req.json();
    const variationCount = Number(variations) > 0 ? Math.min(5, Number(variations)) : 0;
    if (!cadence_id || !lead_id) {
      return new Response(JSON.stringify({ error: "cadence_id and lead_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all data in parallel
    const [stepsRes, leadRes, cadenceRes, enrollmentRes] = await Promise.all([
      supabase.from("cadence_steps").select("*").eq("cadence_id", cadence_id).order("step_order", { ascending: true }),
      supabase.from("leads").select("*").eq("id", lead_id).single(),
      supabase.from("cadences").select("*").eq("id", cadence_id).single(),
      supabase.from("cadence_enrollments").select("id").eq("cadence_id", cadence_id).eq("lead_id", lead_id).maybeSingle(),
    ]);

    if (stepsRes.error) throw stepsRes.error;
    if (leadRes.error) throw leadRes.error;
    if (cadenceRes.error) throw cadenceRes.error;

    const allSteps = stepsRes.data;
    const steps = (only_first_step || variationCount > 0) ? allSteps.slice(0, 1) : allSteps;
    const lead = leadRes.data;
    const cadence = cadenceRes.data;
    const enrollment = enrollmentRes.data;

    if (!steps.length) {
      return new Response(JSON.stringify({ previews: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for saved custom messages (if enrolled and not forcing regenerate)
    let savedMessages: Record<string, any> = {};
    if (enrollment && !force_regenerate) {
      const { data: customMsgs } = await supabase
        .from("cadence_custom_messages")
        .select("step_id, subject, message")
        .eq("enrollment_id", enrollment.id);

      if (customMsgs) {
        for (const cm of customMsgs) {
          savedMessages[cm.step_id] = cm;
        }
      }
    }

    // If we have saved messages for ALL steps and not forcing regenerate, return them directly
    const allStepsSaved = !force_regenerate && steps.every((s: any) => savedMessages[s.id]);
    if (allStepsSaved) {
      const previews = steps.map((step: any) => ({
        step_order: step.step_order,
        step_id: step.id,
        channel: step.channel,
        delay_days: step.delay_days,
        smart_customization: step.smart_customization !== false,
        subject: savedMessages[step.id].subject,
        message: savedMessages[step.id].message,
        template_original: step.template,
        is_saved: true,
      }));
      return new Response(JSON.stringify({ previews, lead }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch knowledge, highlights, ai_instructions, insights and social profiles in parallel
    const [knowledgeRes, highlightsRes, aiInstructionsRes, insightRes, socialRes] = await Promise.all([
      supabase.from("company_knowledge").select("title, content").eq("company_id", cadence.company_id).not("type", "in", "(highlights,ai_instructions)").limit(10),
      supabase.from("company_knowledge").select("content").eq("company_id", cadence.company_id).eq("type", "highlights").maybeSingle(),
      supabase.from("company_knowledge").select("content").eq("company_id", cadence.company_id).eq("type", "ai_instructions").maybeSingle(),
      supabase.from("lead_insights").select("insights, raw_summary").eq("lead_id", lead_id).maybeSingle(),
      supabase.from("lead_social_profiles").select("network, handle, bio, followers, posts_summary, recent_posts").eq("lead_id", lead_id),
    ]);

    const knowledgeContext = (knowledgeRes.data || [])
      .map((k: any) => `## ${k.title}\n${k.content}`)
      .join("\n\n");

    // highlightsContext will be conditionally applied per step below

    let insightsContext = "";
    if (insightRes.data?.insights) {
      const ins = insightRes.data.insights as any;
      if (ins.diferenciais?.length) {
        insightsContext = `\n\nDIFERENCIAIS DO PROSPECT (obtidos do website do lead):\n${ins.diferenciais.join(", ")}\n\nUse esses diferenciais para criar um gancho direto entre o que o prospect faz de melhor e como seu produto/serviço potencializa isso.`;
      }
    }

    // Build social media context from lead_social_profiles (Instagram, LinkedIn, etc.)
    let socialContext = "";
    const socialProfiles = socialRes.data || [];
    if (socialProfiles.length > 0) {
      const parts: string[] = [];
      for (const p of socialProfiles as any[]) {
        const hasContent = p.bio || p.posts_summary || (Array.isArray(p.recent_posts) && p.recent_posts.length > 0);
        if (!hasContent) continue;
        const lines: string[] = [];
        lines.push(`### ${p.network}${p.handle ? ` (@${p.handle})` : ""}${p.followers ? ` — ${p.followers} seguidores` : ""}`);
        if (p.bio) lines.push(`Bio: ${String(p.bio).slice(0, 400)}`);
        if (p.posts_summary) lines.push(`Resumo de posts: ${String(p.posts_summary).slice(0, 800)}`);
        if (Array.isArray(p.recent_posts) && p.recent_posts.length > 0) {
          const top = p.recent_posts.slice(0, 3).map((rp: any, i: number) => {
            const cap = rp?.caption || rp?.text || rp?.title || "";
            return `  ${i + 1}. ${String(cap).slice(0, 200)}`;
          }).filter((s: string) => s.trim().length > 4).join("\n");
          if (top.trim()) lines.push(`Últimos posts:\n${top}`);
        }
        parts.push(lines.join("\n"));
      }
      if (parts.length > 0) {
        socialContext = `\n\nSINAIS DE REDES SOCIAIS DO PROSPECT:\n${parts.join("\n\n")}\n\nQuando relevante, prefira referenciar um post/tema concreto recente em vez de gancho genérico. Nunca invente.`;
      }
    }
    console.log(`[preview-cadence] social profiles loaded: ${socialProfiles.length}`);

    // === VARIATIONS MODE: generate N alternative angles for Step 1 ===
    if (variationCount > 0) {
      const step = steps[0];
      const stepHighlights = (step.use_highlights !== false && highlightsRes.data?.content)
        ? `\n\n=== DESTAQUES DA NOSSA EMPRESA (use como autoridade) ===\n${highlightsRes.data.content}`
        : "";
      const channelHint = step.channel === "whatsapp"
        ? "WhatsApp: até 80 palavras, informal."
        : step.channel === "linkedin"
          ? "LinkedIn: até 100 palavras, profissional."
          : "Email: máximo 80 palavras. Subject curto (até 6 palavras). Hook + Conexão + CTA reunião 15min.";

      const variationsSystem = `Você é um SDR B2B sênior. Gere ${variationCount} VARIAÇÕES distintas da PRIMEIRA mensagem da cadência, cada uma com um ângulo diferente, mas todas conectando algo concreto do prospect com o que NÓS vendemos.

${aiInstructionsRes.data?.content ? `=== INSTRUÇÕES OBRIGATÓRIAS DA EMPRESA (PRIORIDADE MÁXIMA) ===\n${aiInstructionsRes.data.content}\n\nSe não houver fit claro, faça abordagem neutra sem forçar gancho.\n\n` : ""}=== O QUE NÓS VENDEMOS ===
${knowledgeContext || "(sem base de conhecimento)"}
${stepHighlights}

=== INSIGHTS DO PROSPECT ===
${insightsContext || "(sem insights disponíveis)"}

=== SINAIS DE REDES SOCIAIS DO PROSPECT ===
${socialContext || "(sem dados de redes sociais)"}

=== TEMPLATE BASE DO STEP 1 ===
${step.template || "(sem template)"}

CANAL: ${step.channel} — ${channelHint}

REGRAS:
- Cada variação usa um ÂNGULO/GANCHO diferente (ex.: dor, oportunidade, prova social, benefício específico).
- Nunca invente fatos sobre o prospect.
- Sempre termine com CTA de reunião curta (15min).
- Mantenha o tom e estrutura do template, mas reescreva.

Responda APENAS JSON: {"variations":[{"subject":"...","message":"...","angle":"gancho usado"}]}`;

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: variationsSystem },
            { role: "user", content: `Lead: ${lead.name} (${lead.title || "cargo n/d"}) — ${lead.company_name || "empresa n/d"}.\nEmail: ${lead.email || "N/A"}.\n\nGere ${variationCount} variações distintas.` },
          ],
        }),
      });

      let variationsOut: any[] = [];
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const aiContent = aiData.choices?.[0]?.message?.content || "";
        try {
          const m = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiContent];
          const parsed = JSON.parse(m[1].trim());
          variationsOut = Array.isArray(parsed.variations) ? parsed.variations : [];
        } catch {
          variationsOut = [];
        }
      } else {
        console.error(`AI variations error: ${aiRes.status}`);
        await aiRes.text();
      }

      return new Response(JSON.stringify({
        variations: variationsOut,
        step: { id: step.id, channel: step.channel, subject: step.subject, template: step.template, step_order: step.step_order },
        cadence: { id: cadence.id, name: cadence.name },
        lead,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const previews = [];

    for (const step of steps) {
      // If this step has a saved message and we're not forcing regenerate, use it
      if (!force_regenerate && savedMessages[step.id]) {
        previews.push({
          step_order: step.step_order,
          step_id: step.id,
          channel: step.channel,
          delay_days: step.delay_days,
          smart_customization: step.smart_customization !== false,
          subject: savedMessages[step.id].subject,
          message: savedMessages[step.id].message,
          template_original: step.template,
          is_saved: true,
        });
        continue;
      }

      const useInsights = step.smart_customization !== false;
      const stepInsights = useInsights ? insightsContext : "";
      const stepSocial = useInsights ? socialContext : "";
      const stepHighlights = (useInsights && step.use_highlights !== false && highlightsRes.data?.content)
        ? `\n\n=== DESTAQUES IMPORTANTES DA EMPRESA (use como argumentos de autoridade) ===\n${highlightsRes.data.content}\n\nOBRIGATÓRIO: Mencione pelo menos 1 destaque da empresa acima como argumento de credibilidade na mensagem.`
        : "";

      const stepMentalTriggers = (useInsights && step.use_mental_triggers === true && step.mental_triggers?.length > 0)
        ? `\n\nGATILHOS MENTAIS OBRIGATÓRIOS: Use os seguintes gatilhos mentais de vendas na mensagem de forma natural e persuasiva: ${step.mental_triggers.join(", ")}. Integre-os ao texto sem ser óbvio ou forçado.`
        : "";

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
          is_saved: false,
        });
        continue;
      }

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

${aiInstructionsRes.data?.content ? `=== INSTRUÇÕES OBRIGATÓRIAS DA EMPRESA (PRIORIDADE MÁXIMA — sobrescrevem qualquer outra regra abaixo) ===
${aiInstructionsRes.data.content}

Se as regras acima disserem que o prospect não tem fit com seu produto/serviço, NÃO force gancho — escreva uma abordagem neutra de apresentação e pergunte se faz sentido conversar.

` : ""}=== SEU PRODUTO/SERVIÇO (o que você vende) ===
${knowledgeContext || "Sem informações adicionais do produto."}
${stepHighlights}

=== DIFERENCIAIS DO PROSPECT ===
${stepInsights || "Sem diferenciais disponíveis do prospect."}
${stepMentalTriggers}

=== TEMPLATE BASE DO STEP ===
${step.template || "Sem template definido."}

CANAL: ${step.channel}
STEP: ${step.step_order} de ${steps.length}

REGRAS DE PERSONALIZAÇÃO:
- Faça um gancho com 1 diferencial do prospect APENAS SE houver relação clara e coerente com o produto/serviço (respeitando as INSTRUÇÕES OBRIGATÓRIAS DA EMPRESA acima)
- Se houver fit: estrutura sugerida — "Vi que vocês [diferencial do prospect] → nosso [produto/solução] potencializa isso porque [benefício concreto]"
- Se NÃO houver fit claro: NÃO invente conexão. Faça abordagem neutra focada no segmento do prospect e termine perguntando se faz sentido conversar.
- Nunca seja genérico, mas também nunca force uma ligação sem sentido

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
        is_saved: false,
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
