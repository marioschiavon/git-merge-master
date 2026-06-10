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
    const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");

    // Find expired holds that have NOT been part of a retry yet
    // (retry holds are tracked via slot_expiry_followups, not re-processed here)
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

    const holdsByLead: Record<string, any[]> = {};
    for (const hold of expiredHolds) {
      (holdsByLead[hold.lead_id] ||= []).push(hold);
    }

    let processed = 0;

    for (const [leadId, holds] of Object.entries(holdsByLead)) {
      try {
        // Cancel Cal.com slot reservations
        for (const hold of holds) {
          if (hold.cal_booking_uid && CALCOM_API_KEY) {
            try {
              await fetch(`https://api.cal.com/v2/slots/reservations/${hold.cal_booking_uid}`, {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${CALCOM_API_KEY}`,
                  "cal-api-version": "2024-09-04",
                },
              });
            } catch (e) {
              console.error(`Failed to cancel reservation ${hold.cal_booking_uid}:`, e);
            }
          }
        }

        const holdIds = holds.map((h: any) => h.id);
        await supabase.from("slot_holds").update({ status: "expired" }).in("id", holdIds);

        const companyId = holds[0].company_id;
        const conversationId = holds[0].conversation_id;
        const enrollmentId = holds[0].enrollment_id;
        const expiredDatetimes = holds.map((h: any) => h.slot_datetime);

        // If these holds came from a retry (expiry_retry), the cron handles next stage —
        // skip immediate dispatch to avoid double-processing.
        const isRetryHold = holds.some((h: any) => h?.metadata?.origin === "expiry_retry");
        if (isRetryHold) {
          // Cron will pick up the tracker via next_action_at
          processed++;
          continue;
        }

        // Delegate to follow-up function (stage = suggested_new on first run)
        await supabase.functions.invoke("slot-expiry-followup", {
          body: {
            lead_id: leadId,
            company_id: companyId,
            conversation_id: conversationId,
            enrollment_id: enrollmentId,
            expired_slot_datetimes: expiredDatetimes,
          },
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
