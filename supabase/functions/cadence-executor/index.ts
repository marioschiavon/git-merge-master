import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getZApiConfig, sendWhatsAppViaZApi } from "../_shared/zapi-whatsapp.ts";
import { shouldGate, createApprovalRequest, isLeadUnderHumanTakeover } from "../_shared/hitl-gate.ts";

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

    // Optional single-enrollment mode for HITL re-execution after approval
    let singleEnrollmentId: string | null = null;
    let bypassHitl = false;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (body?.enrollment_id) singleEnrollmentId = body.enrollment_id;
        if (body?.bypass_hitl) bypassHitl = true;
      }
    } catch { /* ignore */ }

    let enrollmentsQuery = supabase
      .from("cadence_enrollments")
      .select(`
        *,
        leads(id, name, email, phone, whatsapp, whatsapp_valid, company_name, status, source, referral_source_lead_id, referral_role, referral_context),
        cadences(id, name, type, company_id, status, mode, kind)
      `);
    if (singleEnrollmentId) {
      enrollmentsQuery = enrollmentsQuery.eq("id", singleEnrollmentId);
    } else {
      enrollmentsQuery = enrollmentsQuery
        .eq("status", "active")
        .eq("meeting_scheduled", false)
        .lte("next_execution_at", new Date().toISOString())
        .not("next_execution_at", "is", null);
    }
    const { data: enrollments, error: enrollError } = await enrollmentsQuery;

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

        // Atomic claim to prevent duplicate sends from overlapping invocations.
        // Push next_execution_at 10 min into the future, but only if the row
        // still matches what we read. If another worker already claimed it,
        // the update returns 0 rows and we skip silently.
        const lockUntilIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const claimQuery = supabase
          .from("cadence_enrollments")
          .update({ next_execution_at: lockUntilIso })
          .eq("id", enrollment.id)
          .eq("status", "active")
          .eq("current_step", enrollment.current_step)
          .lte("next_execution_at", new Date().toISOString());
        const { data: claimed, error: claimError } = await claimQuery.select("id");
        if (claimError) {
          console.error(`Claim error for enrollment ${enrollment.id}:`, claimError);
          continue;
        }
        if (!claimed || claimed.length === 0) {
          // Another worker already picked this up.
          continue;
        }

        // Parallel-enrollment guard: if another active enrollment for the same lead
        // already executed in the last 24h, skip this one to avoid sending two
        // first contacts in parallel from different cadences.
        const { data: otherActive } = await supabase
          .from("cadence_enrollments")
          .select("id, last_executed_at")
          .eq("lead_id", enrollment.lead_id)
          .eq("status", "active")
          .neq("id", enrollment.id);
        const recentlyExecutedOther = (otherActive || []).find((e: any) => {
          if (!e.last_executed_at) return false;
          return Date.now() - new Date(e.last_executed_at).getTime() < 24 * 60 * 60 * 1000;
        });
        if (recentlyExecutedOther) {
          await supabase
            .from("cadence_enrollments")
            .update({ status: "paused", paused_reason: `Lead já recebeu contato de outra cadência (${recentlyExecutedOther.id}) nas últimas 24h` })
            .eq("id", enrollment.id);
          continue;
        }

        // === AGENTIC MODE: delegate decision to cadence-agent-decide ===
        if (cadence.mode === "agentic") {
          try {
            const { error: agentErr } = await supabase.functions.invoke("cadence-agent-decide", {
              body: { enrollment_id: enrollment.id },
            });
            if (agentErr) console.error(`agent-decide error for ${enrollment.id}:`, agentErr);
            else processed++;
          } catch (e) {
            console.error(`agent-decide exception for ${enrollment.id}:`, e);
          }
          continue;
        }






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

        // Skip WhatsApp steps if:
        //  - lead foi verificado como NÃO tendo WhatsApp (whatsapp_valid = false), OU
        //  - lead simplesmente não tem nenhum número (whatsapp/phone vazios) — comum em referral novo.
        const noWhatsNumber = !lead.whatsapp && !lead.phone;
        const skipWhatsapp =
          currentStep.channel === "whatsapp" &&
          (lead.whatsapp_valid === false || noWhatsNumber);
        if (skipWhatsapp) {
          const skipReason = lead.whatsapp_valid === false ? "lead_has_no_whatsapp" : "no_whatsapp_number";
          await supabase.from("execution_logs").insert({
            company_id: cadence.company_id, enrollment_id: enrollment.id,
            step_id: currentStep.id, lead_id: lead.id, channel: currentStep.channel,
            action: "skipped", message_content: null,
            ai_context: { skip_reason: skipReason, step_order: currentStep.step_order },
          });
          await supabase.from("lead_activities").insert({
            company_id: cadence.company_id, lead_id: lead.id, type: "whatsapp",
            description: `⏭️ WhatsApp pulado - Step ${currentStep.step_order} (${skipReason === "no_whatsapp_number" ? "lead sem número cadastrado" : "lead não tem WhatsApp"})`,
            metadata: { step_order: currentStep.step_order, cadence_id: cadence.id, action: "skipped", skip_reason: skipReason },
          });
          const nextStep = steps.find((s: any) => s.step_order === enrollment.current_step + 1);
          const updateData: any = { current_step: enrollment.current_step + 1, last_executed_at: new Date().toISOString() };
          // Quando pulamos por falta de canal, executa o próximo step IMEDIATAMENTE (sem aguardar delay_days)
          // para que email saia logo no lugar do WhatsApp.
          if (nextStep) { updateData.next_execution_at = new Date().toISOString(); }
          else { updateData.status = "completed"; updateData.completed_at = new Date().toISOString(); updateData.next_execution_at = null; }
          await supabase.from("cadence_enrollments").update(updateData).eq("id", enrollment.id);
          processed++;
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

          // Human takeover: pause enrollment and skip — operator owns the thread.
          if (!bypassHitl && await isLeadUnderHumanTakeover(supabase, { lead_id: lead.id })) {
            await supabase.from("cadence_enrollments").update({
              status: "paused", paused_reason: "human_takeover", next_execution_at: null,
            }).eq("id", enrollment.id);
            console.log("[cadence-executor] paused — human_takeover", { enrollment_id: enrollment.id, lead_id: lead.id });
            processed++;
            continue;
          }

          // HITL gate
          if (!bypassHitl) {
            const scope = enrollment.current_step === 1 ? "first_message" : "cadence_step";
            if (await shouldGate(supabase, cadence.company_id, scope as any, { lead_id: lead.id })) {
              await createApprovalRequest(supabase, {
                company_id: cadence.company_id,
                lead_id: lead.id,
                enrollment_id: enrollment.id,
                cadence_id: cadence.id,
                kind: scope as any,
                channel: currentStep.channel,
                payload: { subject: parsed.subject, message: parsed.message, step_id: currentStep.id, step_order: currentStep.step_order },
                context: { source: "custom_message", cadence_name: cadence.name },
              });
              await supabase.from("cadence_enrollments").update({
                status: "paused", paused_reason: "hitl_pending", next_execution_at: null,
              }).eq("id", enrollment.id);
              processed++;
              continue;
            }
          }

          let sendAction = "sent";
          let deliveryMeta: Record<string, any> = {};


          // === CHANNEL-SPECIFIC SENDING (same logic as below) ===
          // Pre-resolve conversation so gmail-send can attach the persisted email to it
          let preConversation: { id: string } | null = null;
          if (currentStep.channel === "email") {
            preConversation = await findOrCreateConversation(
              supabase, lead.id, cadence.company_id, currentStep.channel, enrollment.id
            );
          }
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
                  conversation_id: preConversation?.id,
                  extra_metadata: { step_order: currentStep.step_order, custom_message: true },
                },
              });
              if (sendError) { sendAction = "failed"; }
            } catch { sendAction = "failed"; }
          } else if (currentStep.channel === "whatsapp" && (lead.whatsapp || lead.phone)) {
            const zCfg = await getZApiConfig(supabase, cadence.company_id);
            if (zCfg) {
              const r = await sendWhatsAppViaZApi(zCfg, lead.whatsapp || lead.phone, parsed.message);
              if (r.ok) {
                deliveryMeta = { delivery_status: "delivered", zapi_message_id: r.sid, zapi_status: r.status, to_number: lead.whatsapp || lead.phone };
              } else {
                console.error("Z-API send failed:", r.error);
                sendAction = "failed";
                deliveryMeta = { delivery_status: "failed", zapi_status: r.status, zapi_error: r.error, to_number: lead.whatsapp || lead.phone };
              }
            } else {
              sendAction = "pending_manual";
              deliveryMeta = { delivery_status: "pending_manual", delivery_error: "Z-API não configurada" };
            }
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

          // For email, gmail-send already persisted the message to the conversation.
          // For other channels, insert the outbound message here.
          if (currentStep.channel !== "email") {
            const conversation = await findOrCreateConversation(
              supabase, lead.id, cadence.company_id, currentStep.channel, enrollment.id
            );
            if (conversation) {
              await supabase.from("messages").insert({ conversation_id: conversation.id, content: parsed.message, direction: "outbound", ai_suggested: false, metadata: { subject: parsed.subject, step_order: currentStep.step_order, custom_message: true, channel: currentStep.channel, ...deliveryMeta } });
            }
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

        // Contexto de indicação (apenas para cadências kind='referral')
        let referralContextBlock = "";
        let referrerName = "";
        let referrerCompany = "";
        if (cadence.kind === "referral" && lead.referral_source_lead_id) {
          const { data: referrer } = await supabase
            .from("leads")
            .select("name, company_name, title")
            .eq("id", lead.referral_source_lead_id)
            .maybeSingle();
          referrerName = referrer?.name || "";
          referrerCompany = referrer?.company_name || "";
          const ctxTxt = lead.referral_context || "";
          referralContextBlock = `\n\n=== INDICAÇÃO (PRIORIDADE MÁXIMA) ===
Este lead foi indicado por ${referrerName || "um contato nosso"}${referrerCompany ? ` (${referrerCompany})` : ""}${referrer?.title ? `, ${referrer.title}` : ""}.
Contexto da indicação: ${ctxTxt || "não detalhado"}
REGRAS OBRIGATÓRIAS PARA REFERRAL:
- ABRA mencionando que ${referrerName || "um contato em comum"} passou o contato (ex.: "Oi {nome}, o ${referrerName || "[indicante]"} me passou seu contato...").
- Se houver contexto da indicação, cite-o em 1 frase para dar legitimidade.
- Tom mais quente e direto — você NÃO é desconhecido, foi indicado.
- NÃO finja que descobriu o lead sozinho. NÃO ignore o indicante.`;
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
${referralContextBlock}

=== DIFERENCIAIS DO PROSPECT ===
${insightsContext || "Sem diferenciais disponíveis do prospect."}
${mentalTriggersContext}

=== TEMPLATE BASE DO STEP ===
${(currentStep.template || "Sem template definido.")
  .replaceAll("{{referrer_name}}", referrerName || "")
  .replaceAll("{{referrer_company}}", referrerCompany || "")
  .replaceAll("{{referral_context}}", lead.referral_context || "")}

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
  3. CTA (1 frase): Pergunta direta para agendar uma conversa rápida de apresentação — ex: "Faz sentido conversarmos essa semana?" (NÃO mencione duração em minutos; só diga a duração real se o lead perguntar)
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

        // HITL gate (AI-generated message path)
        if (!bypassHitl) {
          const scope = enrollment.current_step === 1 ? "first_message" : "cadence_step";
          if (await shouldGate(supabase, cadence.company_id, scope as any)) {
            await createApprovalRequest(supabase, {
              company_id: cadence.company_id,
              lead_id: lead.id,
              enrollment_id: enrollment.id,
              cadence_id: cadence.id,
              kind: scope as any,
              channel: currentStep.channel,
              payload: { subject: parsed.subject, message: parsed.message, step_id: currentStep.id, step_order: currentStep.step_order },
              context: { source: "ai_generated", cadence_name: cadence.name },
            });
            await supabase.from("cadence_enrollments").update({
              status: "paused", paused_reason: "hitl_pending", next_execution_at: null,
            }).eq("id", enrollment.id);
            processed++;
            continue;
          }
        }

        let sendAction = "sent";
        let deliveryMeta: Record<string, any> = {};


        // === CHANNEL-SPECIFIC SENDING ===
        // Pre-resolve conversation so gmail-send can attach the persisted email to it
        let preConversationAi: { id: string } | null = null;
        if (currentStep.channel === "email") {
          preConversationAi = await findOrCreateConversation(
            supabase, lead.id, cadence.company_id, currentStep.channel, enrollment.id
          );
        }
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
                conversation_id: preConversationAi?.id,
                extra_metadata: { step_order: currentStep.step_order, auto_generated: true },
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
            if (r.ok) {
              deliveryMeta = { delivery_status: "delivered", zapi_message_id: r.sid, zapi_status: r.status, to_number: lead.whatsapp || lead.phone };
            } else {
              console.error(`Z-API WhatsApp error for ${enrollment.id}:`, r.error);
              sendAction = "failed";
              deliveryMeta = { delivery_status: "failed", zapi_status: r.status, zapi_error: r.error, to_number: lead.whatsapp || lead.phone };
            }
          } else {
            // Z-API não configurado — registra como tarefa manual
            sendAction = "pending_manual";
            deliveryMeta = { delivery_status: "pending_manual", delivery_error: "Z-API não configurada" };
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

        // For email, gmail-send already persisted the message. For other channels, insert here.
        if (currentStep.channel !== "email") {
          const conversation = await findOrCreateConversation(
            supabase, lead.id, cadence.company_id, currentStep.channel, enrollment.id
          );

          if (conversation) {
            await supabase.from("messages").insert({
              conversation_id: conversation.id,
              content: parsed.message,
              direction: "outbound",
              ai_suggested: true,
              metadata: { subject: parsed.subject, step_order: currentStep.step_order, auto_generated: true, channel: currentStep.channel, ...deliveryMeta },
            });
          }
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
