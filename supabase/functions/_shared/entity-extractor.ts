// Entity extractor (Phase 4 — deterministic-first).
// Resolves selected_slot, date_preference and basic preferences from the lead's
// last inbound. Pure deterministic — wraps existing helpers (matchesSlotReference,
// extractDateRangeFromText). No LLM call here (classifier already paid the LLM cost).

import { extractDateRangeFromText } from "./date-range.ts";

export interface EntityResult {
  /** ISO of slot the lead explicitly chose (from offered/held candidates), or null. */
  selected_slot_iso: string | null;
  /** True when the inbound matched multiple candidates without disambiguation. */
  ambiguous_slot: boolean;
  /** Inferred date window from current inbound (e.g. "semana que vem"). */
  date_preference: { start_after?: string; end_before?: string; raw?: string; source?: string } | null;
  /** Coarse period preference if mentioned ("manhã" / "tarde" / "noite"). */
  prefers_period: "morning" | "afternoon" | "evening" | null;
}

export type SlotMatcher = (text: string, isos: string[]) => { iso: string | null; ambiguous: boolean };

export function extractEntities(args: {
  lastInbound: string;
  offeredSlots: string[];
  heldSlots: string[];
  activeBookingAt: string | null;
  matchesSlotRef: SlotMatcher;
}): EntityResult {
  const text = (args.lastInbound || "").trim();
  if (!text) {
    return { selected_slot_iso: null, ambiguous_slot: false, date_preference: null, prefers_period: null };
  }

  // Candidates priority: offered (current turn) > held (persisted) > active booking time.
  // Quando o lead aponta uma data que casa tanto com um slot OFERECIDO quanto
  // com o booking ATIVO, priorizamos o oferecido — a intenção dele é escolher
  // a nova oferta, não repetir o horário antigo. Por isso resolvemos primeiro
  // contra offered+held; só caímos para active_booking se nada bater.
  const primary: string[] = Array.from(new Set([
    ...args.offeredSlots,
    ...args.heldSlots,
  ].filter(Boolean)));

  let ref = primary.length > 0
    ? args.matchesSlotRef(text, primary)
    : { iso: null, ambiguous: false };

  if (!ref.iso && !ref.ambiguous && args.activeBookingAt) {
    ref = args.matchesSlotRef(text, [args.activeBookingAt]);
  }

  // Date preference inference (only from CURRENT inbound).
  const range = extractDateRangeFromText(text);
  const date_preference = range && (range.start_after || range.end_before)
    ? {
        start_after: range.start_after,
        end_before: range.end_before,
        raw: text.slice(0, 200),
        source: range.reason,
      }
    : null;

  const prefers_period = detectPeriod(text);

  return {
    selected_slot_iso: ref.iso,
    ambiguous_slot: ref.ambiguous,
    date_preference,
    prefers_period,
  };
}

function detectPeriod(text: string): EntityResult["prefers_period"] {
  const t = text.toLowerCase();
  if (/\b(manh[ãa]|cedo|de manh[ãa])\b/.test(t)) return "morning";
  if (/\b(tarde|à tarde|de tarde)\b/.test(t)) return "afternoon";
  if (/\b(noite|à noite|de noite|final do dia|fim do dia)\b/.test(t)) return "evening";
  return null;
}
