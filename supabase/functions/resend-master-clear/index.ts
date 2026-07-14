import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUser, requireRole, jsonResponse, errorResponse } from "../_shared/tenant-auth.ts";
import { invalidateResendKeyCache } from "../_shared/resend-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { user } = await requireUser(req);
    await requireRole(user.id, "master_admin");

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const { error } = await admin.rpc("clear_resend_master_key");
    if (error) throw new Error(error.message);

    invalidateResendKeyCache();

    return jsonResponse({ ok: true, message: "Chave removida" }, 200, corsHeaders);
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
