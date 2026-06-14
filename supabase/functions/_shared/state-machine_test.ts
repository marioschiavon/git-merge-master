// Tests for state-machine.ts (Phase 3).
// Pure functions — no Supabase, no network.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeState, type StateInputs } from "./state-machine.ts";

function baseInputs(overrides: Partial<StateInputs> = {}): StateInputs {
  return {
    hasInbound: true,
    lastInbound: "",
    lastIntent: null,
    factsOfferedSlotsPending: null,
    heldSlots: [],
    activeBookings: [],
    datePreference: null,
    matchesSlotRef: () => ({ iso: null, ambiguous: false }),
    isLikelyConfirmation: () => false,
    ...overrides,
  };
}

Deno.test("awaiting_first_reply when no inbound", () => {
  const s = computeState(baseInputs({ hasInbound: false }));
  assertEquals(s.conversation_stage, "awaiting_first_reply");
  assertEquals(s.finalize_allowed, true);
});

Deno.test("scheduling_request when wants_to_schedule and no offered", () => {
  const s = computeState(
    baseInputs({ lastIntent: { sub_intent: "wants_to_schedule" } }),
  );
  assertEquals(s.conversation_stage, "scheduling_request");
  assertEquals(s.finalize_allowed, false);
  assertEquals(s.allowed_actions.includes("check_calendar"), true);
});

Deno.test("product_qna requires search_knowledge before finalize", () => {
  const s = computeState(
    baseInputs({ lastIntent: { sub_intent: "product_question" } }),
  );
  assertEquals(s.conversation_stage, "product_qna");
  assertEquals(s.finalize_allowed, false);
  assertEquals(s.allowed_actions.includes("search_knowledge"), true);
});

Deno.test("scheduling_confirming_now when lead picks an offered slot", () => {
  const offered = ["2026-06-20T17:00:00-03:00"];
  const s = computeState(
    baseInputs({
      lastInbound: "pode ser o primeiro",
      factsOfferedSlotsPending: { slots: offered, offered_at: new Date().toISOString() },
      matchesSlotRef: (_t, isos) => ({ iso: isos[0], ambiguous: false }),
    }),
  );
  assertEquals(s.conversation_stage, "scheduling_confirming_now");
  assertEquals(s.allowed_actions.includes("book_slot"), true);
  assertEquals(s.finalize_allowed, false);
  assertEquals(s.selected_slot, offered[0]);
});

Deno.test("scheduling_waiting_confirmation when slots offered but no choice", () => {
  const s = computeState(
    baseInputs({
      lastInbound: "hmm",
      factsOfferedSlotsPending: {
        slots: ["2026-06-20T17:00:00-03:00", "2026-06-21T17:00:00-03:00"],
        offered_at: new Date().toISOString(),
      },
    }),
  );
  assertEquals(s.conversation_stage, "scheduling_waiting_confirmation");
  assertEquals(s.finalize_allowed, true);
});

Deno.test("reschedule_request requires an active booking", () => {
  const s = computeState(
    baseInputs({
      lastIntent: { sub_intent: "reschedule_request" },
      activeBookings: [
        { calcom_booking_uid: "abc", scheduled_at: "2026-06-20T17:00:00Z", status: "confirmed" },
      ],
    }),
  );
  assertEquals(s.conversation_stage, "reschedule_request");
  assertEquals(s.finalize_allowed, false);
});

Deno.test("cancel_request stage allowed_actions includes cancel_booking", () => {
  const s = computeState(
    baseInputs({
      lastIntent: { sub_intent: "cancel_request" },
      activeBookings: [
        { calcom_booking_uid: "abc", scheduled_at: "2026-06-20T17:00:00Z", status: "confirmed" },
      ],
    }),
  );
  assertEquals(s.conversation_stage, "cancel_request");
  assertEquals(s.allowed_actions.includes("cancel_booking"), true);
  assertEquals(s.finalize_allowed, false);
});

Deno.test("referral_provided allows finalize", () => {
  const s = computeState(
    baseInputs({ lastIntent: { sub_intent: "provides_referral" } }),
  );
  assertEquals(s.conversation_stage, "referral_provided");
  assertEquals(s.finalize_allowed, true);
});

Deno.test("booking_confirmed when active booking and no special intent", () => {
  const s = computeState(
    baseInputs({
      activeBookings: [
        { calcom_booking_uid: "abc", scheduled_at: "2026-06-20T17:00:00Z", status: "confirmed" },
      ],
    }),
  );
  assertEquals(s.conversation_stage, "booking_confirmed");
  assertEquals(s.finalize_allowed, true);
});

Deno.test("stale offered_slots (>30min) are ignored", () => {
  const oldDate = new Date(Date.now() - 60 * 60_000).toISOString();
  const s = computeState(
    baseInputs({
      factsOfferedSlotsPending: { slots: ["2026-06-20T17:00:00-03:00"], offered_at: oldDate },
    }),
  );
  assertEquals(s.offered_slots.length, 0);
  assertEquals(s.conversation_stage, "general");
});
