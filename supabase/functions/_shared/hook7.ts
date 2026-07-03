// Shared Hook7 client + helpers for Edge Functions.
// Mirrors the model used in Leaderei Foundation:
//   - HOOK7_GLOBAL_APIKEY  → chave global (S7 / platform) usada apenas para
//     criar / apagar instâncias no Hook7.
//   - Token por instância  → gerado no /instance/create e usado para
//     todas as demais chamadas daquela instância (connect, qr, status,
//     send/text, logout, disconnect, reconnect).
//   - HOOK7_INSTANCE_TOKEN_PASSPHRASE → passphrase (pgcrypto) usada pelas
//     RPCs set/get_hook7_instance_token para criptografar/decifrar o token.
//   - HOOK7_WEBHOOK_SECRET → path secret do webhook Hook7.
//   - HOOK7_INSTANCE_PREFIX (opcional, default "lead").

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const DEFAULT_BASE_URL = "https://api.hook7.com.br";
export const INSTANCE_PREFIX =
  (Deno.env.get("HOOK7_INSTANCE_PREFIX") ?? "lead").trim() || "lead";

// Eventos Hook7 processados (mesmos usados no Foundation).
export const HOOK7_SUBSCRIBE_EVENTS = [
  "MESSAGE",
  "SEND_MESSAGE",
  "READ_RECEIPT",
  "CONNECTION",
] as const;

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

export function getHook7GlobalApiKey(): string {
  const key = (Deno.env.get("HOOK7_GLOBAL_APIKEY") ?? "").trim();
  if (!key) {
    throw new Error(
      "HOOK7_GLOBAL_APIKEY não configurada. Defina no painel de secrets.",
    );
  }
  return key;
}

export function getHook7InstancePassphrase(): string {
  const p = (Deno.env.get("HOOK7_INSTANCE_TOKEN_PASSPHRASE") ?? "").trim();
  if (!p || p.length < 16) {
    throw new Error(
      "HOOK7_INSTANCE_TOKEN_PASSPHRASE ausente ou muito curta (mínimo 16).",
    );
  }
  return p;
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, service);
}

export async function getHook7BaseUrl(
  admin: SupabaseClient = serviceClient(),
): Promise<string> {
  const { data } = await admin
    .from("platform_settings")
    .select("hook7_base_url")
    .eq("singleton", true)
    .maybeSingle();
  const v =
    typeof data?.hook7_base_url === "string" && data.hook7_base_url.length > 0
      ? data.hook7_base_url
      : DEFAULT_BASE_URL;
  return v.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

export function slugify(input: string): string {
  return (input ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function shortId(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

export function buildExternalName(
  companySlug: string,
  displayName: string,
): string {
  const o = slugify(companySlug) || "company";
  const n = slugify(displayName) || "wa";
  return `${INSTANCE_PREFIX}-${o}-${n}-${shortId(6)}`;
}

export function uuidv4(): string {
  return crypto.randomUUID();
}

export function buildWebhookUrl(companySlug: string): string {
  const secret = (Deno.env.get("HOOK7_WEBHOOK_SECRET") ?? "").trim();
  const supaUrl = (Deno.env.get("SUPABASE_URL") ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!secret || !supaUrl) return "";
  return `${supaUrl}/functions/v1/hook7-webhook/${secret}/${
    encodeURIComponent(companySlug)
  }`;
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export type Hook7Method = "GET" | "POST" | "DELETE" | "PUT" | "PATCH";

export interface Hook7FetchOpts {
  method: Hook7Method;
  apikey: string;
  body?: unknown;
  timeoutMs?: number;
  baseUrl?: string;
}

export async function hook7Fetch<T = unknown>(
  path: string,
  opts: Hook7FetchOpts,
): Promise<T> {
  const base = opts.baseUrl ?? (await getHook7BaseUrl());
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers: {
        apikey: opts.apikey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error
      ? (e.name === "AbortError" ? "tempo esgotado" : e.message)
      : "erro de rede";
    throw new Error(`Falha ao contactar Hook7: ${msg}`);
  }
  clearTimeout(timer);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch { /* ignore */ }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("Hook7: credencial inválida.");
    }
    if (res.status === 404) throw new Error("Hook7: recurso não encontrado.");
    // deno-lint-ignore no-explicit-any
    const j = json as any;
    const msg = j?.message || j?.error || `HTTP ${res.status}`;
    throw new Error(`Hook7: ${msg}`);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Token helpers (encrypted at rest via pgp_sym_encrypt)
// ---------------------------------------------------------------------------

export async function storeInstanceToken(
  admin: SupabaseClient,
  instanceId: string,
  token: string,
): Promise<void> {
  const passphrase = getHook7InstancePassphrase();
  const { error } = await admin.rpc("set_hook7_instance_token", {
    _instance_id: instanceId,
    _token: token,
    _passphrase: passphrase,
  });
  if (error) throw new Error(`Falha ao salvar token: ${error.message}`);
}

export async function loadInstanceToken(
  admin: SupabaseClient,
  instanceId: string,
): Promise<string> {
  const passphrase = getHook7InstancePassphrase();
  const { data, error } = await admin.rpc("get_hook7_instance_token", {
    _instance_id: instanceId,
    _passphrase: passphrase,
  });
  if (error) throw new Error(`Falha ao ler token: ${error.message}`);
  if (!data || typeof data !== "string") {
    throw new Error("Token da instância indisponível.");
  }
  return data;
}
