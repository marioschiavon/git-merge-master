import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { formatBRTLong } from "../_shared/datetime.ts";
import { getZApiConfig, sendWhatsAppViaZApi } from "../_shared/zapi-whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Stage = "suggested_new" | "link_sent" | "closing_attempt" | "no_response";

const HOURS_TO_NEXT: Record<Stage, number | null> = {
  suggested_new: 24,
  link_sent: 48,
  closing_attempt: 72,
  no_response: null,
};

function nextStage(current: Stage | null): Stage {
  if (!current) return "suggested_new";
  if (current === "suggested_new") return "link_sent";
  if (current === "link_sent") return "closing_attempt";
  return "no_response";
}

async function pickPreferredChannel(supabase: any, leadId: string, companyId: string): Promise<string> {
  const { data } = await supabase
    .from("lead_activities")
    .select("type")
    .eq("lead_id", leadId)
    .eq("company_id", companyId)
    .in("type", ["email", "whatsapp", "linkedin"]);
  if (!data || data.length === 0) return "email";
  const counts: Record<string, number> = {};
  for (const a of data) counts[a.type] = (counts[a.type] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

async function ensureConversation(
  supabase: any,
  leadId: string,
  companyId: string,
  conversationId: string | null,
  channel: string,
): Promise<string | null> {
  if (conversationId) return conversationId;
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("lead_id", leadId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conv?.id) return conv.id;
  const { data: newConv } = await supabase
    .from("conversations")
    .insert({ lead_id: leadId, company_id: companyId, channel: channel as any })
    .select()
    .single();
  return newConv?.id || null;
}

async function sendMessage(
  supabase: any,
  args: { leadId: string; companyId: string; conversationId: string; channel: string; message: string; lead: any; stage: Stage },
) {
  await supabase.from("messages").insert({
    conversation_id: args.conversationId,
    content: args.message,
    direction: "outbound",
    ai_suggested: false,
    metadata: { slot_expiry_followup: true, stage: args.stage, channel: args.channel },
  });

  if (args.channel === "email" && args.lead?.email) {
    await supabase.functions.invoke("send-transactional-email", {
      body: {
        templateName: "cadence-outreach",
        recipientEmail: args.lead.email,
        idempotencyKey: `slot-expiry-${args.stage}-${args.leadId}-${Date.now()}`,
        templateData: {
          leadName: args.lead.name,
          subject: args.stage === "closing_attempt"
            ? "Ainda faz sentido conversarmos?"
            : "Horários atualizados para nossa reunião",
          messageBody: args.message,
        },
      },
    });
  } else if (args.channel === "whatsapp" && (args.lead?.whatsapp || args.lead?.phone)) {
    try {
      const zCfg = await getZApiConfig(supabase, args.companyId);
      if (zCfg) {
        await sendWhatsAppViaZApi(zCfg, args.lead.whatsapp || args.lead.phone, args.message);
      }
    } catch (e) {
      console.error("WhatsApp send error:", e);
    }
  }

  await supabase.from("lead_activities").insert({
    company_id: args.companyId,
    lead_id: args.leadId,
    type: args.channel === "whatsapp" ? "whatsapp" : args.channel === "linkedin" ? "linkedin" : "email",
    description: `🔁 Follow-up de slots expirados (${args.stage}) via ${args.channel}`,
    metadata: { slot_expiry_followup: true, stage: args.stage, channel: args.channel },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";

    const body = await req.json();
    const { lead_id, company_id, conversation_id, enrollment_id, expired_slot_datetimes } = body || {};
    if (!lead_id || !company_id) {
      return new Response(JSON.stringify({ error: "lead_id and company_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load existing tracker (if any) and lead
    const { data: tracker } = await supabase
      .from("slot_expiry_followups")
      .select("*")
      .eq("lead_id", lead_id)
      .maybeSingle();

    const { data: lead } = await supabase
      .from("leads")
      .select("name, email, phone")
      .eq("id", lead_id)
      .maybeSingle();

    let stageToRun: Stage = nextStage((tracker?.stage as Stage) || null);

    const previousExcluded: string[] = Array.isArray(tracker?.metadata?.excluded_datetimes)
      ? tracker!.metadata.excluded_datetimes
      : [];
    const allExcluded = Array.from(new Set([...(previousExcluded || []), ...((expired_slot_datetimes as string[]) || [])]));

    const channel = await pickPreferredChannel(supabase, lead_id, company_id);
    const convId = await ensureConversation(supabase, lead_id, company_id, conversation_id || tracker?.conversation_id || null, channel);
    if (!convId) {
      return new Response(JSON.stringify({ error: "No conversation available" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let messageSent = "";
    let nextActionAt: string | null = null;

    if (stageToRun === "suggested_new") {
      // Try to fetch 2 new slots
      const { data: slotsResp, error: slotsErr } = await supabase.functions.invoke("calcom-slots", {
        body: { company_id, lead_id, enrollment_id: enrollment_id || tracker?.enrollment_id, conversation_id: convId, preferred_channel: channel, exclude_datetimes: allExcluded },
      });

      if (slotsErr || !slotsResp?.success || !slotsResp?.slots?.length) {
        console.log("No new slots from Cal.com — skipping to link_sent stage");
        stageToRun = "link_sent";
      } else {
        const newSlotsFormatted: string[] = slotsResp.formatted || (slotsResp.slots || []).map((s: any) => formatBRTLong(s.slot_datetime));
        const newSlotIsos: string[] = (slotsResp.slots || []).map((s: any) => s.slot_datetime);

        // mark new holds as expiry_retry
        const ids = (slotsResp.slots || []).map((s: any) => s.id).filter(Boolean);
        if (ids.length) {
          await supabase
            .from("slot_holds")
            .update({ metadata: { origin: "expiry_retry", retry_count: (tracker?.attempts || 0) + 1 } })
            .in("id", ids);
        }

        const oldList = (expired_slot_datetimes || []).map((d: string) => formatBRTLong(d));
        const oldPart = oldList.length ? `os horários que havíamos reservado (${oldList.join(" e ")}) já foram ocupados` : `os horários que reservamos foram ocupados`;
        messageSent = `Oi${lead?.name ? " " + lead.name.split(" ")[0] : ""}! Infelizmente, ${oldPart}. Consegui liberar dois novos: ${newSlotsFormatted.join(" ou ")}. Algum desses funciona para você?`;

        await sendMessage(supabase, { leadId: lead_id, companyId: company_id, conversationId: convId, channel, message: messageSent, lead, stage: "suggested_new" });

        nextActionAt = new Date(Date.now() + HOURS_TO_NEXT.suggested_new! * 3600 * 1000).toISOString();
        allExcluded.push(...newSlotIsos);
      }
    }

    if (stageToRun === "link_sent") {
      messageSent = CALCOM_BOOKING_LINK
        ? `${lead?.name ? lead.name.split(" ")[0] + ", " : ""}para facilitar, escolha você mesmo o melhor horário aqui: ${CALCOM_BOOKING_LINK}`
        : `Sem problemas! Quando puder, me passe um horário que funcione melhor para você.`;
      await sendMessage(supabase, { leadId: lead_id, companyId: company_id, conversationId: convId, channel, message: messageSent, lead, stage: "link_sent" });
      nextActionAt = new Date(Date.now() + HOURS_TO_NEXT.link_sent! * 3600 * 1000).toISOString();
    } else if (stageToRun === "closing_attempt") {
      messageSent = `${lead?.name ? lead.name.split(" ")[0] + ", " : ""}só quero confirmar: ainda faz sentido conversarmos sobre isso? Se preferir, posso retomar mais para frente — é só me avisar.`;
      await sendMessage(supabase, { leadId: lead_id, companyId: company_id, conversationId: convId, channel, message: messageSent, lead, stage: "closing_attempt" });
      nextActionAt = new Date(Date.now() + HOURS_TO_NEXT.closing_attempt! * 3600 * 1000).toISOString();
    } else if (stageToRun === "no_response") {
      // Close enrollment(s)
      await supabase
        .from("cadence_enrollments")
        .update({ status: "completed" as any, paused_reason: "no_response", completed_at: new Date().toISOString() })
        .eq("lead_id", lead_id)
        .neq("status", "completed");

      await supabase.from("lead_activities").insert({
        company_id, lead_id, type: "system" as any,
        description: "🥶 Lead marcado como sem resposta após múltiplas tentativas",
        metadata: { slot_expiry_followup: true, stage: "no_response" },
      });
    }

    // Upsert tracker
    const trackerRow = {
      company_id,
      lead_id,
      conversation_id: convId,
      enrollment_id: enrollment_id || tracker?.enrollment_id || null,
      stage: stageToRun,
      attempts: (tracker?.attempts || 0) + 1,
      next_action_at: nextActionAt,
      last_action_at: new Date().toISOString(),
      metadata: { excluded_datetimes: allExcluded },
    };
    if (tracker) {
      await supabase.from("slot_expiry_followups").update(trackerRow).eq("id", tracker.id);
    } else {
      await supabase.from("slot_expiry_followups").insert(trackerRow);
    }

    return new Response(JSON.stringify({ ok: true, stage: stageToRun, next_action_at: nextActionAt, message_sent: messageSent || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("slot-expiry-followup error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
