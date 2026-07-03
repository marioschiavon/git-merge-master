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

function brVariants(d: string): string[] {
  const out = new Set<string>([d]);
  if (d.startsWith("55") && d.length >= 12) {
    const ddi = d.slice(0, 2);
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    if (rest.length === 8) out.add(`${ddi}${ddd}9${rest}`);
    if (rest.length === 9 && rest.startsWith("9")) out.add(`${ddi}${ddd}${rest.slice(1)}`);
  }
  return Array.from(out);
}

// deno-lint-ignore no-explicit-any
async function handleInboundMessage(admin: any, instance: any, company: any, body: any): Promise<boolean> {
  const d = body?.data ?? body ?? {};
  // Formato Hook7 (semelhante Evolution API): { key: { remoteJid, fromMe, id }, message: { conversation | extendedTextMessage.text } }
  const key = d.key ?? {};
  const fromMe = key?.fromMe === true || d?.fromMe === true;
  if (fromMe) return false;
  const remoteJid: string = String(key?.remoteJid ?? d?.remoteJid ?? d?.from ?? "");
  const messageId: string | null = key?.id ?? d?.id ?? d?.messageId ?? null;
  const text: string =
    d?.message?.conversation ??
    d?.message?.extendedTextMessage?.text ??
    d?.text?.message ??
    d?.body ??
    "";
  if (!remoteJid || !text) return false;

  const fromDigits = remoteJid.split("@")[0].replace(/\D/g, "");
  if (!fromDigits) return false;
  const fromPhone = `+${fromDigits}`;

  // Dedup por provider_message_id
  if (messageId) {
    const { data: dup } = await admin
      .from("messages")
      .select("id")
      .eq("provider", "hook7")
      .eq("provider_message_id", String(messageId))
      .maybeSingle();
    if (dup) return true;
  }

  // Localiza lead por telefone dentro da company
  const { data: leads } = await admin
    .from("leads")
    .select("id, phone, whatsapp")
    .eq("company_id", company.id)
    .or("phone.not.is.null,whatsapp.not.is.null");
  const fromVariants = brVariants(fromDigits);
  const lead = (leads || []).find((l: any) => {
    const cands = [l.whatsapp, l.phone]
      .filter(Boolean)
      .flatMap((p: string) => brVariants(p.replace(/\D/g, "")));
    return cands.some((c) =>
      fromVariants.some((f) => c === f || c.endsWith(f.slice(-10)) || f.endsWith(c.slice(-10))),
    );
  });
  if (!lead) {
    console.warn("[hook7-webhook] lead não encontrado", { fromPhone, company: company.id });
    return false;
  }

  // Conversation: reaproveita a mais recente do lead
  let { data: conv } = await admin
    .from("conversations")
    .select("id")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conv) {
    const { data: newConv } = await admin
      .from("conversations")
      .insert({ lead_id: lead.id, company_id: company.id, channel: "whatsapp" })
      .select("id")
      .single();
    conv = newConv;
  }

  await admin.from("messages").insert({
    conversation_id: conv!.id,
    content: text,
    direction: "inbound",
    channel: "whatsapp",
    ai_suggested: false,
    metadata: { hook7_message_id: messageId, from: fromPhone, instance_id: instance.id },
    provider: "hook7",
    provider_message_id: messageId ? String(messageId) : null,
  });

  // Encaminha para pipeline (intenção, IA) pulando insert duplicado
  const invokeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/inbound-webhook`;
  fetch(invokeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      lead_id: lead.id,
      conversation_id: conv!.id,
      content: text,
      channel: "whatsapp",
      skip_insert: true,
      provider: "hook7",
      provider_message_id: messageId ? String(messageId) : null,
    }),
  }).catch((e) => console.error("[hook7-webhook] inbound forward error:", e));

  return true;
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
      } else if (event === "MESSAGE" || event === "messages.upsert") {
        const handled = await handleInboundMessage(admin, instance, company, body);
        processStatus = handled ? "processed" : "ignored";
      } else if (event === "READ_RECEIPT" || event === "SEND_MESSAGE") {
        // Não temos ainda ganchos de status para outbound Hook7 além do próprio
        // retorno HTTP do sendText. Deixa como ignorado.
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
