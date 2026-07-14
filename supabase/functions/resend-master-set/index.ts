import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireUser, requireRole, jsonResponse, errorResponse } from "../_shared/tenant-auth.ts";
import { resendFetchWithKey, invalidateResendKeyCache } from "../_shared/resend-gateway.ts";

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
    if (apiKey.length < 8) {
      return jsonResponse({ ok: false, message: "Chave inválida" }, 400, corsHeaders);
    }

    // Valida a chave chamando GET /domains no Resend antes de salvar.
    const test = await resendFetchWithKey(apiKey, "/domains");
    const text = await test.text();
    if (!test.ok) {
      return jsonResponse(
        { ok: false, status: test.status, message: `Chave rejeitada pelo Resend: ${text.slice(0, 300)}` },
        200,
        corsHeaders,
      );
    }
    let domainCount = 0;
    try {
      const j = text ? JSON.parse(text) : {};
      const list = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
      domainCount = list.length;
    } catch { /* ignore */ }

    const passphrase = Deno.env.get("RESEND_KEY_PASSPHRASE");
    if (!passphrase) {
      return jsonResponse({ ok: false, message: "RESEND_KEY_PASSPHRASE não configurado" }, 500, corsHeaders);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);
    const { error } = await admin.rpc("set_resend_master_key", {
      _api_key: apiKey,
      _passphrase: passphrase,
    });
    if (error) throw new Error(error.message);

    invalidateResendKeyCache();

    return jsonResponse(
      { ok: true, domain_count: domainCount, message: `Chave salva. ${domainCount} domínio(s) na conta.` },
      200,
      corsHeaders,
    );
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
