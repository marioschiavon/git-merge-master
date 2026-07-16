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
      r = await elevenLabsFetch("/v1/models");
      if (!r.ok && r.status !== 401 && r.status !== 403) {
        const alt = await elevenLabsFetch("/v1/user");
        if (alt.ok) r = alt;
      } else if (r.ok) {
        // /v1/models funciona mas não traz subscription; tenta /v1/user
        // adicionalmente para exibir o plano (ignora falha).
        try {
          const alt = await elevenLabsFetch("/v1/user");
          if (alt.ok) r = alt;
        } catch { /* ignore */ }
      }
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
    if (!r.ok) {
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
    let tier: string | null = null;
    let characterCount: number | null = null;
    let characterLimit: number | null = null;
    try {
      const j = text ? JSON.parse(text) : {};
      tier = j?.subscription?.tier ?? null;
      characterCount = j?.subscription?.character_count ?? null;
      characterLimit = j?.subscription?.character_limit ?? null;
    } catch { /* ignore */ }

    return jsonResponse(
      {
        ok: true,
        configured: true,
        status: r.status,
        tier,
        character_count: characterCount,
        character_limit: characterLimit,
        message: tier ? `Conectado. Plano: ${tier}.` : "Conectado.",
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
