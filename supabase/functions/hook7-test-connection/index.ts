// Master-admin only. Cria uma instância descartável no Hook7 e a apaga
// para validar HOOK7_GLOBAL_APIKEY + base URL.

import {
  errorResponse,
  jsonResponse,
  requireRole,
  requireUser,
} from "../_shared/tenant-auth.ts";
import {
  getHook7GlobalApiKey,
  hook7Fetch,
  INSTANCE_PREFIX,
  shortId,
  uuidv4,
} from "../_shared/hook7.ts";

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

    let apikey: string;
    try {
      apikey = getHook7GlobalApiKey();
    } catch {
      return jsonResponse(
        { ok: false, message: "Chave global do Hook7 não configurada." },
        200,
        CORS,
      );
    }

    const name = `${INSTANCE_PREFIX}-healthcheck-${Date.now()}-${shortId(4)}`;
    const token = uuidv4();
    try {
      // deno-lint-ignore no-explicit-any
      const created: any = await hook7Fetch("/instance/create", {
        method: "POST",
        apikey,
        body: { name, token },
        timeoutMs: 12000,
      });
      const createdName = created?.data?.name ?? name;
      try {
        await hook7Fetch(`/instance/${encodeURIComponent(createdName)}`, {
          method: "DELETE",
          apikey,
          timeoutMs: 8000,
        });
      } catch { /* non-fatal */ }
      return jsonResponse({ ok: true, message: "Conexão OK." }, 200, CORS);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return jsonResponse(
        { ok: false, message: `Falha: ${msg}` },
        200,
        CORS,
      );
    }
  } catch (e) {
    return errorResponse(e, CORS);
  }
});
