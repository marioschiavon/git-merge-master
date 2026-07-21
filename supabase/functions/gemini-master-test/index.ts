import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser, requireRole, jsonResponse, errorResponse } from "../_shared/tenant-auth.ts";
import { getFallbackKeys } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { user } = await requireUser(req);
    await requireRole(user.id, "master_admin");
    const keys = await getFallbackKeys();
    if (!keys.gemini) {
      return jsonResponse({ ok: false, configured: false, message: "Chave Gemini não configurada" }, 200, corsHeaders);
    }
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/models", {
      headers: { Authorization: `Bearer ${keys.gemini}` },
    });
    if (r.status === 401 || r.status === 403) {
      const text = await r.text();
      return jsonResponse(
        { ok: false, configured: true, status: r.status, message: text.slice(0, 300) },
        200,
        corsHeaders,
      );
    }
    return jsonResponse({ ok: true, configured: true, status: r.status, message: "Chave Gemini OK." }, 200, corsHeaders);
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
