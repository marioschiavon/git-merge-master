// Cadence Agent Decider — for cadences with mode='agentic'.
// Decides next action per enrollment: send / wait / stop / handoff_human.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getZApiConfig, sendWhatsAppViaZApi } from "../_shared/zapi-whatsapp.ts";
import { buildFirstMessage } from "../_shared/build-first-message.ts";
import { shouldGate, createApprovalRequest, isLeadUnderHumanTakeover } from "../_shared/hitl-gate.ts";
import { getEmailReplyContext } from "../_shared/email-thread.ts";

async function findOrCreateConversation(
  supabase: any,
  leadId: string,
  companyId: string,
  channel: string,
  enrollmentId: string,
): Promise<{ id: string } | null> {
  const { data: byEnroll } = await supabase
    .from("conversations").select("id")
    .eq("lead_id", leadId).eq("cadence_enrollment_id", enrollmentId).maybeSingle();
  if (byEnroll) return byEnroll;
  const { data: byChannel } = await supabase
    .from("conversations").select("id, cadence_enrollment_id")
    .eq("lead_id", leadId).eq("channel", channel)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (byChannel) {
    if (!byChannel.cadence_enrollment_id) {
      await supabase.from("conversations").update({ cadence_enrollment_id: enrollmentId }).eq("id", byChannel.id);
    }
    return { id: byChannel.id };
  }
  const { data: newConv } = await supabase
    .from("conversations")
    .insert({ lead_id: leadId, company_id: companyId, channel, cadence_enrollment_id: enrollmentId })
    .select("id").single();
  return newConv || null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Decision = {
  action: "send" | "wait" | "stop" | "handoff_human";
  channel?: "whatsapp" | "email";
  hook?: string;
  scheduled_for?: string;
  subject?: string;
  message?: string;
  rationale: string;
  stop_reason?: string;
};

// Returns next allowed slot ISO respecting business hours.
function nextAllowedSlot(from: Date, bh: any, _leadTz?: string): string {
  const tz = bh?.tz || "America/Sao_Paulo";
  const days: number[] = bh?.days || [1, 2, 3, 4, 5];
  const [sH, sM] = (bh?.start || "09:00").split(":").map(Number);
  const [eH, _eM] = (bh?.end || "18:00").split(":").map(Number);

  // Use locale parts in the configured tz
  const inTz = (d: Date) =>
    new Date(d.toLocaleString("en-US", { timeZone: tz }));

  let candidate = new Date(from);
  for (let i = 0; i < 14; i++) {
    const local = inTz(candidate);
    const dow = local.getDay(); // 0..6
    const hour = local.getHours();
    if (days.includes(dow) && hour >= sH && hour < eH) {
      return candidate.toISOString();
    }
    // Push to next start window
    candidate = new Date(candidate.getTime() + 60 * 60 * 1000); // +1h and re-check
  }
  return candidate.toISOString();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const reqBody = await req.json();
    const { enrollment_id, bypass_hitl, override_decision, dry_run } = reqBody as {
      enrollment_id?: string;
      bypass_hitl?: boolean;
      override_decision?: Partial<Decision>;
      dry_run?: boolean;
    };
    if (!enrollment_id) {
      return new Response(JSON.stringify({ error: "enrollment_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const dryRun = !!dry_run;

    // Idempotency — skip in dry_run; preview is read-only and re-requestable.
    if (!dryRun && !bypass_hitl && !override_decision) {
      const { data: recent } = await supabase
        .from("cadence_agent_decisions")
        .select("id, decided_at")
        .eq("enrollment_id", enrollment_id)
        .gte("decided_at", new Date(Date.now() - 30_000).toISOString())
        .limit(1);
      if (recent && recent.length > 0) {
        return new Response(JSON.stringify({ skipped: "recent_decision" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Load enrollment + cadence + policy + lead
    const { data: enrollment, error: enrErr } = await supabase
      .from("cadence_enrollments")
      .select(`
        *,
        leads(*),
        cadences(id, name, company_id, mode, status, simulation_mode, kind)
      `)
      .eq("id", enrollment_id)
      .maybeSingle();
    if (enrErr || !enrollment) throw new Error("enrollment not found");

    const cadence = (enrollment as any).cadences;
    const lead = (enrollment as any).leads;
    if (!cadence || cadence.mode !== "agentic") {
      return new Response(JSON.stringify({ skipped: "not_agentic" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: policy } = await supabase
      .from("cadence_policies")
      .select("*")
      .eq("cadence_id", cadence.id)
      .maybeSingle();
    if (!policy) throw new Error("policy missing for agentic cadence");

    const attemptNumber = enrollment.current_step;
    const daysSinceEnroll =
      (Date.now() - new Date(enrollment.enrolled_at).getTime()) / 86400000;

    // Helper to persist decision and update enrollment
    const persistDecision = async (
      d: Decision,
      extras: Record<string, any> = {},
    ) => {
      if (dryRun) return;
      await supabase.from("cadence_agent_decisions").insert({
        enrollment_id,
        company_id: cadence.company_id,
        attempt_number: attemptNumber,
        action: d.action,
        channel: d.channel || null,
        hook: d.hook || null,
        scheduled_for: d.scheduled_for || null,
        message_subject: d.subject || null,
        message_body: d.message || null,
        rationale: d.rationale,
        stop_reason: d.stop_reason || null,
        simulated: !!cadence.simulation_mode,
        ...extras,
      });
    };
    // Helper to update enrollment, skipped in dry_run
    const updateEnrollment = async (patch: Record<string, any>) => {
      if (dryRun) return;
      await supabase.from("cadence_enrollments").update(patch).eq("id", enrollment_id);
    };

    const earlyStop = async (rationale: string, stop_reason: string) => {
      const d: Decision = { action: "stop", rationale, stop_reason };
      await persistDecision(d);
      await updateEnrollment({ status: "completed", completed_at: new Date().toISOString(), next_execution_at: null });
      return new Response(JSON.stringify({ action: "stop", reason: stop_reason, decision: d }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    };

    // === DETERMINISTIC STOP CHECKS (sempre ativos) ===
    if (attemptNumber > policy.max_attempts) {
      return await earlyStop(`Atingiu máximo de ${policy.max_attempts} tentativas.`, "max_attempts");
    }
    if (daysSinceEnroll > policy.max_days) {
      return await earlyStop(`Passou do prazo de ${policy.max_days} dias.`, "max_days");
    }
    if (enrollment.meeting_scheduled) {
      return await earlyStop("Reunião já agendada.", "meeting_booked");
    }

    // Recent intents
    const { data: intents } = await supabase
      .from("lead_intents_log")
      .select("category, sub_intent, message_excerpt, created_at")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(5);

    const lastIntent = intents?.[0];
    if (lastIntent?.category === "rejection") {
      return await earlyStop("Lead manifestou rejeição/sem interesse.", "no_interest");
    }
    if (lastIntent?.category === "compliance") {
      return await earlyStop("Lead pediu opt-out / remoção.", "opt_out");
    }


    // === RESOLVE EFFECTIVE PRIMARY CHANNEL BASED ON LEAD CONTACT ===
    const allowed: string[] = policy.allowed_channels || [];
    const hasWhatsapp = !!(lead.whatsapp || lead.phone) && lead.whatsapp_valid !== false;
    const hasEmail = !!lead.email;
    let effectivePrimary: string = policy.primary_channel;
    let channelNote = "";
    if (hasWhatsapp && hasEmail && allowed.includes("whatsapp")) {
      effectivePrimary = "whatsapp";
      channelNote = "O lead tem WhatsApp E e-mail disponíveis — prefira WhatsApp. Só use e-mail como apoio se já tentou WhatsApp nas últimas 2 tentativas sem resposta, ou se o envio por WhatsApp falhou.";
    } else if (hasWhatsapp && !hasEmail && allowed.includes("whatsapp")) {
      effectivePrimary = "whatsapp";
      channelNote = "O lead tem APENAS WhatsApp (sem e-mail cadastrado). PROIBIDO escolher channel=email — NUNCA, independente de quantas tentativas no WhatsApp não responderam. Use SEMPRE whatsapp.";
    } else if (!hasWhatsapp && hasEmail && allowed.includes("email")) {
      effectivePrimary = "email";
      channelNote = "O lead tem APENAS e-mail (sem WhatsApp cadastrado). PROIBIDO escolher channel=whatsapp. Use SEMPRE email.";
    } else if (!hasWhatsapp && !hasEmail) {
      return await earlyStop("Lead sem WhatsApp e sem e-mail — sem canal disponível.", "no_contact");
    }




    // === FIRST-ATTEMPT SHORTCUT ===
    // For the first outbound, reuse the standard first-message engine
    // (knowledge + highlights + ai_instructions + insights + social + tone)
    // instead of asking the agent LLM to decide. The agent only takes over
    // from the 2nd touch onward.
    const { data: priorSends } = await supabase
      .from("cadence_agent_decisions")
      .select("id")
      .eq("enrollment_id", enrollment_id)
      .eq("action", "send")
      .limit(1);
    const isFirstAttempt = !priorSends || priorSends.length === 0;

    let decision: Decision;

    if (override_decision && override_decision.action) {
      // Approved/edited via HITL or SDR draft → skip first-message engine and LLM, use provided decision.
      decision = {
        action: override_decision.action,
        channel: override_decision.channel,
        hook: override_decision.hook,
        subject: override_decision.subject,
        message: override_decision.message,
        rationale: override_decision.rationale || "Decisão aprovada por humano via HITL.",
      } as Decision;
      // Audit trail: SDR edited the AI draft inline before sending.
      const editedByHuman = (override_decision as any).edited_by_human === true;
      if (editedByHuman && !dryRun) {
        await supabase.from("lead_activities").insert({
          company_id: cadence.company_id,
          lead_id: lead.id,
          type: "system",
          description: "✏️ SDR editou o rascunho da IA antes de enviar",
          metadata: {
            source: "cadence_agent",
            cadence_id: cadence.id,
            enrollment_id,
            original_message: (override_decision as any).original_message || null,
            final_message: decision.message || null,
          },
        });
      }
    } else if (isFirstAttempt) {
      try {
        // Build referral hint (safe label) if this is a referral cadence.
        let referralHint: { label: string; context?: string | null; referrerCompany?: string | null; hasRealName?: boolean } | null = null;
        if (cadence.kind === "referral" && lead.referral_source_lead_id) {
          const { buildReferrerLabel } = await import("../_shared/referrer-label.ts");
          const { data: referrer } = await supabase
            .from("leads")
            .select("name, company_name")
            .eq("id", lead.referral_source_lead_id)
            .maybeSingle();
          const lbl = buildReferrerLabel(referrer);
          referralHint = {
            label: lbl.label,
            context: lead.referral_context || null,
            referrerCompany: lbl.companyClean || null,
            hasRealName: !!lbl.nameClean,
          };
        }
        const first = await buildFirstMessage({
          supabase,
          lovableApiKey: LOVABLE_API_KEY,
          companyId: cadence.company_id,
          lead,
          channel: effectivePrimary as "whatsapp" | "email",
          goal: policy.goal,
          referralHint,
        });
        decision = {
          action: "send",
          channel: effectivePrimary as any,
          hook: "diagnostic",
          subject: first.subject || undefined,
          message: first.message,
          rationale:
            "Primeira mensagem gerada pelo motor padrão (knowledge da empresa, highlights, insights do lead e instruções da empresa). IA agêntica assume a partir do 2º toque.",
        };
      } catch (e) {
        console.error("buildFirstMessage failed, falling back to agent LLM", e);
        // fall through to agent LLM path
      }
    }

    if (!override_decision && (!isFirstAttempt || !decision!)) {

    const [convsRes, prevDecisionsRes, kbRes, highlightsRes, aiInstrRes] = await Promise.all([
      supabase.from("conversations").select("id, channel").eq("lead_id", lead.id),
      supabase
        .from("cadence_agent_decisions")
        .select("attempt_number, action, channel, hook, rationale, decided_at")
        .eq("enrollment_id", enrollment_id)
        .order("decided_at", { ascending: false })
        .limit(10),
      supabase
        .from("company_knowledge")
        .select("title, content")
        .eq("company_id", cadence.company_id)
        .not("type", "in", "(highlights,ai_instructions)")
        .limit(8),
      supabase
        .from("company_knowledge")
        .select("content")
        .eq("company_id", cadence.company_id)
        .eq("type", "highlights")
        .maybeSingle(),
      supabase
        .from("company_knowledge")
        .select("content")
        .eq("company_id", cadence.company_id)
        .eq("type", "ai_instructions")
        .maybeSingle(),
    ]);

    const convIds = (convsRes.data || []).map((c: any) => c.id);
    let recentMessages: any[] = [];
    if (convIds.length > 0) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("content, direction, created_at, metadata")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: false })
        .limit(10);
      recentMessages = (msgs || []).reverse();
    }

    const historyText = recentMessages
      .map(
        (m) =>
          `[${m.direction === "outbound" ? "SDR" : "LEAD"} ${new Date(m.created_at).toLocaleDateString("pt-BR")}]: ${(m.content || "").slice(0, 240)}`,
      )
      .join("\n");

    const prevDecisionsText = (prevDecisionsRes.data || [])
      .map(
        (d: any) =>
          `- tentativa ${d.attempt_number}: ${d.action}${d.channel ? `/${d.channel}` : ""}${d.hook ? ` (${d.hook})` : ""} — ${d.rationale}`,
      )
      .join("\n");

    const intentsText = (intents || [])
      .map((i: any) => `- ${i.category}${i.sub_intent ? `/${i.sub_intent}` : ""}: "${(i.message_excerpt || "").slice(0, 100)}"`)
      .join("\n");

    const knowledgeContext = (kbRes.data || [])
      .map((k: any) => `## ${k.title}\n${k.content}`)
      .join("\n\n");

    const { getMeetingDurationMinutes, meetingDurationPromptBlock } = await import("../_shared/meeting-duration.ts");
    const meetingMinutes = await getMeetingDurationMinutes(supabase, cadence.company_id);
    const durationBlock = meetingDurationPromptBlock(meetingMinutes);

    const systemPrompt = `Você é um SDR B2B em português brasileiro, operando uma cadência inteligente.

=== OBJETIVO DA CADÊNCIA ===
${policy.goal}

=== POLÍTICA / LIMITES ===
- Máx tentativas: ${policy.max_attempts} (essa é a tentativa ${attemptNumber})
- Prazo: ${policy.max_days} dias (já se passaram ${Math.round(daysSinceEnroll)} dias)
- Canais permitidos: ${(policy.allowed_channels || []).join(", ")}
- Canal principal preferido: ${effectivePrimary}${channelNote ? `\n- IMPORTANTE: ${channelNote}` : ""}

=== BASE DE CONHECIMENTO (ÚNICA FONTE DE FATOS) ===
${highlightsRes.data?.content ? `DIFERENCIAIS:\n${highlightsRes.data.content}\n\n` : ""}${knowledgeContext || "(vazia)"}
${aiInstrRes.data?.content ? `\n=== INSTRUÇÕES E TOM DA EMPRESA (siga rigorosamente) ===\n${aiInstrRes.data.content}` : ""}
${durationBlock}

=== REGRAS ANTI-ALUCINAÇÃO ===
- Use APENAS fatos da base. Nunca invente features, números, integrações ou clientes.
- NUNCA prometa lembretes, follow-ups ativos ou retornos por iniciativa ("eu te lembro amanhã", "te aviso mais tarde"). Se o lead pedir tempo, responda passivamente: agradeça e diga que fica no aguardo.
- Se já existe reunião agendada e o lead apenas agradeceu, ação='stop' com reason='meeting_booked'.

=== AÇÕES POSSÍVEIS ===
- send: envia mensagem agora ou agendada (você escolhe canal + texto + hook).
- wait: nenhuma mensagem agora, reagenda próximo tick (use raramente).
- stop: encerra cadência (use stop_reason: no_interest|opt_out|meeting_booked|low_fit|other).
- handoff_human: passa para humano (lead pediu falar com alguém, caso complexo, reclamação).

Hooks possíveis (campo hook): short_followup | new_info | change_hook | diagnostic | ask_referral | suggest_slot | reengage

=== HEURÍSTICA DE CANAL ===
- Tentativa 1: canal principal (${effectivePrimary}).
- Se mandou X no canal A e não respondeu, alterne para o outro canal permitido.
- Email aceita mais palavras; whatsapp deve ser curto (≤60 palavras), sem assinatura formal.

Responda APENAS JSON com este shape:
{
  "action": "send"|"wait"|"stop"|"handoff_human",
  "channel": "whatsapp"|"email"|null,
  "hook": "short_followup"|"new_info"|"change_hook"|"diagnostic"|"ask_referral"|"suggest_slot"|"reengage"|null,
  "subject": "<assunto se email, null caso contrário>",
  "message": "<texto da mensagem se action=send>",
  "rationale": "<por que você escolheu essa ação em 1-2 frases>",
  "stop_reason": "<obrigatório se action=stop>"
}`;

    const userPrompt = `Lead: ${lead.name} — ${lead.company_name || "(sem empresa)"} — ${lead.title || ""}
Email: ${lead.email || "N/A"} (cadastrado: ${hasEmail ? "sim" : "NÃO"}) | WhatsApp: ${lead.whatsapp || lead.phone || "N/A"} (cadastrado: ${hasWhatsapp ? "sim" : "NÃO"})
Fit score: ${lead.score ?? "?"}

=== INTENTS RECENTES DO LEAD ===
${intentsText || "(nenhum)"}

=== HISTÓRICO RECENTE DE MENSAGENS ===
${historyText || "(sem mensagens prévias)"}

=== DECISÕES ANTERIORES DA IA NESTA CADÊNCIA ===
${prevDecisionsText || "(primeira tentativa)"}

Decida a próxima ação.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const status = aiRes.status;
      const body = await aiRes.text();
      console.error("AI gateway error", status, body);
      return new Response(JSON.stringify({ error: "ai_error", status }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || "{}";
    try {
      decision = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      decision = m ? JSON.parse(m[0]) : { action: "wait", rationale: "parse_failed" };
    }

    } // end if(!isFirstAttempt || !decision)



    // Normalize channel against allowed
    if (decision.channel && !(policy.allowed_channels || []).includes(decision.channel)) {
      decision.channel = effectivePrimary as any;
    }

    // === DETERMINISTIC CONTACT GUARDRAIL ===
    // Authoritative override: ignore the LLM if it picked a channel the lead can't receive.
    if (decision.action === "send") {
      const originalChannel = decision.channel;
      if (decision.channel === "email" && !hasEmail) {
        if (hasWhatsapp) {
          decision.channel = "whatsapp" as any;
          decision.subject = null;
          decision.rationale = `[override] canal trocado de email→whatsapp porque lead sem e-mail cadastrado. ${decision.rationale || ""}`.trim();
        } else {
          decision.action = "stop" as any;
          (decision as any).stop_reason = "no_contact";
          decision.rationale = `[override] stop: lead sem e-mail e sem WhatsApp. ${decision.rationale || ""}`.trim();
        }
      } else if (decision.channel === "whatsapp" && !hasWhatsapp) {
        if (hasEmail) {
          decision.channel = "email" as any;
          decision.rationale = `[override] canal trocado de whatsapp→email porque lead sem WhatsApp cadastrado. ${decision.rationale || ""}`.trim();
        } else {
          decision.action = "stop" as any;
          (decision as any).stop_reason = "no_contact";
          decision.rationale = `[override] stop: lead sem WhatsApp e sem e-mail. ${decision.rationale || ""}`.trim();
        }
      }
      if (originalChannel !== decision.channel) {
        console.log(`[cadence-agent-decide] channel override: ${originalChannel} → ${decision.channel} (enrollment=${enrollment_id})`);
      }
    }

    // Compute scheduled_for respecting business hours when sending
    let scheduledFor: string | null = null;
    if (decision.action === "send") {
      scheduledFor = nextAllowedSlot(new Date(), policy.business_hours);
      decision.scheduled_for = scheduledFor;
    }

    // === DRY-RUN: return decision without any side effect ===
    if (dryRun) {
      return new Response(JSON.stringify({ decision, dry_run: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === EXECUTE ===
    if (decision.action === "stop") {
      await persistDecision(decision, { model: "google/gemini-2.5-flash" });
      await supabase
        .from("cadence_enrollments")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          next_execution_at: null,
        })
        .eq("id", enrollment_id);
    } else if (decision.action === "handoff_human") {
      await persistDecision(decision, { model: "google/gemini-2.5-flash" });
      await supabase
        .from("cadence_enrollments")
        .update({
          status: "paused",
          paused_reason: "handoff",
          next_execution_at: null,
        })
        .eq("id", enrollment_id);
      await supabase.from("lead_activities").insert({
        company_id: cadence.company_id,
        lead_id: lead.id,
        type: "handoff",
        description: `🤝 IA solicitou handoff humano: ${decision.rationale}`,
        metadata: { cadence_id: cadence.id, enrollment_id, rationale: decision.rationale },
      });
      await supabase
        .from("leads")
        .update({ handoff_required: true, handoff_reason: decision.rationale, handoff_at: new Date().toISOString() })
        .eq("id", lead.id);
    } else if (decision.action === "send" && decision.channel && decision.message) {
      // Inline send: email via gmail-send, whatsapp via Z-API.
      const channel = decision.channel;
      const isSimulation = !!cadence.simulation_mode;

      // === Human takeover: operator owns the thread — pause & skip ===
      if (!isSimulation && !bypass_hitl && await isLeadUnderHumanTakeover(supabase, { lead_id: lead.id })) {
        await persistDecision(decision, { model: "google/gemini-2.5-flash" });
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "human_takeover", next_execution_at: null })
          .eq("id", enrollment_id);
        await supabase.from("lead_activities").insert({
          company_id: cadence.company_id,
          lead_id: lead.id,
          type: "system",
          description: `⏸️ Cadência pausada — operador no controle (human_takeover)`,
          metadata: { source: "cadence_agent", cadence_id: cadence.id, enrollment_id, human_takeover: true, channel },
        });
        return new Response(JSON.stringify({ action: "skipped_human_takeover", channel }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // === HITL gate (only for real sends, not simulation, not when bypassed) ===
      const scope = isFirstAttempt ? "first_message" : "cadence_step";
      if (!isSimulation && !bypass_hitl && await shouldGate(supabase, cadence.company_id, scope as any, { lead_id: lead.id })) {
        // Persist the decision so it shows up in the cadence timeline
        await persistDecision(decision, { model: "google/gemini-2.5-flash" });
        // Create approval request for the operator
        await createApprovalRequest(supabase, {
          company_id: cadence.company_id,
          lead_id: lead.id,
          enrollment_id,
          cadence_id: cadence.id,
          kind: scope as any,
          channel,
          action: "agentic_send",
          payload: {
            subject: decision.subject || null,
            message: decision.message,
            hook: decision.hook || null,
            attempt: attemptNumber,
            agentic: true,
          },
          context: {
            rationale: decision.rationale,
            cadence_name: cadence.name,
            attempt: attemptNumber,
          },
        });
        // Pause enrollment so the executor doesn't keep re-firing
        await supabase
          .from("cadence_enrollments")
          .update({
            status: "paused",
            paused_reason: "awaiting_approval",
            next_execution_at: null,
          })
          .eq("id", enrollment_id);
        await supabase.from("lead_activities").insert({
          company_id: cadence.company_id,
          lead_id: lead.id,
          type: "system",
          description: `🕓 IA propôs envio (${channel}/${decision.hook || "-"}) — aguardando aprovação humana`,
          metadata: { source: "cadence_agent", cadence_id: cadence.id, enrollment_id, hitl: true, channel },
        });
        return new Response(JSON.stringify({ action: "pending_approval", channel }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let sendAction = isSimulation ? "simulated" : "sent";
      let deliveryMeta: Record<string, any> = isSimulation ? { delivery_status: "simulated" } : {};
      const conversation = isSimulation
        ? null
        : await findOrCreateConversation(
            supabase, lead.id, cadence.company_id, channel, enrollment_id
          );



      if (isSimulation) {
        // Dry-run: do NOT call gmail-send / Z-API and do NOT insert into messages.
        // The message text stays in cadence_agent_decisions.message_body.
      } else if (channel === "email" && lead.email) {
        try {
          const { error: sendError } = await supabase.functions.invoke("gmail-send", {
            body: {
              to: lead.email,
              subject: decision.subject || `Mensagem para ${lead.name}`,
              html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${(decision.message || "").replace(/\n/g, "<br>")}</div>`,
              text: decision.message,
              lead_id: lead.id,
              company_id: cadence.company_id,
              conversation_id: conversation?.id,
              extra_metadata: { source: "cadence_agent", cadence_id: cadence.id, enrollment_id, hook: decision.hook, attempt: attemptNumber },
            },
          });
          if (sendError) { console.error("gmail-send error", sendError); sendAction = "failed"; }
        } catch (e) { console.error("gmail-send exception", e); sendAction = "failed"; }
      } else if (channel === "whatsapp" && (lead.whatsapp || lead.phone)) {
        const zCfg = await getZApiConfig(supabase, cadence.company_id);
        if (zCfg) {
          const r = await sendWhatsAppViaZApi(zCfg, lead.whatsapp || lead.phone, decision.message);
          if (r.ok) deliveryMeta = { delivery_status: "delivered", zapi_message_id: r.sid, zapi_status: r.status };
          else { sendAction = "failed"; deliveryMeta = { delivery_status: "failed", zapi_error: r.error }; }
        } else { sendAction = "pending_manual"; deliveryMeta = { delivery_status: "pending_manual", delivery_error: "Z-API não configurada" }; }
        if (conversation) {
          await supabase.from("messages").insert({
            conversation_id: conversation.id,
            content: decision.message,
            direction: "outbound",
            ai_suggested: true,
            metadata: { source: "cadence_agent", hook: decision.hook, attempt: attemptNumber, channel, ...deliveryMeta },
          });
        }
      } else {
        sendAction = "failed";
        deliveryMeta = { delivery_status: "failed", delivery_error: `Lead sem contato para canal ${channel}` };
      }

      const noContactFailure = sendAction === "failed"
        && typeof (deliveryMeta as any).delivery_error === "string"
        && (deliveryMeta as any).delivery_error.startsWith("Lead sem contato");

      // Activity log — honest about what actually happened
      const previewText = (decision.subject || decision.message || "").substring(0, 100);
      let actDesc: string;
      let actType: string = channel;
      if (isSimulation) {
        actDesc = `🧪 [SIMULAÇÃO] IA geraria (${channel}/${decision.hook || "-"}) - tentativa ${attemptNumber}: ${previewText}`;
      } else if (sendAction === "failed") {
        const errMsg = (deliveryMeta as any).delivery_error || (deliveryMeta as any).zapi_error || "erro desconhecido";
        actDesc = `⚠️ IA tentou enviar (${channel}/${decision.hook || "-"}) - falhou: ${errMsg}`;
        actType = "system";
      } else if (sendAction === "pending_manual") {
        actDesc = `📝 IA gerou (${channel}/${decision.hook || "-"}) — pendente de envio manual: ${previewText}`;
        actType = "system";
      } else {
        actDesc = `🤖 IA enviou (${channel}/${decision.hook || "-"}) - tentativa ${attemptNumber}: ${previewText}`;
      }
      await supabase.from("lead_activities").insert({
        company_id: cadence.company_id,
        lead_id: lead.id,
        type: actType,
        description: actDesc,
        metadata: { source: "cadence_agent", cadence_id: cadence.id, enrollment_id, action: sendAction, hook: decision.hook, simulated: isSimulation, ...deliveryMeta },
      });

      await persistDecision(decision, { model: "google/gemini-2.5-flash" });

      if (noContactFailure && !isSimulation) {
        // Don't burn the attempt — close the enrollment and stop.
        await supabase
          .from("cadence_enrollments")
          .update({
            status: "completed",
            paused_reason: "no_contact_channel",
            completed_at: new Date().toISOString(),
            next_execution_at: null,
          } as any)
          .eq("id", enrollment_id);
        await supabase.from("lead_intents_log").insert({
          company_id: cadence.company_id,
          lead_id: lead.id,
          category: "no_response",
          metadata: { source: "cadence-agent-decide", enrollment_id, reason: "no_contact_channel", channel },
        } as any).then(() => null, () => null);
      } else {
        const nextDelayHours = attemptNumber <= 1 ? 48 : 72;
        const nextTick = nextAllowedSlot(
          new Date(Date.now() + nextDelayHours * 3600 * 1000),
          policy.business_hours,
        );
        await supabase
          .from("cadence_enrollments")
          .update({
            current_step: attemptNumber + 1,
            last_executed_at: new Date().toISOString(),
            next_execution_at: nextTick,
          })
          .eq("id", enrollment_id);
      }
    } else {
      // wait
      await persistDecision(decision, { model: "google/gemini-2.5-flash" });
      const nextTick = nextAllowedSlot(
        new Date(Date.now() + 24 * 3600 * 1000),
        policy.business_hours,
      );
      await supabase
        .from("cadence_enrollments")
        .update({ next_execution_at: nextTick })
        .eq("id", enrollment_id);
    }

    return new Response(JSON.stringify({ decision }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cadence-agent-decide error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
