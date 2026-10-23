import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabase/functions/_shared/ai-fallback.ts", () => ({
  getFallbackKeys: vi.fn(async () => ({ openai: "synthetic-key", gemini: null })),
  mapModel: vi.fn(() => "gpt-4o-mini"),
  isFallbackable: (status: number) => status === 402,
  logFallback: vi.fn(),
  EMBEDDING_MAP: {},
}));
import { chatCompletionResponse } from "../supabase/functions/_shared/ai-gateway";
import { logFallback } from "../supabase/functions/_shared/ai-fallback";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("master credit contingency", () => {
  it("routes exhausted Lovable credits to the master OpenAI with the same prompt", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "synthetic-key" } });
    const messages = [{ role: "user" as const, content: "Teste sintético" }];
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: "Not enough credits" }), { status: 402 }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "OK" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await chatCompletionResponse({ model: "google/gemini-3.8-flash", messages, _edgeName: "cadence-executor", response_format: { type: "json_object" } });
    expect(response.status).toBe(200);
    expect((await response.json())._provider).toBe("openai");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ model: "gpt-4o-mini", messages, response_format: { type: "json_object" } });
    expect(logFallback).toHaveBeenCalledWith(expect.objectContaining({ primaryStatus: 402, providerUsed: "openai", edgeFunction: "cadence-executor" }));
  });
  it.each([400, 401, 403, 404, 429, 500])("does not rotate providers for terminal or non-credit status %s", async status => {
    vi.stubGlobal("Deno", { env: { get: () => "synthetic-key" } });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ message: "Serviço bloqueado" }, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await chatCompletionResponse({ model: "google/gemini-3.8-flash", messages: [{ role: "user", content: "Teste" }] });
    expect(response.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ error: "Serviço bloqueado", message: "Serviço bloqueado" });
  });
});