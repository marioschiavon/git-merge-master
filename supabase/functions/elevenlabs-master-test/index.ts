import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser, requireRole, jsonResponse, errorResponse } from "../_shared/tenant-auth.ts";
import { elevenLabsFetch, ElevenLabsNotConfiguredError } from "../_shared/elevenlabs-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { user } = await requireUser(req);
    await requireRole(user.id, "master_admin");

    let r: Response;
    try {
      // Testa a permissão real usada em produção. Não usa /v1/models nem
      // /v1/user porque chaves restritas a STT podem não ter esses escopos.
      const probe = new FormData();
      probe.append("model_id", "scribe_v2");
      r = await elevenLabsFetch("/v1/speech-to-text", { method: "POST", body: probe });
    } catch (e) {
      if (e instanceof ElevenLabsNotConfiguredError) {
        return jsonResponse(
          { ok: false, configured: false, message: "Chave master do ElevenLabs não configurada" },
          200,
          corsHeaders,
        );
      }
      throw e;
    }

    const text = await r.text();
    if (r.status === 401 || r.status === 403) {
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        if (j?.detail?.message) msg = String(j.detail.message);
        else if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch { /* ignore */ }
      return jsonResponse(
        { ok: false, configured: true, status: r.status, message: msg },
        200,
        corsHeaders,
      );
    }

    return jsonResponse(
      {
        ok: true,
        configured: true,
        status: r.status,
        message: "Conectado. Permissão de transcrição validada.",
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
