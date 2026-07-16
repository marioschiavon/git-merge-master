// Helper para chamadas à API do ElevenLabs (STT).
// A chave master é lida de platform_settings (gerenciada pelo painel do master),
// reutilizando a mesma passphrase do Resend para descriptografia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const ELEVENLABS_API = "https://api.elevenlabs.io";

export class ElevenLabsNotConfiguredError extends Error {
  constructor() {
    super("ElevenLabs não configurado");
    this.name = "ElevenLabsNotConfiguredError";
  }
}

let cachedKey: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

function passphrase(): string | null {
  // Reaproveita a passphrase do Resend (já configurada no projeto).
  return Deno.env.get("RESEND_KEY_PASSPHRASE") ?? null;
}

async function fetchMasterKeyFromDb(): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pass = passphrase();
  if (!url || !service || !pass) return null;
  try {
    const admin = createClient(url, service);
    const { data, error } = await admin.rpc("get_elevenlabs_master_key", { _passphrase: pass });
    if (error) return null;
    const key = typeof data === "string" ? data.trim() : null;
    return key && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export async function resolveElevenLabsKey(): Promise<string> {
  const now = Date.now();
  if (cachedKey && now - cachedAt < CACHE_TTL_MS) return cachedKey;
  const dbKey = await fetchMasterKeyFromDb();
  if (dbKey) {
    cachedKey = dbKey;
    cachedAt = now;
    return dbKey;
  }
  throw new ElevenLabsNotConfiguredError();
}

export function invalidateElevenLabsKeyCache() {
  cachedKey = null;
  cachedAt = 0;
}

export async function elevenLabsFetchWithKey(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${ELEVENLABS_API}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("xi-api-key", apiKey);
  return await fetch(url, { ...init, headers });
}

export async function elevenLabsFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = await resolveElevenLabsKey();
  return elevenLabsFetchWithKey(key, path, init);
}

export async function getElevenLabsModel(): Promise<string> {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return "scribe_v2";
  try {
    const admin = createClient(url, service);
    const { data } = await admin
      .from("platform_settings")
      .select("elevenlabs_model")
      .eq("singleton", true)
      .maybeSingle();
    const m = (data as any)?.elevenlabs_model;
    return typeof m === "string" && m.length > 0 ? m : "scribe_v2";
  } catch {
    return "scribe_v2";
  }
}
