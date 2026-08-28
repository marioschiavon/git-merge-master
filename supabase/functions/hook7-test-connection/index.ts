// Master-admin only. Cria uma conexão descartável no provedor e a apaga
// para validar a chave global + base URL.

import {
  errorResponse,
  jsonResponse,
  requireRole,
  requireUser,
} from "../_shared/tenant-auth.ts";
import {
  getHook7GlobalApiKey,
  INSTANCE_PREFIX,
  shortId,
  uuidv4,
} from "../_shared/hook7.ts";
import { createInstance, deleteInstance } from "../_shared/whatsapp-engine.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const { user } = await requireUser(req);
    await requireRole(user.id, "master_admin");

    try {
      getHook7GlobalApiKey();
    } catch {
      return jsonResponse(
        { ok: false, message: "Chave global do serviço de WhatsApp não configurada." },
        200,
        CORS,
      );
    }

    const name = `${INSTANCE_PREFIX}-healthcheck-${Date.now()}-${shortId(4)}`;
    try {
      const created = await createInstance({
        instanceName: name,
        token: uuidv4(),
        webhookUrl: "",
      });
      try {
        await deleteInstance({ instanceName: created.external_name });
      } catch { /* non-fatal */ }
      return jsonResponse({ ok: true, message: "Conexão OK." }, 200, CORS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse({ ok: false, message: `Falha: ${msg}` }, 200, CORS);
    }
  } catch (e) {
    return errorResponse(e, CORS);
  }
});
