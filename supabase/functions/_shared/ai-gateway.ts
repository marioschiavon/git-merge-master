// Shared helper for calling Lovable AI Gateway from Deno edge functions.
// Includes an automatic fallback chain (OpenAI → Gemini) triggered when Lovable
// returns 402 (credits) or persistent 401/403/429/5xx. Fallback keys are stored
// encrypted in platform_settings and managed via the master admin UI.

import {
  getFallbackKeys,
  mapModel,
  isFallbackable,
  logFallback,
  EMBEDDING_MAP,
  type Provider,
} from "./ai-fallback.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const OPENAI_URL = "https://api.openai.com/v1";
// Gemini OpenAI-compat endpoint (accepts standard OpenAI chat/completions shape).
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export function getLovableApiKey(): string {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY is not set");
  return key;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; [k: string]: unknown }>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
  response_format?: { type: "json_object" } | { type: "text" };
  /** Optional label used in audit logs when the fallback triggers. */
  _edgeName?: string;
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: string;
    message: ChatMessage & {
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** Provider that actually served this response. */
  _provider?: Provider;
  /** Native model id that served this response. */
  _model_used?: string;
}

async function callChat(
  url: string,
  key: string,
  authHeader: "lovable" | "bearer",
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data?: ChatCompletionResponse; error?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader === "lovable") {
    headers["Lovable-API-Key"] = key;
    headers["X-Lovable-AIG-SDK"] = "edge-fetch";
  } else {
    headers["Authorization"] = `Bearer ${key}`;
  }
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, error: text };
  }
  return { ok: true, status: res.status, data: await res.json() };
}

export async function chatCompletion(
  opts: ChatCompletionOptions,
): Promise<ChatCompletionResponse> {
  const { _edgeName, ...clean } = opts;
  const requestedModel = opts.model;

  // 1) Try Lovable Gateway first.
  const lovableBody = { ...clean };
  let primary: Awaited<ReturnType<typeof callChat>>;
  try {
    primary = await callChat(GATEWAY_URL, getLovableApiKey(), "lovable", lovableBody);
  } catch (e) {
    primary = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
  if (primary.ok && primary.data) {
    primary.data._provider = "lovable";
    primary.data._model_used = requestedModel;
    return primary.data;
  }

  const shouldFallback = isFallbackable(primary.status) || primary.status === 0;
  if (!shouldFallback) {
    // Terminal error (e.g. 400) — don't try fallback.
    throw new Error(`AI Gateway ${primary.status}: ${primary.error ?? ""}`);
  }

  // 2) Try OpenAI if configured.
  const keys = await getFallbackKeys();
  if (keys.openai) {
    const oaModel = mapModel(requestedModel, "openai");
    const oaBody = { ...clean, model: oaModel };
    try {
      const r = await callChat(OPENAI_URL, keys.openai, "bearer", oaBody);
      if (r.ok && r.data) {
        r.data._provider = "openai";
        r.data._model_used = oaModel;
        logFallback({
          primaryStatus: primary.status,
          primaryError: primary.error,
          providerUsed: "openai",
          modelRequested: requestedModel,
          modelUsed: oaModel,
          edgeFunction: _edgeName,
        });
        return r.data;
      }
    } catch (_) {
      // fall through to Gemini
    }
  }

  // 3) Try Gemini if configured.
  if (keys.gemini) {
    const gmModel = mapModel(requestedModel, "gemini");
    const gmBody = { ...clean, model: gmModel };
    try {
      const r = await callChat(GEMINI_URL, keys.gemini, "bearer", gmBody);
      if (r.ok && r.data) {
        r.data._provider = "gemini";
        r.data._model_used = gmModel;
        logFallback({
          primaryStatus: primary.status,
          primaryError: primary.error,
          providerUsed: "gemini",
          modelRequested: requestedModel,
          modelUsed: gmModel,
          edgeFunction: _edgeName,
        });
        return r.data;
      }
    } catch (_) {
      // fall through
    }
  }

  // All providers failed.
  logFallback({
    primaryStatus: primary.status,
    primaryError: primary.error,
    providerUsed: null,
    modelRequested: requestedModel,
    modelUsed: null,
    edgeFunction: _edgeName,
    severity: "critical",
  });
  throw new Error(`AI Gateway ${primary.status}: ${primary.error ?? "all providers failed"}`);
}

export interface EmbeddingOptions {
  model?: string;
  input: string | string[];
  dimensions?: number;
}

export interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
  _provider?: Provider;
}

async function callEmbedding(
  url: string,
  key: string,
  authHeader: "lovable" | "bearer",
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data?: EmbeddingResponse; error?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader === "lovable") {
    headers["Lovable-API-Key"] = key;
    headers["X-Lovable-AIG-SDK"] = "edge-fetch";
  } else {
    headers["Authorization"] = `Bearer ${key}`;
  }
  const res = await fetch(`${url}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, error: text };
  }
  return { ok: true, status: res.status, data: await res.json() };
}

export async function createEmbedding(
  opts: EmbeddingOptions,
): Promise<EmbeddingResponse> {
  const primaryModel = opts.model ?? "google/gemini-embedding-001";
  const body: Record<string, unknown> = {
    model: primaryModel,
    input: opts.input,
    ...(opts.dimensions ? { dimensions: opts.dimensions } : {}),
  };

  let primary: Awaited<ReturnType<typeof callEmbedding>>;
  try {
    primary = await callEmbedding(GATEWAY_URL, getLovableApiKey(), "lovable", body);
  } catch (e) {
    primary = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
  if (primary.ok && primary.data) {
    primary.data._provider = "lovable";
    return primary.data;
  }

  if (!isFallbackable(primary.status) && primary.status !== 0) {
    throw new Error(`AI Gateway embeddings ${primary.status}: ${primary.error ?? ""}`);
  }

  const keys = await getFallbackKeys();

  // OpenAI embeddings
  if (keys.openai) {
    const oaModel = EMBEDDING_MAP.openai.model;
    const oaBody: Record<string, unknown> = { model: oaModel, input: opts.input };
    if (opts.dimensions) oaBody.dimensions = opts.dimensions;
    try {
      const r = await callEmbedding(OPENAI_URL, keys.openai, "bearer", oaBody);
      if (r.ok && r.data) {
        r.data._provider = "openai";
        logFallback({
          primaryStatus: primary.status,
          primaryError: primary.error,
          providerUsed: "openai",
          modelRequested: primaryModel,
          modelUsed: oaModel,
        });
        return r.data;
      }
    } catch (_) { /* try gemini */ }
  }

  // Gemini embeddings
  if (keys.gemini) {
    const gmModel = EMBEDDING_MAP.gemini.model;
    const gmBody: Record<string, unknown> = { model: gmModel, input: opts.input };
    try {
      const r = await callEmbedding(GEMINI_URL, keys.gemini, "bearer", gmBody);
      if (r.ok && r.data) {
        r.data._provider = "gemini";
        logFallback({
          primaryStatus: primary.status,
          primaryError: primary.error,
          providerUsed: "gemini",
          modelRequested: primaryModel,
          modelUsed: gmModel,
        });
        return r.data;
      }
    } catch (_) { /* fall through */ }
  }

  logFallback({
    primaryStatus: primary.status,
    primaryError: primary.error,
    providerUsed: null,
    modelRequested: primaryModel,
    modelUsed: null,
    severity: "critical",
  });
  throw new Error(`AI Gateway embeddings ${primary.status}: ${primary.error ?? "all providers failed"}`);
}
