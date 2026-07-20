// Connects a company's Cal.com account: validates the API key, persists it
// encrypted, syncs event types, generates a per-company webhook secret and
// returns the webhook URL + secret for the user to paste into Cal.com.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse, CALCOM_EVENT_TYPES_API_VERSION, normalizeCalcomApiKey } from "../_shared/calcom.ts";
import { logAudit } from "../_shared/audit-log.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const passphrase = Deno.env.get("CALCOM_KEY_PASSPHRASE");
    if (!passphrase) return jsonResponse({ error: "CALCOM_KEY_PASSPHRASE not configured" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const apiKey = normalizeCalcomApiKey(body.api_key);
    const bookingLink = String(body.booking_link || "").trim();
    if (!apiKey) return jsonResponse({ error: "api_key obrigatório" }, 400);

    // Resolve caller's company
    const { data: member } = await userClient
      .from("company_members")
      .select("company_id, role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!member?.company_id) return jsonResponse({ error: "Usuário sem empresa" }, 400);
    if (member.role !== "company_admin") {
      // master_admin path uses a separate flow; keep it simple: require company_admin here.
      return jsonResponse({ error: "Apenas admins da empresa podem conectar" }, 403);
    }

    // Validate with the v2 API key flow. /v2/me is OAuth-only; event-types accepts API keys.
    const meRes = await fetch("https://api.cal.com/v2/event-types", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
      },
    });
    if (!meRes.ok) {
      const t = await meRes.text();
      const message = meRes.status === 401
        ? "Cal.com rejeitou a API key: token inválido. Gere/copie uma API key em Cal.com → Settings → Security → API Keys e cole apenas a chave (cal_live_... ou cal_...), sem o prefixo Bearer."
        : `Cal.com rejeitou a API key (${meRes.status}): ${t.slice(0, 200)}`;
      return jsonResponse({ error: message }, 400);
    }
    const meJson = await meRes.json();
    const firstEt = (meJson?.data?.eventTypes || meJson?.data || [])[0];
    const calUser = firstEt?.owner || firstEt?.user || firstEt?.users?.[0] || {};

    // Persist encrypted (SECURITY DEFINER function enforces role check).
    const service_client = createClient(url, service);
    const { error: setErr } = await service_client.rpc("set_calcom_api_key", {
      _company_id: member.company_id,
      _api_key: apiKey,
      _booking_link: bookingLink || "",
      _passphrase: passphrase,
    });
    if (setErr) throw setErr;

    // Fetch webhook secret + slug
    const { data: company } = await service_client
      .from("companies")
      .select("slug, calcom_webhook_secret")
      .eq("id", member.company_id)
      .maybeSingle();

    // Sync event types immediately
    let syncedCount = 0;
    try {
      const etRes = await fetch("https://api.cal.com/v2/event-types", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
        },
      });
      if (etRes.ok) {
        const etJson = await etRes.json();
        const list: any[] = etJson.data?.eventTypes || etJson.data || [];
        const rows = list.map((et) => ({
          company_id: member.company_id,
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
          await service_client.from("calcom_event_types")
            .upsert(rows, { onConflict: "company_id,calcom_id" });
          syncedCount = rows.length;
        }
      }
    } catch (e) { console.error("event-types sync failed:", e); }

    const projectRef = url.replace(/^https?:\/\//, "").split(".")[0];
    const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/calcom-webhook/${company?.slug ?? ""}`;

    logAudit({
      companyId: member.company_id,
      userId: userData.user.id,
      userEmail: userData.user.email,
      eventType: "integration.calcom.connected",
      severity: "info",
      message: `Cal.com conectado (${syncedCount} event types)`,
      metadata: { event_types_synced: syncedCount, cal_user_email: calUser?.email },
    });

    return jsonResponse({
      success: true,
      cal_user: { email: calUser?.email, username: calUser?.username, id: calUser?.id },
      webhook_url: webhookUrl,
      webhook_secret: company?.calcom_webhook_secret,
      event_types_synced: syncedCount,
    });
  } catch (e) {
    console.error("calcom-connect error:", e);
    logAudit({
      eventType: "edge.error.calcom-connect",
      severity: "error",
      message: e instanceof Error ? e.message : String(e),
    });
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
