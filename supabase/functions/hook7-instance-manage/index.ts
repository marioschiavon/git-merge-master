// Consolidated Hook7 instance manager (per-company).
//
// Actions (JSON body: { action, ... }):
//   - list                                    → lista instâncias da company do caller
//   - create   { display_name }               → cria no Hook7 + registra no DB (com token dedicado)
//   - connect  { instance_id }                → dispara /instance/connect (sub webhook)
//   - qr       { instance_id }                → busca QR base64
//   - status   { instance_id }                → poll de status (Connected/LoggedIn)
//   - disconnect { instance_id }              → logout (fallback: disconnect)
//   - reconnect  { instance_id }              → /instance/reconnect (fallback: connect)
//   - rename   { instance_id, display_name }
//   - delete   { instance_id, reason? }       → archive local + delete remoto
//
// Autorização: caller precisa ser company_admin da company da instância
// (ou master_admin). Cada company só vê/gerencia as suas.

import {
  errorResponse,
  HttpError,
  jsonResponse,
  requireUser,
} from "../_shared/tenant-auth.ts";
import {
  buildExternalName,
  buildWebhookUrl,
  getHook7GlobalApiKey,
  HOOK7_SUBSCRIBE_EVENTS,
  hook7Fetch,
  loadInstanceToken,
  serviceClient,
  storeInstanceToken,
  uuidv4,
} from "../_shared/hook7.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// deno-lint-ignore no-explicit-any
async function getCallerCompany(userId: string): Promise<{ id: string; slug: string; name: string; isMaster: boolean; isCompanyAdmin: boolean; }> {
  const admin = serviceClient();
  const { data: rolesRow } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (rolesRow ?? []).map((r) => r.role);
  const isMaster = roles.includes("master_admin");
  const isCompanyAdmin = roles.includes("company_admin");

  const { data: mem } = await admin
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!mem && !isMaster) throw new HttpError(403, "Sem empresa ativa.");

  let companyId: string | null = mem?.company_id ?? null;
  if (!companyId && isMaster) {
    // master sem membership — retorna vazio; ações direcionadas por instance_id resolverão a company
    return { id: "", slug: "", name: "", isMaster, isCompanyAdmin };
  }

  const { data: company } = await admin
    .from("companies")
    .select("id, slug, name")
    .eq("id", companyId!)
    .maybeSingle();
  if (!company) throw new HttpError(404, "Empresa não encontrada.");
  return { id: company.id, slug: company.slug, name: company.name, isMaster, isCompanyAdmin };
}

async function loadInstance(instanceId: string) {
  const admin = serviceClient();
  const { data, error } = await admin
    .from("hook7_instances")
    .select(
      "id, company_id, external_id, external_name, display_name, status, archived_at",
    )
    .eq("id", instanceId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Instância não encontrada.");
  if (data.archived_at) throw new HttpError(410, "Instância arquivada.");
  return data;
}

async function assertCanManage(userId: string, companyId: string): Promise<void> {
  const admin = serviceClient();
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const list = (roles ?? []).map((r) => r.role);
  if (list.includes("master_admin")) return;
  if (!list.includes("company_admin")) {
    throw new HttpError(403, "Apenas company_admin pode gerenciar instâncias.");
  }
  const { data: mem } = await admin
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!mem) throw new HttpError(403, "Sem acesso a esta empresa.");
}

async function loadCompanySlug(companyId: string): Promise<string> {
  const admin = serviceClient();
  const { data } = await admin
    .from("companies")
    .select("slug")
    .eq("id", companyId)
    .maybeSingle();
  return data?.slug ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const { user } = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const admin = serviceClient();

    // ---------------- LIST ----------------
    if (action === "list") {
      const caller = await getCallerCompany(user.id);
      const companyId = caller.id;
      if (!companyId) return jsonResponse({ instances: [] }, 200, CORS);
      const { data, error } = await admin
        .from("hook7_instances")
        .select(
          "id, display_name, external_name, status, phone_number, connected_profile_name, owner_user_id, last_connected_at, last_qr_at, created_at",
        )
        .eq("company_id", companyId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new HttpError(500, error.message);
      return jsonResponse({ instances: data ?? [] }, 200, CORS);
    }

    // ---------------- CREATE ----------------
    if (action === "create") {
      const displayName = String(body?.display_name ?? "").trim();
      if (!displayName || displayName.length > 60) {
        throw new HttpError(400, "display_name obrigatório (1-60).");
      }
      const caller = await getCallerCompany(user.id);
      if (!caller.id) throw new HttpError(400, "Empresa alvo não determinada.");
      await assertCanManage(user.id, caller.id);

      const externalName = buildExternalName(caller.slug, displayName);
      const suggestedToken = uuidv4();
      const apikey = getHook7GlobalApiKey();

      // deno-lint-ignore no-explicit-any
      const created: any = await hook7Fetch("/instance/create", {
        method: "POST",
        apikey,
        body: { name: externalName, token: suggestedToken },
      });
      const extId = created?.data?.id;
      const extName = created?.data?.name ?? externalName;
      const token = created?.data?.token ?? suggestedToken;
      if (!extId || !token) {
        throw new HttpError(502, "Resposta inesperada do Hook7.");
      }

      const { data: ins, error: insErr } = await admin
        .from("hook7_instances")
        .insert({
          company_id: caller.id,
          owner_user_id: user.id,
          display_name: displayName,
          external_id: extId,
          external_name: extName,
          status: "pending_qr",
          created_by: user.id,
        })
        .select("id, display_name, external_name, status")
        .single();

      if (insErr) {
        try {
          await hook7Fetch(`/instance/${encodeURIComponent(extName)}`, {
            method: "DELETE",
            apikey,
            timeoutMs: 8000,
          });
        } catch { /* best-effort */ }
        throw new HttpError(500, insErr.message);
      }

      try {
        await storeInstanceToken(admin, ins.id, token);
      } catch (e) {
        await admin.from("hook7_instances").delete().eq("id", ins.id);
        try {
          await hook7Fetch(`/instance/${encodeURIComponent(extName)}`, {
            method: "DELETE",
            apikey,
            timeoutMs: 8000,
          });
        } catch { /* best-effort */ }
        throw e;
      }

      return jsonResponse({ instance: ins }, 200, CORS);
    }

    // Ações abaixo requerem instance_id
    const instanceId = String(body?.instance_id ?? "");
    if (!instanceId) throw new HttpError(400, "instance_id obrigatório.");
    const inst = await loadInstance(instanceId);
    await assertCanManage(user.id, inst.company_id);

    // ---------------- CONNECT ----------------
    if (action === "connect") {
      const token = await loadInstanceToken(admin, inst.id);
      const slug = await loadCompanySlug(inst.company_id);
      const webhookUrl = buildWebhookUrl(slug);
      await hook7Fetch("/instance/connect", {
        method: "POST",
        apikey: token,
        body: { immediate: true, webhookUrl, subscribe: HOOK7_SUBSCRIBE_EVENTS },
      });
      await admin
        .from("hook7_instances")
        .update({
          status: "qr_ready",
          last_qr_at: new Date().toISOString(),
          user_disconnected_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inst.id);
      return jsonResponse({ ok: true }, 200, CORS);
    }

    // ---------------- QR ----------------
    if (action === "qr") {
      const token = await loadInstanceToken(admin, inst.id);
      // deno-lint-ignore no-explicit-any
      const r: any = await hook7Fetch("/instance/qr", {
        method: "GET",
        apikey: token,
      });
      const raw = r?.data?.Qrcode ?? r?.data?.qrcode ?? r?.qrcode ?? null;
      const qrcode_base64: string | null =
        typeof raw === "string" && raw.length > 0 ? raw : null;
      return jsonResponse({ qrcode_base64 }, 200, CORS);
    }

    // ---------------- STATUS ----------------
    if (action === "status") {
      const token = await loadInstanceToken(admin, inst.id);
      // deno-lint-ignore no-explicit-any
      let r: any;
      try {
        r = await hook7Fetch("/instance/status", {
          method: "GET",
          apikey: token,
        });
      } catch {
        await admin
          .from("hook7_instances")
          .update({ status: "error", updated_at: new Date().toISOString() })
          .eq("id", inst.id);
        return jsonResponse(
          { status: "error", connected_profile_name: null },
          200,
          CORS,
        );
      }
      const d = r?.data ?? {};
      const Connected: boolean = d.Connected === true;
      const LoggedIn: boolean = d.LoggedIn === true;
      const Name: string | null =
        typeof d.Name === "string" && d.Name.length > 0 ? d.Name : null;

      let nextStatus: string;
      if (Connected && LoggedIn) nextStatus = "connected";
      else nextStatus = inst.status === "connected" ? "connected" : "qr_ready";

      // deno-lint-ignore no-explicit-any
      const patch: Record<string, any> = {
        status: nextStatus,
        updated_at: new Date().toISOString(),
      };
      if (nextStatus === "connected") {
        patch.last_connected_at = new Date().toISOString();
        if (Name) patch.connected_profile_name = Name;
      }
      await admin.from("hook7_instances").update(patch).eq("id", inst.id);
      return jsonResponse(
        { status: nextStatus, connected_profile_name: Name },
        200,
        CORS,
      );
    }

    // ---------------- DISCONNECT ----------------
    if (action === "disconnect") {
      const token = await loadInstanceToken(admin, inst.id);
      let loggedOut = false;
      try {
        await hook7Fetch("/instance/logout", {
          method: "POST",
          apikey: token,
          body: {},
        });
        loggedOut = true;
      } catch {
        try {
          await hook7Fetch("/instance/disconnect", {
            method: "POST",
            apikey: token,
            body: {},
          });
        } catch { /* swallow */ }
      }
      const nowIso = new Date().toISOString();
      await admin
        .from("hook7_instances")
        .update({
          status: "disconnected",
          user_disconnected_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", inst.id);
      return jsonResponse({ ok: true, logged_out: loggedOut }, 200, CORS);
    }

    // ---------------- RECONNECT ----------------
    if (action === "reconnect") {
      const token = await loadInstanceToken(admin, inst.id);
      const slug = await loadCompanySlug(inst.company_id);
      const webhookUrl = buildWebhookUrl(slug);
      try {
        await hook7Fetch("/instance/reconnect", {
          method: "POST",
          apikey: token,
          body: {},
        });
      } catch {
        await hook7Fetch("/instance/connect", {
          method: "POST",
          apikey: token,
          body: {
            immediate: true,
            webhookUrl,
            subscribe: HOOK7_SUBSCRIBE_EVENTS,
          },
        });
      }
      await admin
        .from("hook7_instances")
        .update({
          status: "qr_ready",
          last_qr_at: new Date().toISOString(),
          user_disconnected_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inst.id);
      return jsonResponse({ ok: true }, 200, CORS);
    }

    // ---------------- RENAME ----------------
    if (action === "rename") {
      const newName = String(body?.display_name ?? "").trim();
      if (!newName || newName.length > 60) {
        throw new HttpError(400, "display_name obrigatório (1-60).");
      }
      const { error } = await admin
        .from("hook7_instances")
        .update({
          display_name: newName,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inst.id);
      if (error) throw new HttpError(500, error.message);
      return jsonResponse({ ok: true }, 200, CORS);
    }

    // ---------------- DELETE ----------------
    if (action === "delete") {
      const reason = String(body?.reason ?? "user_delete");
      if (
        (reason === "cancel" || reason === "timeout") &&
        inst.status === "connected"
      ) {
        return jsonResponse(
          { ok: true, skipped: "connected" },
          200,
          CORS,
        );
      }
      const apikey = getHook7GlobalApiKey();
      if (inst.external_name) {
        try {
          await hook7Fetch(
            `/instance/${encodeURIComponent(inst.external_name)}`,
            { method: "DELETE", apikey, timeoutMs: 10000 },
          );
        } catch { /* best-effort */ }
      }
      const { error: updErr } = await admin
        .from("hook7_instances")
        .update({
          archived_at: new Date().toISOString(),
          status: "disconnected",
          updated_at: new Date().toISOString(),
        })
        .eq("id", inst.id);
      if (updErr) throw new HttpError(500, updErr.message);
      return jsonResponse({ ok: true }, 200, CORS);
    }

    throw new HttpError(400, `Ação desconhecida: ${action}`);
  } catch (e) {
    return errorResponse(e, CORS);
  }
});
