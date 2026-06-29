import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractEntities } from "./entity-extractor.ts";

// Stub matcher: matches text to ISO if the ISO date (YYYY-MM-DD) substring appears
// in text after normalizing "dia NN" → that day in the candidate.
function makeMatcher() {
  return (text: string, isos: string[]) => {
    const t = text.toLowerCase();
    const matches: string[] = [];
    for (const iso of isos) {
      const day = iso.slice(8, 10); // DD
      if (new RegExp(`\\bdia\\s*${Number(day)}\\b`).test(t) || t.includes(iso.slice(0, 10))) {
        matches.push(iso);
      }
    }
    if (matches.length === 0) return { iso: null, ambiguous: false };
    if (matches.length === 1) return { iso: matches[0], ambiguous: false };
    return { iso: null, ambiguous: true };
  };
}

Deno.test("desempate: 'dia 22' prioriza offered slot, ignora active booking no mesmo dia", () => {
  const r = extractEntities({
    lastInbound: "dia 22 ta bom",
    offeredSlots: ["2026-06-22T17:45:00-03:00"],
    heldSlots: [],
    activeBookingAt: "2026-06-22T17:00:00-03:00",
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.selected_slot_iso, "2026-06-22T17:45:00-03:00");
  assertEquals(r.ambiguous_slot, false);
});

Deno.test("sem oferta, 'dia 22' bate no active booking", () => {
  const r = extractEntities({
    lastInbound: "dia 22 ta bom",
    offeredSlots: [],
    heldSlots: [],
    activeBookingAt: "2026-06-22T17:00:00-03:00",
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.selected_slot_iso, "2026-06-22T17:00:00-03:00");
});

Deno.test("referral_contact: extrai email + permissão", () => {
  const r = extractEntities({
    lastInbound: "Familiarochacarneiro@gmail.com\nPode dizer que eu indiquei",
    offeredSlots: [],
    heldSlots: [],
    activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.email, "familiarochacarneiro@gmail.com");
  assertEquals(r.referral_contact?.permission_to_mention, true);
});

Deno.test("referral_contact: extrai telefone BR", () => {
  const r = extractEntities({
    lastInbound: "Fala com a Maria, telefone (11) 99999-1234",
    offeredSlots: [],
    heldSlots: [],
    activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.phone, "11999991234");
});

Deno.test("referral_contact: nulo quando não há sinal", () => {
  const r = extractEntities({
    lastInbound: "ok, obrigado",
    offeredSlots: [],
    heldSlots: [],
    activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact, null);
});


Deno.test("referral_contact: detecta redirect_signal 'não seria comigo'", () => {
  const r = extractEntities({
    lastInbound: "Muito legal, mas esse assunto não seria comigo.",
    offeredSlots: [],
    heldSlots: [],
    activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.redirect_signal, true);
  assertEquals(r.referral_contact?.email, undefined);
  assertEquals(r.referral_contact?.phone, undefined);
  assertEquals(r.referral_contact?.name, undefined);
});

Deno.test("referral_contact: detecta 'quem cuida disso é'", () => {
  const r = extractEntities({
    lastInbound: "Quem cuida disso é o financeiro",
    offeredSlots: [],
    heldSlots: [],
    activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.redirect_signal, true);
});

Deno.test("referral_contact: extrai nome em 'com o Carlos'", () => {
  const r = extractEntities({
    lastInbound: "Tudo bem? Não seria comigo e sim com o Carlos.",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.name, "Carlos");
  assertEquals(r.referral_contact?.redirect_signal, true);
});

Deno.test("referral_contact: extrai nome em 'a pessoa correta chama Andreia'", () => {
  const r = extractEntities({
    lastInbound: "Confundi. A pessoa correta chama Andreia. Email dela é familiarochacarneiro@gmail.com",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.name, "Andreia");
  assertEquals(r.referral_contact?.email, "familiarochacarneiro@gmail.com");
});

Deno.test("referral_contact: extrai nome em 'nome dela é Andreia'", () => {
  const r = extractEntities({
    lastInbound: "O nome dela é Andreia",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.name, "Andreia");
});

Deno.test("referral_contact: extrai 'não sou eu é o Carlos Vilagran'", () => {
  const r = extractEntities({
    lastInbound: "Quem cuida disso nao sou eu é o Carlos Vilagran.",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.name, "Carlos Vilagran");
  assertEquals(r.referral_contact?.redirect_signal, true);
});

Deno.test("referral_contact: fallback 'é o X' só com redirect signal", () => {
  // Sem redirect signal e sem padrão dedicado: não captura como nome.
  const r1 = extractEntities({
    lastInbound: "O preço é o melhor do mercado.",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r1.referral_contact?.name, undefined);

  // Com redirect: captura via fallback "é a Andreia".
  const r2 = extractEntities({
    lastInbound: "Não seria comigo. É a Andreia.",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r2.referral_contact?.name, "Andreia");
  assertEquals(r2.referral_contact?.redirect_signal, true);
});

Deno.test("referral_contact: captura nome com título e ponto 'Dra. Claudia'", () => {
  const r = extractEntities({
    lastInbound: "pode falar com a Dra. Claudia",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.name, "Dra Claudia");
  assertEquals(r.referral_contact?.name_needs_llm, undefined);
});

Deno.test("referral_contact: captura 'Dr. João Silva' com sobrenome", () => {
  const r = extractEntities({
    lastInbound: "quem cuida disso é o Dr. João Silva",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.name, "Dr João Silva");
});

Deno.test("referral_contact: só título 'Dra' marca name_needs_llm", () => {
  const r = extractEntities({
    lastInbound: "fala com a Dra",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact?.name, undefined);
  assertEquals(r.referral_contact?.name_needs_llm, true);
});

Deno.test("referral_contact: sem contexto nominal NÃO marca name_needs_llm", () => {
  const r = extractEntities({
    lastInbound: "ok, obrigado",
    offeredSlots: [], heldSlots: [], activeBookingAt: null,
    matchesSlotRef: makeMatcher(),
  });
  assertEquals(r.referral_contact, null);
});

