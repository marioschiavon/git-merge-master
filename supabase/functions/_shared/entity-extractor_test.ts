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
