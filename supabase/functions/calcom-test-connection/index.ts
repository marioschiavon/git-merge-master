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

    // Personal API keys (cal_live_/cal_test_) authenticate via v1 (?apiKey=)
    // — /v2/me only accepts OAuth managed-user tokens.
    const meRes = await fetch(`https://api.cal.com/v1/me?apiKey=${encodeURIComponent(apiKey)}`);
    if (!meRes.ok) {
      const t = await meRes.text();
      return jsonResponse({ ok: false, error: `Cal.com ${meRes.status}: ${t.slice(0, 200)}` }, 200);
    }
    const meJson = await meRes.json();
    const calUser = meJson?.user || meJson?.data || meJson;

    // Also list event types so the UI can offer them as default.
    let eventTypes: Array<{ id: number; title: string; slug?: string; length?: number }> = [];
    try {
      const etRes = await fetch(`https://api.cal.com/v1/event-types?apiKey=${encodeURIComponent(apiKey)}`);
      if (etRes.ok) {
        const etJson = await etRes.json();
        const list: any[] = etJson.event_types || etJson.data?.eventTypes || etJson.data || [];
        eventTypes = list.map((et: any) => ({
          id: et.id,
          title: et.title || et.slug || `Event ${et.id}`,
          slug: et.slug,
          length: et.length || et.lengthInMinutes,
        }));
      }
    } catch { /* ignore */ }

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
