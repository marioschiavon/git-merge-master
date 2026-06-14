import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyIntent, REDIRECT_RE } from "./intent-classifier.ts";

Deno.test("REDIRECT_RE: 'não seria comigo'", () => {
  assertEquals(REDIRECT_RE.test("Muito legal, mas esse assunto não seria comigo."), true);
});

Deno.test("REDIRECT_RE: 'não sou eu'", () => {
  assertEquals(REDIRECT_RE.test("Não sou eu que cuido disso"), true);
});

Deno.test("REDIRECT_RE: 'quem cuida disso é'", () => {
  assertEquals(REDIRECT_RE.test("Quem cuida disso é o financeiro"), true);
});

Deno.test("REDIRECT_RE: 'fala com Marina'", () => {
  assertEquals(REDIRECT_RE.test("Fala com a Marina"), true);
});

Deno.test("REDIRECT_RE: NÃO casa 'não tenho interesse'", () => {
  assertEquals(REDIRECT_RE.test("não tenho interesse"), false);
});

Deno.test("REDIRECT_RE: NÃO casa saudação", () => {
  assertEquals(REDIRECT_RE.test("oi, tudo bem?"), false);
});

Deno.test("classifyIntent: fast-path redirect → referral sem chamar LLM", async () => {
  const r = await classifyIntent({
    lastInbound: "Muito legal, mas esse assunto não seria comigo.",
    recentHistory: [],
    state: { hasActiveBooking: false, activeBookingAt: null, offeredSlots: [] },
  });
  assertEquals(r.intent, "referral");
  assertEquals(r.confidence >= 0.9, true);
});
