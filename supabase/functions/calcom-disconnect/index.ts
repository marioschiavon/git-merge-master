import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, jsonResponse } from "../_shared/calcom.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const { data: member } = await userClient
      .from("company_members").select("company_id, role")
      .eq("user_id", userData.user.id).maybeSingle();
    if (!member?.company_id) return jsonResponse({ error: "Sem empresa" }, 400);
    if (member.role !== "company_admin") return jsonResponse({ error: "Apenas admins" }, 403);

    const service_client = createClient(url, service);
    const { error } = await service_client.rpc("clear_calcom_api_key", { _company_id: member.company_id });
    if (error) throw error;
    await service_client.from("calcom_event_types")
      .update({ active: false }).eq("company_id", member.company_id);

    return jsonResponse({ success: true });
  } catch (e) {
    console.error("calcom-disconnect error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
