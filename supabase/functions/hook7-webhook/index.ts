// Hook7 webhook receiver.
// Path: /functions/v1/hook7-webhook/{secret}/{company-slug}
// Sempre retorna 200 — Hook7 não deve reenviar por erros nossos.
//
// Nesta fase de switchover, tratamos apenas eventos de CONEXÃO
// (para sincronizar status/número/nome do perfil após leitura do QR).
// Ingestão de mensagens e criação de leads órfãos serão incrementadas
// numa fase seguinte, seguindo o padrão do Leaderei Foundation.

import {
  loadInstanceToken,
  serviceClient,
} from "../_shared/hook7.ts";

function ok200() {
  return new Response("", { status: 200 });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok200();
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("hook7-webhook");
    if (idx < 0 || parts.length < idx + 3) {
      console.warn("[hook7-webhook] bad path", url.pathname);
      return ok200();
    }
    const secret = parts[idx + 1];
    const companySlug = decodeURIComponent(parts[idx + 2]);

    const expected = (Deno.env.get("HOOK7_WEBHOOK_SECRET") ?? "").trim();
    if (!expected) {
      console.error("[hook7-webhook] HOOK7_WEBHOOK_SECRET não configurada");
      return ok200();
    }
    if (secret !== expected) {
      console.warn("[hook7-webhook] secret mismatch", { companySlug });
      return ok200();
    }

    // deno-lint-ignore no-explicit-any
    const body: any = await req.json().catch(() => ({}));
    const event: string | undefined = body?.event;
    const instanceExtId: string | undefined = body?.instanceId;
    const instanceToken: string | undefined = body?.instanceToken;

    if (!event || !instanceExtId || !instanceToken) {
      console.warn("[hook7-webhook] envelope incompleto", { event });
      return ok200();
    }

    const admin = serviceClient();

    const { data: company } = await admin
      .from("companies")
      .select("id, slug")
      .eq("slug", companySlug)
      .maybeSingle();
    if (!company) {
      console.warn("[hook7-webhook] company não encontrada", { companySlug });
      return ok200();
    }

    const { data: instance } = await admin
      .from("hook7_instances")
      .select("id, company_id, archived_at, status")
      .eq("external_id", instanceExtId)
      .eq("company_id", company.id)
      .maybeSingle();
    if (!instance || instance.archived_at) {
      console.warn("[hook7-webhook] instância não encontrada/arquivada", {
        instanceExtId,
      });
      return ok200();
    }

    // Valida token da instância contra o armazenado (criptografado)
    try {
      const stored = await loadInstanceToken(admin, instance.id);
      if (stored !== instanceToken) {
        console.warn("[hook7-webhook] token mismatch", { instanceExtId });
        return ok200();
      }
    } catch (e) {
      console.warn("[hook7-webhook] erro lendo token", String(e));
      return ok200();
    }

    // -------- Handler por evento --------
    let processStatus: "processed" | "ignored" | "failed" = "ignored";
    try {
      if (event === "CONNECTION" || event === "connection.update") {
        const d = body?.data ?? {};
        const state: string = String(d.State ?? d.state ?? "").toLowerCase();
        const name: string | null =
          typeof d.Name === "string" && d.Name.length > 0 ? d.Name : null;
        const phone: string | null =
          typeof d.PhoneNumber === "string" && d.PhoneNumber.length > 0
            ? d.PhoneNumber
            : (typeof d.Number === "string" ? d.Number : null);
        const connected =
          d.Connected === true || state.includes("connected") ||
          state === "open";
        const loggedOut =
          d.LoggedOut === true || state.includes("logged_out") ||
          state === "close" || state === "closed";

        // deno-lint-ignore no-explicit-any
        const patch: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };
        if (connected) {
          patch.status = "connected";
          patch.last_connected_at = new Date().toISOString();
          if (name) patch.connected_profile_name = name;
          if (phone) patch.phone_number = phone;
        } else if (loggedOut) {
          patch.status = "disconnected";
        }
        if (Object.keys(patch).length > 1) {
          await admin
            .from("hook7_instances")
            .update(patch)
            .eq("id", instance.id);
        }
        processStatus = "processed";
      } else if (event === "MESSAGE" || event === "READ_RECEIPT") {
        // Reservado para próxima fase (ingestão de mensagens + auto-lead).
        console.log("[hook7-webhook] evento ainda não processado", { event });
        processStatus = "ignored";
      } else if (event === "SEND_MESSAGE") {
        processStatus = "ignored";
      } else {
        console.log("[hook7-webhook] evento desconhecido", { event });
      }
    } catch (err) {
      processStatus = "failed";
      console.error("[hook7-webhook] handler error", {
        event,
        error: String(err),
      });
    }

    // Auditoria best-effort (só grava se existir tabela webhook_events)
    try {
      await admin.from("webhook_events").insert({
        source: "hook7",
        company_id: instance.company_id,
        payload: body,
        process_status: processStatus,
        event_type: event,
      });
    } catch { /* tabela pode não existir ainda — ignora */ }

    return ok200();
  } catch (e) {
    console.error("[hook7-webhook] fatal", String(e));
    return ok200();
  }
});
