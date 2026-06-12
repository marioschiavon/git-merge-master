// Shared helper for calling Lovable AI Gateway directly from Deno edge functions.
// Used by the unified SDR agent, summarizer, embedder and reflection step.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";

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
  tool_choice?: "auto" | "none" | "required";
  temperature?: number;
  response_format?: { type: "json_object" } | { type: "text" };
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
}

export async function chatCompletion(
  opts: ChatCompletionOptions,
): Promise<ChatCompletionResponse> {
  const res = await fetch(`${GATEWAY_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": getLovableApiKey(),
      "X-Lovable-AIG-SDK": "edge-fetch",
    },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${text}`);
  }
  return await res.json();
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
}

export async function createEmbedding(
  opts: EmbeddingOptions,
): Promise<EmbeddingResponse> {
  const res = await fetch(`${GATEWAY_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": getLovableApiKey(),
      "X-Lovable-AIG-SDK": "edge-fetch",
    },
    body: JSON.stringify({
      model: opts.model ?? "google/gemini-embedding-001",
      input: opts.input,
      ...(opts.dimensions ? { dimensions: opts.dimensions } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI Gateway embeddings ${res.status}: ${text}`);
  }
  return await res.json();
}
