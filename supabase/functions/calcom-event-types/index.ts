import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse, CALCOM_EVENT_TYPES_API_VERSION, getCompanyCalcomCreds } from "../_shared/calcom.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const company_id: string | undefined = body.company_id;
    if (!company_id) return jsonResponse({ error: "company_id required" }, 400);

    const { apiKey } = await getCompanyCalcomCreds(supabase, company_id);
    const res = await fetch("https://api.cal.com/v2/event-types", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Cal.com /v2/event-types ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = await res.json();
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
