import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { resendFetch, ResendNotConfiguredError } from "../_shared/resend-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await userClient.auth.getUser();
    const userId = userRes?.user?.id;
    if (!userId) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: companyId } = await admin.rpc("get_user_company_id", { _user_id: userId });
    if (!companyId) return json({ error: "sem company" }, 400);

    const { data: row } = await admin
      .from("company_email_domains")
      .select("*")
      .eq("company_id", companyId as string)
      .maybeSingle();
    if (!row) return json({ ok: true });

    if (row.resend_domain_id) {
      try {
        await resendFetch(`/domains/${row.resend_domain_id}`, { method: "DELETE" });
      } catch (e) {
        if (!(e instanceof ResendNotConfiguredError)) {
          console.warn("delete Resend falhou:", (e as Error).message);
        }
      }
    }

    await admin.from("company_email_domains").delete().eq("id", row.id);
    return json({ ok: true });
  } catch (err) {
    console.error("resend-domain-delete:", err);
    return json({ error: (err as Error).message }, 500);
  }
});

function json(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
