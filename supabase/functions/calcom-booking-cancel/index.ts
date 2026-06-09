import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calcomFetch, corsHeaders, jsonResponse } from "../_shared/calcom.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { booking_uid, reason } = body;
    if (!booking_uid) return jsonResponse({ error: "booking_uid required" }, 400);

    await calcomFetch(`/v2/bookings/${booking_uid}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancellationReason: reason || "Cliente cancelou" }),
    });

    const { data: existing } = await supabase
      .from("bookings")
      .select("id, company_id, lead_id")
      .eq("calcom_booking_uid", booking_uid)
      .maybeSingle();

    if (existing) {
      await supabase.from("bookings").update({ status: "cancelled", cancel_reason: reason || null }).eq("id", existing.id);
      if (existing.company_id) {
        await supabase.from("lead_activities").insert({
          company_id: existing.company_id,
          lead_id: existing.lead_id,
          type: "meeting",
          description: `❌ Reunião cancelada${reason ? `: ${reason}` : ""}`,
          metadata: { booking_uid, reason },
        });
      }
    }

    return jsonResponse({ success: true });
  } catch (e) {
    console.error("calcom-booking-cancel error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
