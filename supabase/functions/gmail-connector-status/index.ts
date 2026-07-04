import { getConnectorProfile, GmailConnectorNotLinkedError } from "../_shared/gmail-connector.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const profile = await getConnectorProfile(true);
    return new Response(JSON.stringify({
      connected: true,
      email: profile.email,
      history_id: profile.historyId ?? null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    if (err instanceof GmailConnectorNotLinkedError) {
      return new Response(JSON.stringify({ connected: false, email: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      connected: false,
      error: (err as Error).message,
    }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
