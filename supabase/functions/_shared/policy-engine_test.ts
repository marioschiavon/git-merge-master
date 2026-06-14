// Deno tests for the policy engine — pure decision matrix.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decidePolicy } from "./policy-engine.ts";

const baseEntities = {
  selected_slot_iso: null,
  ambiguous_slot: false,
  date_preference: null,
  prefers_period: null,
};
const baseState = {
  has_active_booking: false,
  active_booking_at: null,
  active_booking_uid: null,
  offered_slots: [],
  held_slots: [],
};

Deno.test("reschedule + active booking + selected slot → forced reschedule_booking", () => {
  const d = decidePolicy({
    intent: "reschedule_booking",
    confidence: 0.9,
    entities: { ...baseEntities, selected_slot_iso: "2026-06-18T17:45:00-03:00" },
    state: {
      ...baseState,
      has_active_booking: true,
      active_booking_at: "2026-06-15T10:00:00-03:00",
      active_booking_uid: "abc",
    },
  });
  assertEquals(d.forced_tool, "reschedule_booking");
  assertEquals(d.allowed_tools.includes("book_slot"), false);
});

Deno.test("confirm_slot + selected + no active → forced book_slot", () => {
  const d = decidePolicy({
    intent: "confirm_slot",
    confidence: 0.95,
    entities: { ...baseEntities, selected_slot_iso: "2026-06-18T17:45:00-03:00" },
    state: { ...baseState, offered_slots: ["2026-06-18T17:45:00-03:00"] },
  });
  assertEquals(d.forced_tool, "book_slot");
});

Deno.test("confirm_slot + slot == active booking → no-op", () => {
  const iso = "2026-06-18T17:45:00-03:00";
  const d = decidePolicy({
    intent: "confirm_slot",
    confidence: 0.9,
    entities: { ...baseEntities, selected_slot_iso: iso },
    state: { ...baseState, has_active_booking: true, active_booking_at: iso, active_booking_uid: "x" },
  });
  assertEquals(d.stage, "no_op_already_booked");
  assertEquals(d.forced_tool, null);
});

Deno.test("create_booking with existing booking → clarify", () => {
  const d = decidePolicy({
    intent: "create_booking",
    confidence: 0.9,
    entities: baseEntities,
    state: { ...baseState, has_active_booking: true, active_booking_at: "2026-06-15T10:00:00-03:00", active_booking_uid: "x" },
  });
  assertEquals(d.stage, "scheduling_clarify");
  assertEquals(d.forced_tool, null);
});

Deno.test("cancel_booking without active booking → clarify", () => {
  const d = decidePolicy({
    intent: "cancel_booking",
    confidence: 0.95,
    entities: baseEntities,
    state: baseState,
  });
  assertEquals(d.stage, "scheduling_clarify");
  assertEquals(d.forced_tool, null);
});

Deno.test("cancel_booking + active + high conf → forced cancel_booking", () => {
  const d = decidePolicy({
    intent: "cancel_booking",
    confidence: 0.9,
    entities: baseEntities,
    state: { ...baseState, has_active_booking: true, active_booking_at: "2026-06-15T10:00:00-03:00", active_booking_uid: "x" },
  });
  assertEquals(d.forced_tool, "cancel_booking");
});

Deno.test("ask_availability → check_calendar allowed, no forced tool", () => {
  const d = decidePolicy({
    intent: "ask_availability",
    confidence: 0.9,
    entities: baseEntities,
    state: baseState,
  });
  assertEquals(d.allowed_tools.includes("check_calendar"), true);
  assertEquals(d.forced_tool, null);
});

Deno.test("confirm_slot ambiguous → clarify (no booking tools)", () => {
  const d = decidePolicy({
    intent: "confirm_slot",
    confidence: 0.7,
    entities: { ...baseEntities, ambiguous_slot: true },
    state: { ...baseState, offered_slots: ["2026-06-18T17:45:00-03:00", "2026-06-18T18:30:00-03:00"] },
  });
  assertEquals(d.stage, "scheduling_clarify");
  assertEquals(d.allowed_tools.includes("book_slot"), false);
  assertEquals(d.allowed_tools.includes("reschedule_booking"), false);
});

Deno.test("confirm_slot — single pendente, no active → forced book", () => {
  const d = decidePolicy({
    intent: "confirm_slot",
    confidence: 0.9,
    entities: baseEntities,
    state: { ...baseState, offered_slots: ["2026-06-18T17:45:00-03:00"] },
  });
  assertEquals(d.forced_tool, "book_slot");
  assertEquals((d.forced_args as any).slot_start, "2026-06-18T17:45:00-03:00");
});

Deno.test("confirm_slot + selected + active booking diff hour → forced reschedule (not book)", () => {
  const d = decidePolicy({
    intent: "confirm_slot",
    confidence: 0.9,
    entities: { ...baseEntities, selected_slot_iso: "2026-06-22T17:45:00-03:00" },
    state: {
      ...baseState,
      has_active_booking: true,
      active_booking_at: "2026-06-22T17:00:00-03:00",
      active_booking_uid: "uid-x",
      offered_slots: ["2026-06-22T17:45:00-03:00"],
    },
  });
  assertEquals(d.forced_tool, "reschedule_booking");
  assertEquals(d.allowed_tools.includes("book_slot"), false);
  assertEquals((d.forced_args as any).slot_start, "2026-06-22T17:45:00-03:00");
});

Deno.test("create_booking + selected + active booking diff hour → forced reschedule (not book)", () => {
  const d = decidePolicy({
    intent: "create_booking",
    confidence: 0.85,
    entities: { ...baseEntities, selected_slot_iso: "2026-06-22T17:45:00-03:00" },
    state: {
      ...baseState,
      has_active_booking: true,
      active_booking_at: "2026-06-22T17:00:00-03:00",
      active_booking_uid: "uid-y",
    },
  });
  assertEquals(d.forced_tool, "reschedule_booking");
  assertEquals(d.stage, "rescheduling_confirming_now");
});
