import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getZApiConfig, sendWhatsAppViaZApi } from "../_shared/zapi-whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};



// Find or create a conversation for (lead, channel), reusing any existing conv
// for the same (lead, channel) and attaching the enrollment if it's still null.
// Prevents duplicate convs when gmail-sync-inbox creates one before this runs.
async function findOrCreateConversation(
  supabase: any,
  leadId: string,
  companyId: string,
  channel: string,
  enrollmentId: string,
): Promise<{ id: string } | null> {
  // 1. Exact match by enrollment
  const { data: byEnroll } = await supabase
    .from("conversations").select("id")
    .eq("lead_id", leadId).eq("cadence_enrollment_id", enrollmentId).maybeSingle();
  if (byEnroll) return byEnroll;

  // 2. Reuse any existing conv for same lead+channel (e.g. created by gmail-sync)
  const { data: byChannel } = await supabase
    .from("conversations").select("id, cadence_enrollment_id")
    .eq("lead_id", leadId).eq("channel", channel)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (byChannel) {
    if (!byChannel.cadence_enrollment_id) {
      await supabase.from("conversations")
        .update({ cadence_enrollment_id: enrollmentId })
        .eq("id", byChannel.id);
    }
    return { id: byChannel.id };
  }

  // 3. Create new
  const { data: newConv } = await supabase
    .from("conversations")
    .insert({ lead_id: leadId, company_id: companyId, channel, cadence_enrollment_id: enrollmentId })
    .select("id").single();
  return newConv || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Find enrollments ready to execute
    const { data: enrollments, error: enrollError } = await supabase
      .from("cadence_enrollments")
      .select(`
        *,
        leads(id, name, email, phone, company_name, status),
        cadences(id, name, type, company_id, status)
      `)
      .eq("status", "active")
      .eq("meeting_scheduled", false)
      .lte("next_execution_at", new Date().toISOString())
      .not("next_execution_at", "is", null);

    if (enrollError) throw enrollError;
    if (!enrollments || enrollments.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: "Nenhum enrollment para processar" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const enrollment of enrollments) {
      try {
        const cadence = enrollment.cadences as any;
        const lead = enrollment.leads as any;

        if (!cadence || cadence.status !== "active" || !lead) continue;

        // Get current step
        const { data: steps } = await supabase
          .from("cadence_steps")
          .select("*")
          .eq("cadence_id", cadence.id)
          .order("step_order", { ascending: true });

        if (!steps || steps.length === 0) continue;

        const currentStep = steps.find((s: any) => s.step_order === enrollment.current_step);
        if (!currentStep) {
          await supabase
            .from("cadence_enrollments")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", enrollment.id);
          continue;
        }

        // Check for saved custom message first
        const { data: customMsg } = await supabase
          .from("cadence_custom_messages")
          .select("subject, message")
          .eq("enrollment_id", enrollment.id)
          .eq("step_id", currentStep.id)
          .maybeSingle();

        if (customMsg) {
          // Use saved custom message — skip AI generation
          const parsed = { subject: customMsg.subject, message: customMsg.message };
          let sendAction = "sent";

          // === CHANNEL-SPECIFIC SENDING (same logic as below) ===
          if (currentStep.channel === "email" && lead.email) {
            try {
              const { error: sendError } = await supabase.functions.invoke("gmail-send", {
                body: {
                  to: lead.email,
                  subject: parsed.subject || `Mensagem para ${lead.name}`,
                  html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${parsed.message.replace(/\n/g, "<br>")}</div>`,
                  text: parsed.message,
                  lead_id: lead.id,
                  company_id: cadence.company_id,
                },
              });
              if (sendError) { sendAction = "failed"; }
            } catch { sendAction = "failed"; }
          } else if (currentStep.channel === "whatsapp" && (lead.whatsapp || lead.phone)) {
            const zCfg = await getZApiConfig(supabase, cadence.company_id);
            if (zCfg) {
              const r = await sendWhatsAppViaZApi(zCfg, lead.whatsapp || lead.phone, parsed.message);
              if (!r.ok) { console.error("Z-API send failed:", r.error); sendAction = "failed"; }
            } else { sendAction = "pending_manual"; }
          } else if (currentStep.channel === "linkedin") { sendAction = "pending_manual"; }



          // Log activity
          if (cadence.company_id && lead.id) {
            const channelEmoji = currentStep.channel === "email" ? "📧" : currentStep.channel === "whatsapp" ? "📱" : "💼";
            const statusLabel = sendAction === "sent" ? "enviado" : sendAction === "failed" ? "falhou" : "tarefa manual";
            await supabase.from("lead_activities").insert({
              company_id: cadence.company_id, lead_id: lead.id,
              type: currentStep.channel === "multi_channel" ? "email" : currentStep.channel,
              description: `${channelEmoji} ${currentStep.channel.charAt(0).toUpperCase() + currentStep.channel.slice(1)} ${statusLabel} - Step ${currentStep.step_order} (msg aprovada)${parsed.subject ? `: ${parsed.subject}` : `: ${parsed.message.substring(0, 100)}`}`,
              metadata: { step_order: currentStep.step_order, cadence_id: cadence.id, action: sendAction, subject: parsed.subject, custom_message: true },
            });
          }

          // Create or get conversation (reuses existing email conv if gmail-sync already created one)
          const conversation = await findOrCreateConversation(
            supabase, lead.id, cadence.company_id, currentStep.channel, enrollment.id
          );
          if (conversation) {
            await supabase.from("messages").insert({ conversation_id: conversation.id, content: parsed.message, direction: "outbound", ai_suggested: false, metadata: { subject: parsed.subject, step_order: currentStep.step_order, custom_message: true, channel: currentStep.channel } });
          }

          // Log execution
          await supabase.from("execution_logs").insert({ company_id: cadence.company_id, enrollment_id: enrollment.id, step_id: currentStep.id, lead_id: lead.id, channel: currentStep.channel, action: sendAction, message_content: parsed.message, ai_context: { subject: parsed.subject, step_order: currentStep.step_order, custom_message: true } });

          // Advance step
          const nextStep = steps.find((s: any) => s.step_order === enrollment.current_step + 1);
          const updateData: any = { current_step: enrollment.current_step + 1, last_executed_at: new Date().toISOString() };
          if (nextStep) { const nd = new Date(); nd.setDate(nd.getDate() + nextStep.delay_days); updateData.next_execution_at = nd.toISOString(); }
          else { updateData.status = "completed"; updateData.completed_at = new Date().toISOString(); updateData.next_execution_at = null; }
          await supabase.from("cadence_enrollments").update(updateData).eq("id", enrollment.id);

          processed++;
          continue; // Skip AI generation below
        }

        // Get company knowledge, highlights and ai_instructions in parallel
        const [knowledgeRes, highlightsRes, aiInstructionsRes] = await Promise.all([
          supabase.from("company_knowledge").select("title, content").eq("company_id", cadence.company_id).not("type", "in", "(highlights,ai_instructions)").limit(10),
          supabase.from("company_knowledge").select("content").eq("company_id", cadence.company_id).eq("type", "highlights").maybeSingle(),
          supabase.from("company_knowledge").select("content").eq("company_id", cadence.company_id).eq("type", "ai_instructions").maybeSingle(),
        ]);

        const knowledgeContext = (knowledgeRes.data || [])
          .map((k: any) => `## ${k.title}\n${k.content}`)
          .join("\n\n");

        const highlightsContext = (currentStep.use_highlights !== false && highlightsRes.data?.content)
          ? `\n\n=== DESTAQUES IMPORTANTES DA EMPRESA (use como argumentos de autoridade) ===\n${highlightsRes.data.content}\n\nOBRIGATÓRIO: Mencione pelo menos 1 destaque da empresa acima como argumento de credibilidade na mensagem.`
          : "";

        const aiInstructionsContext = aiInstructionsRes.data?.content
          ? `=== INSTRUÇÕES OBRIGATÓRIAS DA EMPRESA (PRIORIDADE MÁXIMA — sobrescrevem qualquer outra regra abaixo) ===\n${aiInstructionsRes.data.content}\n\nSe as regras acima disserem que o prospect não tem fit, NÃO force gancho — escreva uma abordagem neutra de apresentação.\n\n`
          : "";

        const mentalTriggersContext = (currentStep.use_mental_triggers === true && currentStep.mental_triggers?.length > 0)
          ? `\n\nGATILHOS MENTAIS OBRIGATÓRIOS: Use os seguintes gatilhos mentais de vendas na mensagem de forma natural e persuasiva: ${currentStep.mental_triggers.join(", ")}. Integre-os ao texto sem ser óbvio ou forçado.`
          : "";

        // Get lead insights from website analysis (only if smart_customization is enabled for this step)
        let insightsContext = "";
        if (currentStep.smart_customization !== false) {
          const { data: leadInsight } = await supabase
            .from("lead_insights")
            .select("insights, raw_summary")
            .eq("lead_id", lead.id)
            .maybeSingle();

          if (leadInsight?.insights) {
            const ins = leadInsight.insights as any;
            if (ins.diferenciais?.length) {
              insightsContext = `\n\nDIFERENCIAIS DO PROSPECT (obtidos do website do lead):\n${ins.diferenciais.join(", ")}\n\nUse esses diferenciais para criar um gancho direto entre o que o prospect faz de melhor e como seu produto/serviço potencializa isso.`;
            }
          }
        }

        // Generate personalized message with AI
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

${aiInstructionsContext}=== SEU PRODUTO/SERVIÇO (o que você vende) ===
${knowledgeContext || "Sem informações adicionais do produto."}
${highlightsContext}

=== DIFERENCIAIS DO PROSPECT ===
${insightsContext || "Sem diferenciais disponíveis do prospect."}
${mentalTriggersContext}

=== TEMPLATE BASE DO STEP ===
${currentStep.template || "Sem template definido."}

CANAL: ${currentStep.channel}
STEP: ${currentStep.step_order} de ${steps.length}

REGRAS DE PERSONALIZAÇÃO:
- Faça um gancho com 1 diferencial do prospect APENAS SE houver relação clara e coerente com o produto/serviço (respeitando as INSTRUÇÕES OBRIGATÓRIAS DA EMPRESA acima)
- Se houver fit: estrutura sugerida — "Vi que vocês [diferencial do prospect] → nosso [produto/solução] potencializa isso porque [benefício concreto]"
- Se NÃO houver fit claro: NÃO invente conexão. Faça abordagem neutra focada no segmento do prospect e termine perguntando se faz sentido conversar.
- Nunca seja genérico, mas também nunca force uma ligação sem sentido

REGRAS GERAIS:
- Mantenha o tom profissional mas humano
- ${currentStep.channel === "whatsapp" ? "WhatsApp: mensagem curta, até 80 palavras, informal" : ""}
- ${currentStep.channel === "email" ? `Email: MÁXIMO 80 palavras. Estrutura obrigatória:
  1. HOOK (1 frase): Comece com algo específico do prospect (do insight do website) que chame atenção — ex: "Vi que a [empresa] está focada em [X]..."
  2. CONEXÃO (1-2 frases): Ligue o hook diretamente a 1 benefício concreto do seu produto/serviço
  3. CTA (1 frase): Pergunta direta para agendar reunião de 15min — ex: "Faz sentido conversarmos essa semana?"
  - Subject: máximo 6 palavras, curioso, referenciando o negócio do prospect. NUNCA genérico.
  - PROIBIDO: "Meu nome é...", "Somos uma empresa...", "Gostaria de me apresentar...", introduções longas, parágrafos descritivos sobre você
  - Tom: direto, confiante, como se já conhecesse o mercado do prospect` : ""}
- ${currentStep.channel === "linkedin" ? "LinkedIn: até 100 palavras, profissional" : ""}
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

Gere a mensagem personalizada para o step ${currentStep.step_order}.`,
              },
            ],
          }),
        });

        if (!aiRes.ok) {
          console.error(`AI error for enrollment ${enrollment.id}: ${aiRes.status}`);
          await aiRes.text();
          continue;
        }

        const aiData = await aiRes.json();
        const aiContent = aiData.choices?.[0]?.message?.content || "";

        let parsed;
        try {
          const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiContent];
          parsed = JSON.parse(jsonMatch[1].trim());
        } catch {
          parsed = { subject: null, message: aiContent };
        }

        let sendAction = "sent";

        // === CHANNEL-SPECIFIC SENDING ===
        if (currentStep.channel === "email" && lead.email) {
          try {
            const { error: sendError } = await supabase.functions.invoke("gmail-send", {
              body: {
                to: lead.email,
                subject: parsed.subject || `Mensagem para ${lead.name}`,
                html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${parsed.message.replace(/\n/g, "<br>")}</div>`,
                text: parsed.message,
                lead_id: lead.id,
                company_id: cadence.company_id,
              },
            });
            if (sendError) {
              console.error(`Gmail send error for enrollment ${enrollment.id}:`, sendError);
              sendAction = "failed";
            }
          } catch (emailErr) {
            console.error(`Gmail send exception for enrollment ${enrollment.id}:`, emailErr);
            sendAction = "failed";
          }
        } else if (currentStep.channel === "whatsapp" && (lead.whatsapp || lead.phone)) {
          // Send via Z-API com credenciais por empresa
          const zCfg = await getZApiConfig(supabase, cadence.company_id);
          if (zCfg) {
            const r = await sendWhatsAppViaZApi(zCfg, lead.whatsapp || lead.phone, parsed.message);
            if (!r.ok) {
              console.error(`Z-API WhatsApp error for ${enrollment.id}:`, r.error);
              sendAction = "failed";
            }
          } else {
            // Z-API não configurado — registra como tarefa manual
            sendAction = "pending_manual";
          }


        } else if (currentStep.channel === "linkedin") {
          // LinkedIn has no API — register as manual task
          sendAction = "pending_manual";
        }

        // Always log activity for every channel
        if (cadence.company_id && lead.id) {
          const channelEmoji = currentStep.channel === "email" ? "📧" : currentStep.channel === "whatsapp" ? "📱" : "💼";
          const statusLabel = sendAction === "sent" ? "enviado" : sendAction === "failed" ? "falhou" : "tarefa manual";
          const descParts = [`${channelEmoji} ${currentStep.channel.charAt(0).toUpperCase() + currentStep.channel.slice(1)} ${statusLabel} - Step ${currentStep.step_order}`];
          if (parsed.subject) descParts.push(`: ${parsed.subject}`);
          else descParts.push(`: ${parsed.message.substring(0, 100)}`);

          await supabase.from("lead_activities").insert({
            company_id: cadence.company_id,
            lead_id: lead.id,
            type: currentStep.channel === "multi_channel" ? "email" : currentStep.channel,
            description: descParts.join(""),
            metadata: {
              step_order: currentStep.step_order,
              cadence_id: cadence.id,
              action: sendAction,
              subject: parsed.subject,
              manual_task: sendAction === "pending_manual",
              ...(sendAction === "pending_manual" ? { full_message: parsed.message } : {}),
            },
          });
        }

        // Create or get conversation (reuses existing email conv if gmail-sync already created one)
        const conversation = await findOrCreateConversation(
          supabase, lead.id, cadence.company_id, currentStep.channel, enrollment.id
        );

        if (conversation) {
          await supabase.from("messages").insert({
            conversation_id: conversation.id,
            content: parsed.message,
            direction: "outbound",
            ai_suggested: true,
            metadata: { subject: parsed.subject, step_order: currentStep.step_order, auto_generated: true, channel: currentStep.channel },
          });
        }

        // Log execution
        await supabase.from("execution_logs").insert({
          company_id: cadence.company_id,
          enrollment_id: enrollment.id,
          step_id: currentStep.id,
          lead_id: lead.id,
          channel: currentStep.channel,
          action: sendAction,
          message_content: parsed.message,
          ai_context: { subject: parsed.subject, step_order: currentStep.step_order },
        });

        // Advance step
        const nextStep = steps.find((s: any) => s.step_order === enrollment.current_step + 1);
        const updateData: any = {
          current_step: enrollment.current_step + 1,
          last_executed_at: new Date().toISOString(),
        };

        if (nextStep) {
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + nextStep.delay_days);
          updateData.next_execution_at = nextDate.toISOString();
        } else {
          updateData.status = "completed";
          updateData.completed_at = new Date().toISOString();
          updateData.next_execution_at = null;
        }

        await supabase
          .from("cadence_enrollments")
          .update(updateData)
          .eq("id", enrollment.id);

        processed++;
      } catch (err) {
        console.error(`Error processing enrollment ${enrollment.id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({ processed, total: enrollments.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("cadence-executor error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
