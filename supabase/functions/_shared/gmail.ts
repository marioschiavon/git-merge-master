// Envio pela API do Gmail em nome do usuário (conexão direta com Google).
import { callAsAppUser, GATEWAY_BASE_URL } from "./appUserConnector.ts";
import { GMAIL_SCOPES } from "./appUserConnections.ts";

const b64 = (s: string) =>
  btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));
const hdr = (v: string) => (/^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

export class GmailReconnectError extends Error {}

export async function gmailSend(opts: {
  connectionAPIKey: string;
  fromEmail: string;
  fromName?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  threadId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}): Promise<{ id: string; thread_id: string; message_id_header: string }> {
  const domain = opts.fromEmail.split("@")[1] || "leaderei.com.br";
  const messageIdHeader = `<${crypto.randomUUID()}@${domain}>`;
  const boundary = `b_${crypto.randomUUID().replace(/-/g, "")}`;
  const subject = opts.inReplyTo && !/^re:/i.test(opts.subject) ? `Re: ${opts.subject}` : opts.subject;
  const lines = [
    `From: ${opts.fromName ? `${hdr(opts.fromName)} ` : ""}<${opts.fromEmail}>`,
    `To: ${opts.to}`,
    `Subject: ${hdr(subject)}`,
    `Message-ID: ${messageIdHeader}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${opts.references || opts.inReplyTo}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(opts.text || opts.html.replace(/<[^>]+>/g, " ")),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(opts.html),
    `--${boundary}--`,
  ];
  const raw = b64(lines.join("\r\n")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const res = await callAsAppUser({
    gatewayBaseUrl: GATEWAY_BASE_URL,
    connectionAPIKey: opts.connectionAPIKey,
    connectorId: "google_mail",
    path: "/gmail/v1/users/me/messages/send",
    requiredScopes: GMAIL_SCOPES,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts.threadId ? { raw, threadId: opts.threadId } : { raw }),
    },
  });
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => null) as any;
    if (typeof body?.type === "string" && body.type.startsWith("credential_")) {
      throw new GmailReconnectError("Acesso ao Gmail precisa ser renovado (reconectar).");
    }
  }
  if (!res.ok) throw new Error(`Gmail send failed [${res.status}]: ${await res.text()}`);
  const j = await res.json();
  return { id: j.id, thread_id: j.threadId, message_id_header: messageIdHeader };
}
