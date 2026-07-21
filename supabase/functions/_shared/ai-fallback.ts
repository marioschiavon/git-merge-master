// Fallback chain for Lovable AI Gateway.
// When Lovable returns 402 (credits exhausted) or persistent 429/5xx, we try
// the master OpenAI key, then the master Gemini key.
// Keys are stored encrypted in platform_settings and never exposed to clients.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { logAudit } from "./audit-log.ts";

export type Provider = "lovable" | "openai" | "gemini";

interface FallbackKeys {
  openai: string | null;
  gemini: string | null;
}

let cached: FallbackKeys | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

function passphrase(): string | null {
  return Deno.env.get("RESEND_KEY_PASSPHRASE") ?? null;
}

export function invalidateFallbackKeyCache() {
  cached = null;
  cachedAt = 0;
}

export async function getFallbackKeys(): Promise<FallbackKeys> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const pass = passphrase();
  const empty: FallbackKeys = { openai: null, gemini: null };
  if (!url || !service || !pass) {
    cached = empty;
    cachedAt = now;
    return empty;
  }
  try {
    const admin = createClient(url, service);
    const [oaRes, gmRes] = await Promise.all([
      admin.rpc("get_openai_master_key", { _passphrase: pass }),
      admin.rpc("get_gemini_master_key", { _passphrase: pass }),
    ]);
    const openai = typeof oaRes.data === "string" && oaRes.data.trim() ? oaRes.data.trim() : null;
    const gemini = typeof gmRes.data === "string" && gmRes.data.trim() ? gmRes.data.trim() : null;
    cached = { openai, gemini };
    cachedAt = now;
    return cached;
  } catch {
    cached = empty;
    cachedAt = now;
    return empty;
  }
}

// Map Lovable model ids to provider-native ids.
// OpenAI direct: uses vendor-native names (no `openai/` prefix).
// Gemini via OpenAI-compat endpoint: uses vendor-native `gemini-*`.
const MODEL_MAP: Record<string, { openai: string; gemini: string }> = {
  "openai/gpt-5.5":                { openai: "gpt-4o",       gemini: "gemini-2.5-pro" },
  "openai/gpt-5":                  { openai: "gpt-4o",       gemini: "gemini-2.5-pro" },
  "openai/gpt-5.2":                { openai: "gpt-4o",       gemini: "gemini-2.5-pro" },
  "openai/gpt-5.4":                { openai: "gpt-4o",       gemini: "gemini-2.5-pro" },
  "openai/gpt-5-mini":             { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash" },
  "openai/gpt-5.4-mini":           { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash" },
  "openai/gpt-5-nano":             { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash-lite" },
  "openai/gpt-5.4-nano":           { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash-lite" },
  "google/gemini-2.5-pro":         { openai: "gpt-4o",       gemini: "gemini-2.5-pro" },
  "google/gemini-2.5-flash":       { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash" },
  "google/gemini-2.5-flash-lite":  { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash-lite" },
  "google/gemini-3-flash-preview": { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash" },
  "google/gemini-3.5-flash":       { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash" },
  "google/gemini-3.1-flash-lite":  { openai: "gpt-4o-mini",  gemini: "gemini-2.5-flash-lite" },
  "google/gemini-3.1-pro-preview": { openai: "gpt-4o",       gemini: "gemini-2.5-pro" },
};

const DEFAULT_MAP = { openai: "gpt-4o-mini", gemini: "gemini-2.5-flash" };

export function mapModel(lovableModel: string, target: "openai" | "gemini"): string {
  const entry = MODEL_MAP[lovableModel] ?? DEFAULT_MAP;
  return entry[target];
}

// Embeddings mapping — keep 768 dims (Gemini embedding-001 default) where possible.
export const EMBEDDING_MAP = {
  openai: { model: "text-embedding-3-small", nativeDims: 1536 },
  gemini: { model: "text-embedding-004",      nativeDims: 768  },
};

// Decide whether a failure should trigger a fallback attempt.
// - 402: credits exhausted (primary reason)
// - 401/403: gateway rejected the request (bad key/scope)
// - 429/5xx: rate limit or transient upstream failure
// Everything else (400, etc.) is terminal.
export function isFallbackable(status: number): boolean {
  return status === 402 || status === 401 || status === 403 || status === 429 || (status >= 500 && status < 600);
}

export function logFallback(params: {
  primaryStatus: number;
  primaryError?: string;
  providerUsed: Provider | null;
  modelRequested: string;
  modelUsed: string | null;
  edgeFunction?: string;
  severity?: "warn" | "error" | "critical";
}) {
  logAudit({
    eventType: "ai_fallback_triggered",
    severity: params.severity ?? "warn",
    message:
      params.providerUsed && params.providerUsed !== "lovable"
        ? `Fallback: Lovable ${params.primaryStatus} → ${params.providerUsed} (${params.modelUsed})`
        : `AI fallback esgotado (todas as tentativas falharam)`,
    metadata: {
      primary_status: params.primaryStatus,
      primary_error: params.primaryError?.slice(0, 400) ?? null,
      provider_used: params.providerUsed,
      model_requested: params.modelRequested,
      model_used: params.modelUsed,
      edge_function: params.edgeFunction ?? Deno.env.get("EDGE_FUNCTION_NAME") ?? null,
    },
  });
}
