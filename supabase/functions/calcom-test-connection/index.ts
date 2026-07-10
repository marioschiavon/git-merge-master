// Validates a Cal.com API key without persisting it. Used by the UI before
// the user clicks "Connect".
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, jsonResponse, CALCOM_EVENT_TYPES_API_VERSION } from "../_shared/calcom.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = String(body.api_key || "").trim();
    if (!apiKey) return jsonResponse({ error: "api_key obrigatório" }, 400);

    // Validate via /v2/event-types — personal API keys authenticate with Bearer
    // on v2. /v2/me is OAuth-only (managed users), so we can't use it here.
    const etRes = await fetch("https://api.cal.com/v2/event-types", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
      },
    });
    if (!etRes.ok) {
      const t = await etRes.text();
      return jsonResponse({ ok: false, error: `Cal.com ${etRes.status}: ${t.slice(0, 200)}` }, 200);
    }
    const etJson = await etRes.json();
    const list: any[] = etJson.data?.eventTypes || etJson.data || [];
    const eventTypes = list.map((et: any) => ({
      id: et.id,
      title: et.title || et.slug || `Event ${et.id}`,
      slug: et.slug,
      length: et.length || et.lengthInMinutes,
    }));
    const first = list[0];
    const calUser = first?.owner || first?.user || first?.users?.[0] || {};

    return jsonResponse({
      ok: true,
      cal_user: { email: calUser?.email, username: calUser?.username, id: calUser?.id },
      event_types: eventTypes,
    });
  } catch (e) {
    console.error("calcom-test-connection error:", e);
    return jsonResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
