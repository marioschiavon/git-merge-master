import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../supabase/functions/_shared/ai-fallback.ts", () => ({
  getFallbackKeys: vi.fn(async () => ({ openai: "test-key", gemini: null })),
  mapModel: vi.fn(() => "gpt-4o"),
  isFallbackable: vi.fn((status: number) => status === 500),
  logFallback: vi.fn(),
  EMBEDDING_MAP: {},
}));

import { chatCompletion } from "../supabase/functions/_shared/ai-gateway";

const answer = { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "ok" } }] };
afterEach(() => vi.unstubAllGlobals());

describe("upgraded Gateway request contract", () => {
  it("preserves history and tool options and sends the supported reasoning level", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "test-key" } });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const messages = [{ role: "user" as const, content: "Teste" }];
    await chatCompletion({ model: "google/gemini-4-argon", messages, reasoning_effort: "low", temperature: 0.3, tool_choice: "auto" });
    const request = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(request).toEqual({ model: "google/gemini-4-argon", messages, reasoning_effort: "low", temperature: 0.3, tool_choice: "auto" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not forward Gateway-only reasoning into the preserved native fallback", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "test-key" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("transient", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await chatCompletion({ model: "google/gemini-4-argon", messages: [{ role: "user", content: "Teste" }], reasoning_effort: "low", temperature: 0.3 });
    const fallback = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fallback.model).toBe("gpt-4o");
    expect(fallback.temperature).toBe(0.3);
    expect(fallback).not.toHaveProperty("reasoning_effort");
  });
});