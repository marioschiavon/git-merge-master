import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUser, requireRole, jsonResponse, errorResponse } from "../_shared/tenant-auth.ts";
import { invalidateFallbackKeyCache } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { user } = await requireUser(req);
    await requireRole(user.id, "master_admin");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await admin.rpc("clear_openai_master_key");
    if (error) throw new Error(error.message);
    invalidateFallbackKeyCache();
    return jsonResponse({ ok: true, message: "Chave OpenAI removida" }, 200, corsHeaders);
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
