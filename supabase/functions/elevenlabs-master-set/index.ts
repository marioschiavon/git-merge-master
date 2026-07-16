import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUser, requireRole, jsonResponse, errorResponse } from "../_shared/tenant-auth.ts";
import { elevenLabsFetchWithKey, invalidateElevenLabsKeyCache } from "../_shared/elevenlabs-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { user } = await requireUser(req);
    await requireRole(user.id, "master_admin");

    const body = await req.json().catch(() => ({}));
    const apiKey = (body?.api_key ?? "").toString().trim();
    const model = (body?.model ?? "").toString().trim();

    if (apiKey.length < 8) {
      return jsonResponse({ ok: false, message: "Chave inválida" }, 400, corsHeaders);
    }

    // Valida a chave chamando GET /v1/user no ElevenLabs antes de salvar.
    const test = await elevenLabsFetchWithKey(apiKey, "/v1/user");
    const text = await test.text();
    if (!test.ok) {
      let msg = text.slice(0, 300);
      try {
        const j = JSON.parse(text);
        if (j?.detail?.message) msg = String(j.detail.message);
        else if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch { /* ignore */ }
      return jsonResponse(
        { ok: false, status: test.status, message: `Chave rejeitada pelo ElevenLabs (${test.status}): ${msg}` },
        200,
        corsHeaders,
      );
    }

    const passphrase = Deno.env.get("RESEND_KEY_PASSPHRASE");
    if (!passphrase) {
      return jsonResponse(
        { ok: false, message: "RESEND_KEY_PASSPHRASE não configurado (usado para criptografar chaves master)" },
        500,
        corsHeaders,
      );
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const { error } = await admin.rpc("set_elevenlabs_master_key", {
      _api_key: apiKey,
      _passphrase: passphrase,
    });
    if (error) throw new Error(error.message);

    if (model === "scribe_v2" || model === "scribe_v2_realtime") {
      await admin.rpc("set_elevenlabs_master_model", { _model: model });
    }

    invalidateElevenLabsKeyCache();

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
        tier,
        character_count: characterCount,
        character_limit: characterLimit,
        message: tier ? `Chave salva. Plano: ${tier}.` : "Chave salva.",
      },
      200,
      corsHeaders,
    );
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
