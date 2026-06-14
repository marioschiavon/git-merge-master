import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildNativeHistory } from "./history-builder.ts";

Deno.test("inbound → role:user, outbound → role:assistant", () => {
  const out = buildNativeHistory([
    { direction: "inbound", content: "olá", created_at: "2026-06-14T12:00:00Z" },
    { direction: "outbound", content: "oi!", created_at: "2026-06-14T12:01:00Z" },
  ]);
  assertEquals(out.length, 2);
  assertEquals(out[0].role, "user");
  assertEquals(out[1].role, "assistant");
});

Deno.test("system events → role:system with marker", () => {
  const out = buildNativeHistory([
    { direction: "system", content: "booking criado", created_at: "2026-06-14T12:00:00Z" },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].role, "system");
  assertEquals((out[0].content as string).includes("sistema"), true);
});

Deno.test("empty content is dropped", () => {
  const out = buildNativeHistory([
    { direction: "inbound", content: "", created_at: "2026-06-14T12:00:00Z" },
    { direction: "outbound", content: "   ", created_at: "2026-06-14T12:01:00Z" },
    { direction: "inbound", content: "ok", created_at: "2026-06-14T12:02:00Z" },
  ]);
  assertEquals(out.length, 1);
});

Deno.test("BRT timestamp prefix is included", () => {
  const out = buildNativeHistory([
    { direction: "inbound", content: "teste", created_at: "2026-06-14T12:00:00Z" },
  ]);
  const content = out[0].content as string;
  // Should contain a bracketed timestamp prefix
  assertEquals(/^\[\d/.test(content), true);
  assertEquals(content.endsWith("teste"), true);
});

Deno.test("channel suffix included in prefix when present", () => {
  const out = buildNativeHistory([
    { direction: "inbound", content: "oi", created_at: "2026-06-14T12:00:00Z", channel: "whatsapp" },
  ]);
  assertEquals((out[0].content as string).includes("whatsapp"), true);
});
