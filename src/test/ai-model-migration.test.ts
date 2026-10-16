import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { estimateCostUsd } from "../lib/ai-pricing";

const root = resolve(process.cwd(), "supabase/functions");
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("Gateway model migration", () => {
  it("does not select the four deprecated models in executable Gateway calls", () => {
    const code = sources(root).filter((path) => !path.endsWith("ai-fallback.ts"))
      .map((path) => readFileSync(path, "utf8")).join("\n");
    expect(code).not.toMatch(/["'](?:google\/gemini-2\.5-(?:flash-lite|flash|pro)|openai\/gpt-5)["']/);
    for (const model of ["google/gemini-3.8-flash", "google/gemini-3.1-flash-lite", "google/gemini-4-argon", "openai/gpt-6.1-sol"]) {
      expect(code).toContain(`"${model}"`);
    }
  });

  it("sets a supported reasoning level on both SDR tool requests", () => {
    const code = readFileSync(resolve(root, "sdr-agent/index.ts"), "utf8");
    const requests = [...code.matchAll(/chatCompletion\(\{\s*model: MODEL,\s*reasoning_effort: "(\w+)"/g)];
    expect(requests).toHaveLength(2);
    expect(requests.map((match) => match[1])).toEqual(["low", "low"]);
  });

  it("preserves the high-capability native fallback route for the upgraded agent", () => {
    const code = readFileSync(resolve(root, "_shared/ai-fallback.ts"), "utf8");
    expect(code).toMatch(/"google\/gemini-4-argon":\s*\{ openai: "gpt-4o",\s*gemini: "gemini-2.5-pro" \}/);
    expect(code).toMatch(/"openai\/gpt-6.1-sol":\s*\{ openai: "gpt-4o",\s*gemini: "gemini-2.5-pro" \}/);
  });

  it.each([
    ["google/gemini-3.8-flash", 4.5],
    ["google/gemini-3.1-flash-lite", 1.75],
    ["google/gemini-4-argon", 12],
    ["openai/gpt-6.1-sol", 12],
    ["google/gemini-2.5-flash", 2.8],
  ])("uses catalog base prices and preserves historical estimates for %s", (model, total) => {
    expect(estimateCostUsd(model as string, 1_000_000, 1_000_000)).toBeCloseTo(total as number);
  });
});