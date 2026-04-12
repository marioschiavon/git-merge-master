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
    const supabase = createClient(supabaseUrl, serviceKey);
    const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");
    const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    // Find expired holds
    const { data: expiredHolds, error } = await supabase
      .from("slot_holds")
      .select("*")
      .eq("status", "held")
      .lt("expires_at", new Date().toISOString());

    if (error) throw error;
    if (!expiredHolds || expiredHolds.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by lead_id to process per lead
    const holdsByLead: Record<string, any[]> = {};
    for (const hold of expiredHolds) {
      if (!holdsByLead[hold.lead_id]) holdsByLead[hold.lead_id] = [];
      holdsByLead[hold.lead_id].push(hold);
    }

    let processed = 0;

    for (const [leadId, holds] of Object.entries(holdsByLead)) {
      try {
        // Cancel Cal.com slot reservations via v2 API
        for (const hold of holds) {
          if (hold.cal_booking_uid && CALCOM_API_KEY) {
            try {
              await fetch(
                `https://api.cal.com/v2/slots/reservations/${hold.cal_booking_uid}`,
                {
                  method: "DELETE",
                  headers: {
                    "Authorization": `Bearer ${CALCOM_API_KEY}`,
                    "cal-api-version": "2024-09-04",
                  },
                }
              );
            } catch (e) {
              console.error(`Failed to cancel Cal.com reservation ${hold.cal_booking_uid}:`, e);
            }
          }
        }

        // Mark all as expired
        const holdIds = holds.map(h => h.id);
        await supabase
          .from("slot_holds")
          .update({ status: "expired" })
          .in("id", holdIds);

        const companyId = holds[0].company_id;
        const conversationId = holds[0].conversation_id;

        // Determine most used channel (excluding phone/call)
        const { data: channelCounts } = await supabase
          .from("lead_activities")
          .select("type")
          .eq("lead_id", leadId)
          .eq("company_id", companyId)
          .in("type", ["email", "whatsapp", "linkedin"]);

        let preferredChannel = "email";
        if (channelCounts && channelCounts.length > 0) {
          const counts: Record<string, number> = {};
          for (const a of channelCounts) {
            counts[a.type] = (counts[a.type] || 0) + 1;
          }
          preferredChannel = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        }

        // Format expired slot times
        const slotTimes = holds.map(h => {
          const dt = new Date(h.slot_datetime);
          return dt.toLocaleDateString("pt-BR", {
            weekday: "long", day: "numeric", month: "long",
          }) + " às " + dt.toLocaleTimeString("pt-BR", {
            hour: "2-digit", minute: "2-digit",
          });
        });

        const followUpMessage = `Infelizmente, devido à alta demanda, os horários que havíamos reservado (${slotTimes.join(" e ")}) já foram ocupados. Acesse ${CALCOM_BOOKING_LINK} para escolher o melhor horário para você.`;

        // Get lead data
        const { data: lead } = await supabase
          .from("leads")
          .select("name, email, phone")
          .eq("id", leadId)
          .maybeSingle();

        // Save follow-up message
        let targetConvId = conversationId;
        if (!targetConvId) {
          const { data: conv } = await supabase
            .from("conversations")
            .select("id")
            .eq("lead_id", leadId)
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          targetConvId = conv?.id;
        }

        if (!targetConvId) {
          const { data: newConv } = await supabase
            .from("conversations")
            .insert({ lead_id: leadId, company_id: companyId, channel: preferredChannel as any })
            .select()
            .single();
          targetConvId = newConv?.id;
        }

        if (targetConvId) {
          await supabase.from("messages").insert({
            conversation_id: targetConvId,
            content: followUpMessage,
            direction: "outbound",
            ai_suggested: false,
            metadata: { slot_expiry_followup: true, channel: preferredChannel },
          });
        }

        // Send via preferred channel
        if (preferredChannel === "email" && lead?.email) {
          await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "cadence-outreach",
              recipientEmail: lead.email,
              idempotencyKey: `slot-expire-${leadId}-${Date.now()}`,
              templateData: {
                leadName: lead.name,
                subject: "Horários atualizados para nossa reunião",
                messageBody: followUpMessage,
              },
            },
          });
        } else if (preferredChannel === "whatsapp" && lead?.phone) {
          const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
          const TWILIO_PHONE = Deno.env.get("TWILIO_WHATSAPP_NUMBER");
          if (LOVABLE_API_KEY && TWILIO_API_KEY && TWILIO_PHONE) {
            try {
              await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "X-Connection-Api-Key": TWILIO_API_KEY,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  To: `whatsapp:${lead.phone}`,
                  From: `whatsapp:${TWILIO_PHONE}`,
                  Body: followUpMessage,
                }),
              });
            } catch (e) {
              console.error("Twilio WhatsApp send error:", e);
            }
          }
        }

        // Log activity
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadId,
          type: preferredChannel === "whatsapp" ? "whatsapp" : preferredChannel === "linkedin" ? "linkedin" : "email",
          description: `⏰ Slots expirados — follow-up enviado via ${preferredChannel} com link de agendamento`,
          metadata: { slot_expiry: true, expired_slots: slotTimes, channel: preferredChannel },
        });

        processed++;
      } catch (err) {
        console.error(`Error processing expired holds for lead ${leadId}:`, err);
      }
    }

    return new Response(JSON.stringify({ processed, total_leads: Object.keys(holdsByLead).length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("expire-slot-holds error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
