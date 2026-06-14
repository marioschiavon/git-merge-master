// Entity extractor (Phase 4 — deterministic-first).
// Resolves selected_slot, date_preference, period preference, and referral
// contact from the lead's last inbound. Pure deterministic — wraps existing
// helpers (matchesSlotReference, extractDateRangeFromText). No LLM call here.

import { extractDateRangeFromText } from "./date-range.ts";

export interface ReferralContact {
  name?: string;
  email?: string;
  phone?: string;
  permission_to_mention?: boolean;
}

export interface EntityResult {
  /** ISO of slot the lead explicitly chose (from offered/held candidates), or null. */
  selected_slot_iso: string | null;
  /** True when the inbound matched multiple candidates without disambiguation. */
  ambiguous_slot: boolean;
  /** Inferred date window from current inbound (e.g. "semana que vem"). */
  date_preference: { start_after?: string; end_before?: string; raw?: string; source?: string } | null;
  /** Coarse period preference if mentioned ("manhã" / "tarde" / "noite"). */
  prefers_period: "morning" | "afternoon" | "evening" | null;
  /** Detected referral contact in the inbound (email/phone/name + mention permission). */
  referral_contact: ReferralContact | null;
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
    return {
      selected_slot_iso: null,
      ambiguous_slot: false,
      date_preference: null,
      prefers_period: null,
      referral_contact: null,
    };
  }

  // Candidates priority: offered (current turn) > held (persisted) > active booking time.
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
  const referral_contact = detectReferralContact(text);

  return {
    selected_slot_iso: ref.iso,
    ambiguous_slot: ref.ambiguous,
    date_preference,
    prefers_period,
    referral_contact,
  };
}

function detectPeriod(text: string): EntityResult["prefers_period"] {
  const t = text.toLowerCase();
  if (/\b(manh[ãa]|cedo|de manh[ãa])\b/.test(t)) return "morning";
  if (/\b(tarde|à tarde|de tarde)\b/.test(t)) return "afternoon";
  if (/\b(noite|à noite|de noite|final do dia|fim do dia)\b/.test(t)) return "evening";
  return null;
}

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i;
// BR phones: (11) 99999-9999 / 11999999999 / +55 11 99999-9999
const PHONE_RE = /(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/;
const PERMISSION_RE = /\b(pode\s+(?:dizer|falar|mencionar|usar)|use\s+meu\s+nome|diga\s+que\s+(?:eu|fui\s+eu)|fui\s+eu\s+que\s+indiquei|sim,?\s+pode|autorizo|tem\s+minha\s+autoriza[çc][ãa]o)\b/i;
const NAME_HINT_RE = /\b(?:falar?\s+com|procurar?\s+(?:o\s+|a\s+|pelo\s+|pela\s+)?|contatar?\s+(?:o\s+|a\s+)?|fala\s+com|fale\s+com)([A-ZÀ-Ý][\wÀ-ÿ'-]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ'-]+){0,2})/;

function detectReferralContact(text: string): ReferralContact | null {
  const email = text.match(EMAIL_RE)?.[0]?.toLowerCase();
  const phoneMatch = text.match(PHONE_RE)?.[0];
  const phoneDigits = phoneMatch ? phoneMatch.replace(/\D/g, "") : "";
  const phone = phoneDigits.length >= 10 ? phoneDigits : undefined;
  const permission = PERMISSION_RE.test(text) ? true : undefined;
  const nameMatch = text.match(NAME_HINT_RE)?.[1];
  const name = nameMatch ? nameMatch.trim() : undefined;

  if (!email && !phone && permission === undefined && !name) return null;
  const contact: ReferralContact = {};
  if (email) contact.email = email;
  if (phone) contact.phone = phone;
  if (name) contact.name = name;
  if (permission !== undefined) contact.permission_to_mention = permission;
  return contact;
}
