import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calcomFetch, corsHeaders, jsonResponse, upsertBookingFromCalcom } from "../_shared/calcom.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { booking_uid, lead_id, email } = body;

    if (booking_uid) {
      const result = await calcomFetch(`/v2/bookings/${booking_uid}`);
      const data = result.data || result;
      const persisted = await upsertBookingFromCalcom(supabase, data);
      return jsonResponse({ success: true, booking: data, persisted });
    }

    // Search by lead/email — return latest upcoming booking from local table
    let q = supabase.from("bookings").select("*").in("status", ["pending", "confirmed", "rescheduled"]).order("scheduled_at", { ascending: true }).limit(5);
    if (lead_id) q = q.eq("lead_id", lead_id);
    const { data: local } = await q;

    // If nothing locally and we have email, query Cal.com
    if ((!local || !local.length) && email) {
      const result = await calcomFetch(`/v2/bookings?attendeeEmail=${encodeURIComponent(email)}&status=upcoming`);
      const list = result.data || [];
      return jsonResponse({ success: true, bookings: list, source: "calcom" });
    }

    return jsonResponse({ success: true, bookings: local || [], source: "local" });
  } catch (e) {
    console.error("calcom-booking-fetch error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
