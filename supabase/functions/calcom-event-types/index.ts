import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { calcomFetch, CALCOM_EVENT_TYPES_API_VERSION, corsHeaders, jsonResponse } from "../_shared/calcom.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const company_id: string | undefined = body.company_id;
    if (!company_id) return jsonResponse({ error: "company_id required" }, 400);

    const json = await calcomFetch("/v2/event-types", { version: CALCOM_EVENT_TYPES_API_VERSION });
    const list: any[] = json.data?.eventTypes || json.data || [];

    const rows = list.map((et) => ({
      company_id,
      calcom_id: et.id,
      slug: et.slug || null,
      title: et.title || et.slug || `Event ${et.id}`,
      description: et.description || null,
      length_minutes: et.length || et.lengthInMinutes || null,
      team_id: et.teamId || null,
      raw: et,
      synced_at: new Date().toISOString(),
    }));

    if (rows.length) {
      const { error } = await supabase
        .from("calcom_event_types")
        .upsert(rows, { onConflict: "company_id,calcom_id" });
      if (error) throw error;
    }

    return jsonResponse({ success: true, count: rows.length, event_types: rows });
  } catch (e) {
    console.error("calcom-event-types error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
