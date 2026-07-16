// Helper para chamadas Resend chamando api.resend.com diretamente.
// Resolução da chave Resend, em ordem:
//   1. Chave criptografada em platform_settings (gerenciada pela UI do master).
//   2. Fallback: RESEND_API_KEY do connector do workspace (legado).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const RESEND_API = "https://api.resend.com";

export class ResendNotConfiguredError extends Error {
  constructor() { super("Resend não configurado"); this.name = "ResendNotConfiguredError"; }
}

let cachedKey: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

async function fetchMasterKeyFromDb(): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const passphrase = Deno.env.get("RESEND_KEY_PASSPHRASE");
  if (!url || !service || !passphrase) return null;
  try {
    const admin = createClient(url, service);
    const { data, error } = await admin.rpc("get_resend_master_key", { _passphrase: passphrase });
    if (error) return null;
    const key = typeof data === "string" ? data.trim() : null;
    return key && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export async function resolveResendKey(): Promise<{ key: string; source: "db" | "connector" }> {
  const now = Date.now();
  if (cachedKey && now - cachedAt < CACHE_TTL_MS) {
    return { key: cachedKey, source: "db" };
  }
  const dbKey = await fetchMasterKeyFromDb();
  if (dbKey) {
    cachedKey = dbKey;
    cachedAt = now;
    return { key: dbKey, source: "db" };
  }
  const envKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (envKey) return { key: envKey, source: "connector" };
  throw new ResendNotConfiguredError();
}

export function invalidateResendKeyCache() {
  cachedKey = null;
  cachedAt = 0;
}

export async function resendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { key: rk } = await resolveResendKey();
  const url = `${RESEND_API}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${rk}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return await fetch(url, { ...init, headers });
}

export async function resendJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await resendFetch(path, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`Resend ${init.method || "GET"} ${path} ${r.status}: ${text}`);
  return text ? JSON.parse(text) : ({} as T);
}

// Chamada direta ao Resend usando uma chave crua (para validação antes de salvar).
export async function resendFetchWithKey(apiKey: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${RESEND_API}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return await fetch(url, { ...init, headers });
}
