// Gerenciador de conexões de WhatsApp por empresa.
//
// Actions (JSON body: { action, ... }):
//   - list                                    → lista conexões da company do caller
//   - create   { display_name }               → cria no provedor + registra no DB (token dedicado)
//   - connect  { instance_id }                → inicia pareamento e devolve QR-Code
//   - qr       { instance_id }                → busca QR-Code atual
//   - status   { instance_id }                → poll de status
//   - disconnect { instance_id }              → logout
//   - reconnect  { instance_id }              → novo pareamento
//   - rename   { instance_id, display_name }
//   - delete   { instance_id, reason? }       → arquiva local + remove remoto
//
// Autorização: caller precisa ser company_admin da company da conexão
// (ou master_admin). Cada company só vê/gerencia as suas.
//
// Conexões criadas no motor antigo (engine='legacy') são reprovisionadas na
// mesma linha ao chamar connect/reconnect/qr — nada precisa ser excluído.


import {
  errorResponse,
  HttpError,
  jsonResponse,
  requireUser,
} from "../_shared/tenant-auth.ts";
import {
  buildExternalName,
  loadInstanceToken,
  serviceClient,
  storeInstanceToken,
  uuidv4,
  withinUserDisconnectWindow,
} from "../_shared/hook7.ts";
import {
  buildWaWebhookUrl,
  connectInstance,
  connectionState,
  createInstance,
  deleteInstance,
  ENGINE_EVOLUTION_API,
  ENGINE_LEGACY,
  logoutInstance,
  setInstanceWebhook,
} from "../_shared/whatsapp-engine.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LEGACY_MSG =
  "Esta conexão precisa ser reconectada: clique em Reconectar e leia o QR-Code novamente.";


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

  const companyId: string | null = mem?.company_id ?? null;
  if (!companyId && isMaster) {
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
      "id, company_id, external_id, external_name, display_name, status, engine, archived_at, user_disconnected_at",
    )
    .eq("id", instanceId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(404, "Conexão não encontrada.");
  if (data.archived_at) throw new HttpError(410, "Conexão arquivada.");
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

  // Membership is the source of truth for company scoping; the membership role
  // also counts as admin (user_roles pode estar dessincronizado).
  const { data: mem } = await admin
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!mem) throw new HttpError(403, "Sem acesso a esta empresa.");

  if (mem.role !== "company_admin" && !list.includes("company_admin")) {
    throw new HttpError(403, "Apenas administradores da empresa podem gerenciar conexões.");
  }
}

async function assertCanAccess(userId: string, companyId: string): Promise<void> {
  const admin = serviceClient();
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if ((roles ?? []).some((row) => row.role === "master_admin")) return;

  const { data: membership } = await admin
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!membership) throw new HttpError(403, "Sem acesso a esta empresa.");
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

/** Nomes técnicos já usados pela empresa (inclui arquivadas). */
async function takenNames(companyId: string): Promise<string[]> {
  const admin = serviceClient();
  const { data } = await admin
    .from("hook7_instances")
    .select("external_name")
    .eq("company_id", companyId);
  return (data ?? [])
    .map((r) => r.external_name)
    .filter((v): v is string => typeof v === "string" && !!v);
}

function statusFromState(state: string): "connected" | "pairing" | "disconnected" {
  if (state === "open") return "connected";
  if (state === "connecting") return "pairing";
  return "disconnected";
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
          "id, display_name, external_name, status, engine, phone_number, connected_profile_name, owner_user_id, last_connected_at, last_qr_at, created_at",
        )
        .eq("company_id", companyId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw new HttpError(500, error.message);

      // Reconcilia com o provedor: conexões marcadas como "connected" no banco
      // podem ter caído (celular desligado, sessão encerrada, banimento).
      const rows = data ?? [];
      const nowIso = new Date().toISOString();
      await Promise.all(
        rows
          .filter((i) => i.status === "connected")
          .map(async (i) => {
            if (i.engine === ENGINE_LEGACY) {
              i.status = "disconnected";
              await admin
                .from("hook7_instances")
                .update({ status: "disconnected", updated_at: nowIso })
                .eq("id", i.id);
              return;
            }
            try {
              const token = await loadInstanceToken(admin, i.id);
              const state = await connectionState({
                admin,
                instanceName: i.external_name,
                apikey: token,
                timeoutMs: 6000,
              });
              if (state === "open" || state === "unknown") return;
              i.status = "disconnected";
              await admin
                .from("hook7_instances")
                .update({ status: "disconnected", updated_at: nowIso })
                .eq("id", i.id);
            } catch {
              // erro de rede/timeout: não derruba o status (evita falso negativo)
            }
          }),
      );

      return jsonResponse({ instances: rows }, 200, CORS);
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

      const externalName = buildExternalName(
        caller.slug,
        displayName,
        await takenNames(caller.id),
      );

      const suggestedToken = uuidv4();
      const webhookUrl = buildWaWebhookUrl(caller.slug);

      const created = await createInstance({
        admin,
        instanceName: externalName,
        token: suggestedToken,
        webhookUrl,
      });

      const { data: ins, error: insErr } = await admin
        .from("hook7_instances")
        .insert({
          company_id: caller.id,
          owner_user_id: user.id,
          display_name: displayName,
          external_id: created.external_id,
          external_name: created.external_name,
          engine: ENGINE_EVOLUTION_API,
          status: created.qrcode_base64 ? "qr_ready" : "pending_qr",
          last_qr_at: created.qrcode_base64 ? new Date().toISOString() : null,
          created_by: user.id,
        })
        .select("id, display_name, external_name, status, engine")
        .single();

      if (insErr) {
        try {
          await deleteInstance({ admin, instanceName: created.external_name });
        } catch { /* best-effort */ }
        throw new HttpError(500, insErr.message);
      }

      try {
        await storeInstanceToken(admin, ins.id, created.token);
      } catch (e) {
        await admin.from("hook7_instances").delete().eq("id", ins.id);
        try {
          await deleteInstance({ admin, instanceName: created.external_name });
        } catch { /* best-effort */ }
        throw e;
      }

      // Garante o webhook mesmo quando o provedor ignora o bloco do /create.
      try {
        await setInstanceWebhook({
          admin,
          instanceName: created.external_name,
          apikey: created.token,
          webhookUrl,
        });
      } catch { /* non-fatal */ }

      return jsonResponse(
        { instance: ins, qrcode_base64: created.qrcode_base64 },
        200,
        CORS,
      );
    }

    // Ações abaixo requerem instance_id
    const instanceId = String(body?.instance_id ?? "");
    if (!instanceId) throw new HttpError(400, "instance_id obrigatório.");
    const inst = await loadInstance(instanceId);
    await assertCanAccess(user.id, inst.company_id);
    // Consultar o estado é necessário para a tela de todos os membros. Ações
    // que alteram a conexão continuam exclusivas de administradores.
    if (action !== "status") await assertCanManage(user.id, inst.company_id);
    const isLegacy = inst.engine === ENGINE_LEGACY;

    // ---------------- CONNECT / RECONNECT / QR ----------------
    if (action === "connect" || action === "reconnect" || action === "qr") {
      // Conexão do motor antigo: reprovisiona na MESMA linha do banco
      // (nada é excluído; o usuário só lê o QR-Code de novo).
      if (isLegacy) {
        const slug = await loadCompanySlug(inst.company_id);
        const webhookUrl = buildWaWebhookUrl(slug);
        const newName = buildExternalName(
          slug,
          inst.display_name,
          await takenNames(inst.company_id),
        );
        const created = await createInstance({
          admin,
          instanceName: newName,
          token: uuidv4(),
          webhookUrl,
        });
        await storeInstanceToken(admin, inst.id, created.token);
        const nowIso = new Date().toISOString();
        await admin
          .from("hook7_instances")
          .update({
            external_id: created.external_id,
            external_name: created.external_name,
            engine: ENGINE_EVOLUTION_API,
            status: created.qrcode_base64 ? "qr_ready" : "pending_qr",
            phone_number: null,
            connected_profile_name: null,
            user_disconnected_at: null,
            last_error: null,
            last_qr_at: created.qrcode_base64 ? nowIso : null,
            updated_at: nowIso,
          })
          .eq("id", inst.id);

        // Melhor esforço: remove o resto da instância antiga no provedor.
        if (inst.external_name && inst.external_name !== created.external_name) {
          try {
            await deleteInstance({ admin, instanceName: inst.external_name });
          } catch { /* pode nem existir mais */ }
        }

        try {
          await setInstanceWebhook({
            admin,
            instanceName: created.external_name,
            apikey: created.token,
            webhookUrl,
          });
        } catch { /* non-fatal */ }

        let qr = created.qrcode_base64;
        if (!qr) {
          try {
            const c = await connectInstance({
              admin,
              instanceName: created.external_name,
              apikey: created.token,
            });
            qr = c.qrcode_base64;
          } catch { /* front pode pedir o QR de novo */ }
        }
        return jsonResponse({ ok: true, reprovisioned: true, qrcode_base64: qr }, 200, CORS);
      }

      const token = await loadInstanceToken(admin, inst.id);
      const slug = await loadCompanySlug(inst.company_id);
      const webhookUrl = buildWaWebhookUrl(slug);

      if (action !== "qr") {
        try {
          await setInstanceWebhook({
            admin,
            instanceName: inst.external_name,
            apikey: token,
            webhookUrl,
          });
        } catch { /* non-fatal */ }
      }

      const r = await connectInstance({
        admin,
        instanceName: inst.external_name,
        apikey: token,
      });

      // Sessão já ativa no provedor: não há QR e o estado volta como "open".
      if (!r.qrcode_base64 && r.state === "open") {
        const nowIso = new Date().toISOString();
        await admin
          .from("hook7_instances")
          .update({
            status: "connected",
            last_connected_at: nowIso,
            user_disconnected_at: null,
            updated_at: nowIso,
          })
          .eq("id", inst.id);
        return jsonResponse(
          { ok: true, already_connected: true, qrcode_base64: null },
          200,
          CORS,
        );
      }

      if (r.qrcode_base64) {
        await admin
          .from("hook7_instances")
          .update({
            status: "qr_ready",
            last_qr_at: new Date().toISOString(),
            user_disconnected_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", inst.id);
      }

      return jsonResponse(
        { ok: true, qrcode_base64: r.qrcode_base64, pairing_code: r.pairing_code },
        200,
        CORS,
      );
    }

    // ---------------- STATUS ----------------
    if (action === "status") {
      if (isLegacy) {
        return jsonResponse(
          { status: "disconnected", connected_profile_name: null, legacy: true, message: LEGACY_MSG },
          200,
          CORS,
        );
      }
      const token = await loadInstanceToken(admin, inst.id);
      let state: string;
      try {
        state = await connectionState({
          admin,
          instanceName: inst.external_name,
          apikey: token,
          timeoutMs: 8000,
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

      if (state === "unknown") {
        return jsonResponse(
          { status: inst.status, connected_profile_name: null },
          200,
          CORS,
        );
      }

      // Se o usuário desconectou manualmente há pouco, ignora uma resposta
      // "open" desatualizada do provedor.
      const recentUserDisconnect = withinUserDisconnectWindow(inst);
      let nextStatus = statusFromState(state);
      if (nextStatus === "connected" && recentUserDisconnect) nextStatus = inst.status;
      if (nextStatus === "disconnected" && inst.status === "qr_ready") {
        nextStatus = "qr_ready"; // ainda aguardando leitura do QR
      }

      // deno-lint-ignore no-explicit-any
      const patch: Record<string, any> = {
        status: nextStatus,
        updated_at: new Date().toISOString(),
      };
      if (nextStatus === "connected") patch.last_connected_at = new Date().toISOString();
      await admin.from("hook7_instances").update(patch).eq("id", inst.id);
      return jsonResponse({ status: nextStatus, connected_profile_name: null }, 200, CORS);
    }

    // ---------------- DISCONNECT ----------------
    if (action === "disconnect") {
      const nowIso = new Date().toISOString();
      if (isLegacy) {
        await admin
          .from("hook7_instances")
          .update({ status: "disconnected", user_disconnected_at: nowIso, updated_at: nowIso })
          .eq("id", inst.id);
        return jsonResponse({ ok: true, logged_out: true, remote_confirmed: true }, 200, CORS);
      }

      const token = await loadInstanceToken(admin, inst.id);
      let loggedOut = false;
      try {
        await logoutInstance({ admin, instanceName: inst.external_name, apikey: token });
        loggedOut = true;
      } catch (e) {
        console.warn("logout falhou:", String(e));
      }

      let remoteConfirmed = loggedOut;
      try {
        const state = await connectionState({
          admin,
          instanceName: inst.external_name,
          apikey: token,
          timeoutMs: 8000,
        });
        remoteConfirmed = state !== "open";
      } catch { /* mantém o valor de loggedOut */ }

      await admin
        .from("hook7_instances")
        .update({
          status: "disconnected",
          user_disconnected_at: nowIso,
          updated_at: nowIso,
          last_error: remoteConfirmed ? null : "sessao_ainda_ativa_apos_logout",
        })
        .eq("id", inst.id);
      return jsonResponse(
        { ok: true, logged_out: loggedOut, remote_confirmed: remoteConfirmed },
        200,
        CORS,
      );
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
        return jsonResponse({ ok: true, skipped: "connected" }, 200, CORS);
      }

      let instToken: string | null = null;
      try {
        instToken = await loadInstanceToken(admin, inst.id);
      } catch { /* token pode não existir */ }

      let remoteDeleted = false;
      let remoteError: string | null = null;

      if (!isLegacy && inst.external_name) {
        // 1) encerra a sessão (o provedor recusa apagar instância ativa)
        if (instToken) {
          try {
            await logoutInstance({
              admin,
              instanceName: inst.external_name,
              apikey: instToken,
            });
          } catch { /* best-effort */ }
          await new Promise((r) => setTimeout(r, 1200));
        }
        // 2) apaga a instância (chave global e, se falhar, token da instância)
        for (const key of [undefined, instToken ?? undefined]) {
          try {
            await deleteInstance({
              admin,
              instanceName: inst.external_name,
              apikey: key,
            });
            remoteDeleted = true;
            remoteError = null;
            break;
          } catch (e) {
            remoteError = e instanceof Error ? e.message : String(e);
          }
        }
        if (!remoteDeleted) {
          console.error("delete remoto falhou", {
            instance: inst.external_name,
            error: remoteError,
          });
        }
      } else {
        remoteDeleted = true; // legado: nada a apagar no motor atual
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
      return jsonResponse(
        { ok: true, remote_deleted: remoteDeleted, remote_error: remoteError },
        200,
        CORS,
      );
    }

    throw new HttpError(400, `Ação desconhecida: ${action}`);
  } catch (e) {
    return errorResponse(e, CORS);
  }
});
