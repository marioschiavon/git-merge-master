import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TWILIO_GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";

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

        // Get company knowledge for context
        const { data: knowledge } = await supabase
          .from("company_knowledge")
          .select("title, content")
          .eq("company_id", cadence.company_id)
          .limit(10);

        const knowledgeContext = (knowledge || [])
          .map((k: any) => `## ${k.title}\n${k.content}`)
          .join("\n\n");

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

CONTEXTO DA EMPRESA (produto/serviço que você vende):
${knowledgeContext || "Sem informações adicionais do produto."}

TEMPLATE BASE DO STEP:
${currentStep.template || "Sem template definido."}

CANAL: ${currentStep.channel}
STEP: ${currentStep.step_order} de ${steps.length}

REGRAS:
- Personalize a mensagem com os dados do lead
- Mantenha o tom profissional mas humano
- ${currentStep.channel === "whatsapp" ? "WhatsApp: mensagem curta, até 80 palavras, informal" : ""}
- ${currentStep.channel === "email" ? "Email: até 150 palavras, profissional, inclua subject" : ""}
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
            const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceKey}`,
                "apikey": serviceKey,
              },
              body: JSON.stringify({
                templateName: "cadence-outreach",
                recipientEmail: lead.email,
                idempotencyKey: `cadence-${enrollment.id}-step-${currentStep.step_order}`,
                templateData: {
                  leadName: lead.name,
                  subject: parsed.subject || `Mensagem para ${lead.name}`,
                  messageBody: parsed.message,
                },
              }),
            });
            if (!sendRes.ok) {
              const errText = await sendRes.text();
              console.error(`Email send error for enrollment ${enrollment.id}:`, errText);
              sendAction = "failed";
            }
          } catch (emailErr) {
            console.error(`Email send exception for enrollment ${enrollment.id}:`, emailErr);
            sendAction = "failed";
          }
        } else if (currentStep.channel === "whatsapp" && lead.phone) {
          // Send via Twilio WhatsApp Gateway
          const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
          const TWILIO_PHONE = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

          if (TWILIO_API_KEY && TWILIO_PHONE) {
            try {
              const twilioRes = await fetch(`${TWILIO_GATEWAY_URL}/Messages.json`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "X-Connection-Api-Key": TWILIO_API_KEY,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  To: `whatsapp:${lead.phone}`,
                  From: `whatsapp:${TWILIO_PHONE}`,
                  Body: parsed.message,
                }),
              });

              if (!twilioRes.ok) {
                const errData = await twilioRes.text();
                console.error(`Twilio WhatsApp error for ${enrollment.id}:`, errData);
                sendAction = "failed";
              }
            } catch (e) {
              console.error(`Twilio WhatsApp exception for ${enrollment.id}:`, e);
              sendAction = "failed";
            }
          } else {
            // Twilio not configured — register as manual task
            sendAction = "pending_manual";
            if (cadence.company_id && lead.id) {
              await supabase.from("lead_activities").insert({
                company_id: cadence.company_id,
                lead_id: lead.id,
                type: "whatsapp",
                description: `📱 WhatsApp pendente (Twilio não configurado): ${parsed.message.substring(0, 200)}`,
                metadata: { step_order: currentStep.step_order, cadence_id: cadence.id, manual_task: true },
              });
            }
          }
        } else if (currentStep.channel === "linkedin") {
          // LinkedIn has no API — register as manual task
          sendAction = "pending_manual";
          if (cadence.company_id && lead.id) {
            await supabase.from("lead_activities").insert({
              company_id: cadence.company_id,
              lead_id: lead.id,
              type: "linkedin",
              description: `💼 LinkedIn (tarefa manual): ${parsed.message.substring(0, 200)}`,
              metadata: { step_order: currentStep.step_order, cadence_id: cadence.id, manual_task: true, full_message: parsed.message },
            });
          }
        }

        // Create or get conversation
        let { data: conversation } = await supabase
          .from("conversations")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("cadence_enrollment_id", enrollment.id)
          .maybeSingle();

        if (!conversation) {
          const { data: newConv } = await supabase
            .from("conversations")
            .insert({
              lead_id: lead.id,
              company_id: cadence.company_id,
              channel: currentStep.channel,
              cadence_enrollment_id: enrollment.id,
            })
            .select()
            .single();
          conversation = newConv;
        }

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
