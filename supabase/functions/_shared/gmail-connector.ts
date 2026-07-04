// Shared helper for calling the Lovable Gmail connector gateway.
// One workspace-level Gmail account is used platform-wide.

const GATEWAY_BASE = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

export class GmailConnectorNotLinkedError extends Error {
  constructor() {
    super("Gmail connector não linkado no workspace (GOOGLE_MAIL_API_KEY ausente).");
    this.name = "GmailConnectorNotLinkedError";
  }
}

function requireKeys() {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const connKey = Deno.env.get("GOOGLE_MAIL_API_KEY");
  if (!lovableKey || !connKey) throw new GmailConnectorNotLinkedError();
  return { lovableKey, connKey };
}

export async function gmailGatewayFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { lovableKey, connKey } = requireKeys();
  const url = `${GATEWAY_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${lovableKey}`);
  headers.set("X-Connection-Api-Key", connKey);
  return await fetch(url, { ...init, headers });
}

export async function gmailGetJson(path: string): Promise<any> {
  const r = await gmailGatewayFetch(path);
  if (!r.ok) throw new Error(`Gmail GET ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function gmailPostJson(path: string, body: any): Promise<Response> {
  return await gmailGatewayFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Cached lookup of the connected Gmail address (per warm container).
let cachedProfile: { email: string; historyId?: string; fetchedAt: number } | null = null;

export async function getConnectorProfile(force = false): Promise<{ email: string; historyId?: string }> {
  const now = Date.now();
  if (!force && cachedProfile && now - cachedProfile.fetchedAt < 5 * 60_000) {
    return { email: cachedProfile.email, historyId: cachedProfile.historyId };
  }
  const data = await gmailGetJson("/users/me/profile");
  cachedProfile = {
    email: (data.emailAddress || "").toLowerCase(),
    historyId: data.historyId ? String(data.historyId) : undefined,
    fetchedAt: now,
  };
  return { email: cachedProfile.email, historyId: cachedProfile.historyId };
}
