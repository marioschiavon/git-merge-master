// Shared Nylas v3 helpers.
// White-label: user-facing UI never mentions "Nylas" beyond a small footnote.

export const NYLAS_API_URI = Deno.env.get("NYLAS_API_URI") || "https://api.us.nylas.com";
export const NYLAS_CLIENT_ID = Deno.env.get("NYLAS_CLIENT_ID") || "";
export const NYLAS_API_KEY = Deno.env.get("NYLAS_API_KEY") || "";
export const NYLAS_WEBHOOK_SECRET = Deno.env.get("NYLAS_WEBHOOK_SECRET") || "";

// Free-tier hard cap. Bump only when we upgrade the Nylas plan.
export const NYLAS_MAX_GRANTS = 5;

export type NylasProvider = "google" | "microsoft" | "imap";

export function nylasScopesFor(provider: NylasProvider): string[] {
  switch (provider) {
    case "google":
      // Google exige URLs completas. 'email'/'profile' curtos são rejeitados
      // pela Nylas v3 com scope_not_allowed.
      return [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "openid",
      ];
    case "microsoft":
      return [
        "https://graph.microsoft.com/Mail.ReadWrite",
        "https://graph.microsoft.com/Mail.Send",
        "https://graph.microsoft.com/User.Read",
        "offline_access",
        "openid",
      ];
    case "imap":
      return [];
  }
}

export function buildAuthUrl(params: {
  provider: NylasProvider;
  redirectUri: string;
  state: string;
  loginHint?: string;
}): string {
  const url = new URL(`${NYLAS_API_URI}/v3/connect/auth`);
  url.searchParams.set("client_id", NYLAS_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("provider", params.provider);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("state", params.state);
  const scopes = nylasScopesFor(params.provider);
  if (scopes.length) url.searchParams.set("scope", scopes.join(" "));
  if (params.loginHint) url.searchParams.set("login_hint", params.loginHint);
  return url.toString();
}

export async function exchangeCode(params: {
  code: string;
  redirectUri: string;
}): Promise<{
  grant_id: string;
  email: string;
  provider: NylasProvider;
  scope?: string;
}> {
  const res = await fetch(`${NYLAS_API_URI}/v3/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: NYLAS_CLIENT_ID,
      client_secret: NYLAS_API_KEY,
      code: params.code,
      redirect_uri: params.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `nylas token exchange failed: ${res.status} ${JSON.stringify(body)}`,
    );
  }
  return {
    grant_id: body.grant_id,
    email: body.email,
    provider: (body.provider || "google") as NylasProvider,
    scope: body.scope,
  };
}

export async function revokeGrant(grantId: string): Promise<void> {
  const res = await fetch(`${NYLAS_API_URI}/v3/grants/${grantId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${NYLAS_API_KEY}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`nylas revoke failed: ${res.status} ${text}`);
  }
}

// HMAC-SHA256 verification of Nylas webhook signature.
// Header: X-Nylas-Signature (hex-encoded HMAC of raw body using webhook secret).
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader || !NYLAS_WEBHOOK_SECRET) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(NYLAS_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // constant-time-ish comparison
  if (hex.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) {
    diff |= hex.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}

// Fetch a message body (used by inbound webhook to enrich).
export async function fetchMessage(
  grantId: string,
  messageId: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `${NYLAS_API_URI}/v3/grants/${grantId}/messages/${messageId}`,
    { headers: { Authorization: `Bearer ${NYLAS_API_KEY}` } },
  );
  if (!res.ok) return null;
  const body = await res.json();
  return body?.data ?? null;
}

// Send an outbound email via Nylas v3.
// Docs: POST /v3/grants/{grant_id}/messages/send
export async function sendMessage(params: {
  grantId: string;
  to: string;
  toName?: string;
  fromName?: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  replyToMessageId?: string; // Nylas message id (thread parent) — enables native threading
  customHeaders?: Record<string, string>;
}): Promise<{
  id: string;
  thread_id: string;
  message_id_header: string | null;
}> {
  const payload: Record<string, unknown> = {
    subject: params.subject,
    to: [{ email: params.to, ...(params.toName ? { name: params.toName } : {}) }],
    body: params.bodyHtml,
  };
  if (params.replyToMessageId) payload.reply_to_message_id = params.replyToMessageId;
  if (params.customHeaders) {
    payload.custom_headers = Object.entries(params.customHeaders).map(([name, value]) => ({ name, value }));
  }
  const res = await fetch(
    `${NYLAS_API_URI}/v3/grants/${params.grantId}/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NYLAS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`nylas send failed: ${res.status} ${JSON.stringify(body)}`);
  }
  const data = body?.data ?? {};
  const headers = Array.isArray(data.headers) ? data.headers : [];
  const midHeader = headers.find((h: any) => (h?.name || "").toLowerCase() === "message-id")?.value ?? null;
  return {
    id: String(data.id ?? ""),
    thread_id: String(data.thread_id ?? ""),
    message_id_header: midHeader,
  };
}
