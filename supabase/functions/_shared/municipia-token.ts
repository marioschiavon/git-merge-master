// Short-lived HMAC token used by the MunicipIA iframe to push leads into Leaderei.
// Signed with the service role key (server-side only, never exposed to the browser).

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function key(): Promise<CryptoKey> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!secret) throw new Error("Missing signing secret");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export interface MunicipiaClaims {
  company_id: string;
  user_id: string;
  exp: number; // epoch seconds
}

export async function signMunicipiaToken(claims: MunicipiaClaims): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

export async function verifyMunicipiaToken(token: string): Promise<MunicipiaClaims> {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) throw new Error("Token inválido");
  const ok = await crypto.subtle.verify("HMAC", await key(), fromB64url(sig), enc.encode(payload));
  if (!ok) throw new Error("Assinatura inválida");
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as MunicipiaClaims;
  if (!claims?.company_id || !claims?.exp || claims.exp * 1000 < Date.now()) {
    throw new Error("Token expirado");
  }
  return claims;
}
