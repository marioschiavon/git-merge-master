// Shared helpers for per-company Gmail OAuth (Google API v1).
// Handles: reading tokens from gmail_account (via RPC), refreshing access_token
// with the refresh_token, and providing a fetch helper that auto-retries once
// on 401.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_BASE_URL = "https://gmail.googleapis.com/gmail/v1";

export interface GmailTokenInfo {
  email: string;
  access_token: string;
  refresh_token: string;
  scope: string | null;
  expires_at: string | null;
}

export class GmailNotConnectedError extends Error {
  constructor(companyId: string) {
    super(`Gmail não conectado para a company ${companyId}`);
    this.name = "GmailNotConnectedError";
  }
}

export class GmailAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "GmailAuthError";
  }
}

function getPassphrase(): string {
  const p = Deno.env.get("GMAIL_TOKEN_PASSPHRASE");
  if (!p || p.length < 16) {
    throw new Error("GMAIL_TOKEN_PASSPHRASE ausente ou muito curto");
  }
  return p;
}

/** Force-refresh the access token using the refresh_token. */
export async function refreshAccessToken(
  supabase: any,
  companyId: string,
  refreshToken: string,
): Promise<{ access_token: string; expires_at: string }> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new GmailAuthError("GOOGLE_OAUTH_CLIENT_ID/SECRET ausentes");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Google token refresh failed:", res.status, errText);
    await supabase.rpc("mark_gmail_error", {
      _company_id: companyId,
      _error: `refresh_failed: ${res.status} ${errText.slice(0, 300)}`,
    });
    throw new GmailAuthError(`refresh_token inválido (${res.status})`);
  }

  const json = await res.json();
  const accessToken: string = json.access_token;
  const expiresIn: number = json.expires_in ?? 3600;
  const expiresAt = new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();

  await supabase.rpc("update_gmail_access_token", {
    _company_id: companyId,
    _access_token: accessToken,
    _access_token_expires_at: expiresAt,
  });

  return { access_token: accessToken, expires_at: expiresAt };
}

/** Load tokens for a company, refreshing the access_token if expired/missing. */
export async function getGmailToken(
  supabase: any,
  companyId: string,
): Promise<GmailTokenInfo> {
  const { data, error } = await supabase.rpc("get_gmail_oauth_tokens", {
    _company_id: companyId,
    _passphrase: getPassphrase(),
  });
  if (error) throw new Error(`get_gmail_oauth_tokens: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.refresh_token) {
    throw new GmailNotConnectedError(companyId);
  }

  const now = Date.now();
  const expiresAtMs = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : 0;
  let accessToken = row.access_token as string | null;
  let expiresAt = row.access_token_expires_at as string | null;

  if (!accessToken || expiresAtMs - now < 30_000) {
    const refreshed = await refreshAccessToken(supabase, companyId, row.refresh_token);
    accessToken = refreshed.access_token;
    expiresAt = refreshed.expires_at;
  }

  return {
    email: row.email,
    access_token: accessToken!,
    refresh_token: row.refresh_token,
    scope: row.scope ?? null,
    expires_at: expiresAt,
  };
}

/** fetch() wrapper that adds Authorization and retries once on 401 after refresh. */
export async function gmailApiFetch(
  supabase: any,
  companyId: string,
  path: string,
  init: RequestInit = {},
  tokenInfoRef?: { current: GmailTokenInfo },
): Promise<Response> {
  let tokenInfo = tokenInfoRef?.current ?? (await getGmailToken(supabase, companyId));
  if (tokenInfoRef) tokenInfoRef.current = tokenInfo;

  const url = path.startsWith("http") ? path : `${GMAIL_BASE_URL}${path}`;
  const doFetch = (t: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${t}`,
      },
    });

  let res = await doFetch(tokenInfo.access_token);
  if (res.status === 401) {
    // Force refresh once
    const refreshed = await refreshAccessToken(supabase, companyId, tokenInfo.refresh_token);
    tokenInfo = { ...tokenInfo, access_token: refreshed.access_token, expires_at: refreshed.expires_at };
    if (tokenInfoRef) tokenInfoRef.current = tokenInfo;
    res = await doFetch(tokenInfo.access_token);
  }
  return res;
}

// ---------- HMAC helpers for signed OAuth state ----------

async function hmacSha256(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncode(obj: any): string {
  const json = JSON.stringify(obj);
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): any {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return JSON.parse(atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")));
}

export interface OAuthStatePayload {
  company_id: string;
  user_id: string;
  origin: string;
  nonce: string;
  exp: number;
}

export async function signState(payload: OAuthStatePayload): Promise<string> {
  const body = b64urlEncode(payload);
  const sig = await hmacSha256(getPassphrase(), body);
  return `${body}.${sig}`;
}

export async function verifyState(state: string): Promise<OAuthStatePayload> {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("state malformado");
  const expected = await hmacSha256(getPassphrase(), body);
  if (expected !== sig) throw new Error("state inválido (assinatura)");
  const payload = b64urlDecode(body) as OAuthStatePayload;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("state expirado");
  }
  return payload;
}
