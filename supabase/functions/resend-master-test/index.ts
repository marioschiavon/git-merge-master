import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser, requireRole, jsonResponse, errorResponse } from "../_shared/tenant-auth.ts";
import { resendFetch, ResendNotConfiguredError } from "../_shared/resend-gateway.ts";

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
      r = await resendFetch("/domains");
    } catch (e) {
      if (e instanceof ResendNotConfiguredError) {
        return jsonResponse(
          { ok: false, configured: false, message: "RESEND_API_KEY não configurado no connector" },
          200,
          corsHeaders,
        );
      }
      throw e;
    }

    const text = await r.text();
    if (!r.ok) {
      return jsonResponse(
        { ok: false, configured: true, status: r.status, message: text.slice(0, 500) },
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

    return jsonResponse(
      { ok: true, configured: true, status: r.status, domain_count: domainCount, message: `Conectado. ${domainCount} domínio(s) na conta Resend.` },
      200,
      corsHeaders,
    );
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
