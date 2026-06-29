import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertCanBook, type AssertCanBookDeps } from "./booking-guards.ts";

// Minimal fake supabase: only needs functions.invoke (called for refresh).
function fakeSupabase(invokeResult: unknown = { data: null, error: new Error("not used") }) {
  return {
    functions: {
      invoke: () => Promise.resolve(invokeResult),
    },
  } as unknown as Parameters<typeof assertCanBook>[0];
}

function baseDeps(overrides: Partial<AssertCanBookDeps> = {}): AssertCanBookDeps {
  return {
    facts: {},
    holds: [],
    bookings: [],
    lastInbound: "",
    lastOutbound: "",
    isLikelyConfirmation: () => false,
    matchesSlotReference: () => ({ iso: null, ambiguous: false }),
    implicitOfferFromOutbound: () => null,
    parseSlotStartAsBrt: (s) => Date.parse(s),
    formatBRTLong: (iso) => iso,
    lead_id: "lead-1",
    company_id: "co-1",
    conversation_id: "conv-1",
    ...overrides,
  };
}

Deno.test("Guard 1: book_slot blocked if active booking exists", async () => {
  const r = await assertCanBook(
    fakeSupabase(),
    "book_slot",
    { slot_start: "2026-06-20T17:00:00-03:00" },
    baseDeps({
      bookings: [
        {
          id: "b1",
          calcom_booking_uid: "uid-1",
          status: "confirmed",
          scheduled_at: "2026-06-19T17:00:00Z",
          updated_at: null,
        },
      ],
    }),
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error_code, "active_booking_conflict");
    assertEquals(r.downgrade, "use_reschedule");
  }
});

Deno.test("Guard 1: reschedule_booking blocked if no active booking", async () => {
  const r = await assertCanBook(
    fakeSupabase(),
    "reschedule_booking",
    { slot_start: "2026-06-20T17:00:00-03:00" },
    baseDeps(),
  );
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error_code, "no_active_booking");
});

Deno.test("Guard 1: cancel_booking ok shortcut when active booking exists", async () => {
  const r = await assertCanBook(
    fakeSupabase(),
    "cancel_booking",
    {},
    baseDeps({
      bookings: [
        {
          id: "b1",
          calcom_booking_uid: "uid-1",
          status: "confirmed",
          scheduled_at: "2026-06-19T17:00:00Z",
          updated_at: null,
        },
      ],
    }),
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.activeBookingUid, "uid-1");
});

Deno.test("Guard input: missing slot_start", async () => {
  const r = await assertCanBook(fakeSupabase(), "book_slot", {}, baseDeps());
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error_code, "missing_slot_start");
});

Deno.test("Guard 3: slot not offered → suggested_message asks to pick", async () => {
  const r = await assertCanBook(
    fakeSupabase(),
    "book_slot",
    { slot_start: "2026-06-25T17:00:00-03:00" },
    baseDeps({
      facts: {
        offered_slots_pending: {
          slots: ["2026-06-20T17:00:00-03:00"],
          offered_at: new Date().toISOString(),
        },
      },
      lastInbound: "ok",
      isLikelyConfirmation: () => true,
    }),
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error_code, "slot_not_offered");
    assertEquals(r.downgrade, "ask_confirmation");
  }
});

Deno.test("Guard 3: slot offered but no confirmation → ask confirmation", async () => {
  const offeredIso = "2026-06-20T17:00:00-03:00";
  const r = await assertCanBook(
    fakeSupabase(),
    "book_slot",
    { slot_start: offeredIso },
    baseDeps({
      facts: {
        offered_slots_pending: { slots: [offeredIso], offered_at: new Date().toISOString() },
      },
      lastInbound: "hmm vou pensar",
      isLikelyConfirmation: () => false,
      matchesSlotReference: () => ({ iso: null, ambiguous: false }),
    }),
  );
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error_code, "no_confirmation");
});

Deno.test("Guard 3 OK: offered + explicit confirmation + matching hold", async () => {
  const offeredIso = "2026-06-20T17:00:00-03:00";
  const future = new Date(Date.now() + 30 * 60_000).toISOString();
  const r = await assertCanBook(
    fakeSupabase(),
    "book_slot",
    { slot_start: offeredIso },
    baseDeps({
      facts: {
        offered_slots_pending: { slots: [offeredIso], offered_at: new Date().toISOString() },
      },
      holds: [{ id: "h1", slot_datetime: offeredIso, status: "held", expires_at: future }],
      lastInbound: "pode confirmar",
      isLikelyConfirmation: () => true,
    }),
  );
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.slotIso, offeredIso);
    assertEquals(r.matchedHold?.id, "h1");
  }
});

Deno.test("Guard 3 OK via slot reference (no explicit ack)", async () => {
  const offeredIso = "2026-06-20T17:00:00-03:00";
  const future = new Date(Date.now() + 30 * 60_000).toISOString();
  const r = await assertCanBook(
    fakeSupabase(),
    "book_slot",
    { slot_start: offeredIso },
    baseDeps({
      facts: {
        offered_slots_pending: { slots: [offeredIso], offered_at: new Date().toISOString() },
      },
      holds: [{ id: "h1", slot_datetime: offeredIso, status: "held", expires_at: future }],
      lastInbound: "a primeira opção",
      isLikelyConfirmation: () => false,
      matchesSlotReference: () => ({ iso: offeredIso, ambiguous: false }),
    }),
  );
  assertEquals(r.ok, true);
});

Deno.test("Guard 4: expired hold + refresh ok", async () => {
  const offeredIso = "2026-06-20T17:00:00-03:00";
  const past = new Date(Date.now() - 60_000).toISOString();
  const refreshed = {
    id: "h2",
    slot_datetime: offeredIso,
    status: "held",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  };
  const supa = fakeSupabase({
    data: { available: true, slots: [refreshed] },
    error: null,
  });
  const r = await assertCanBook(
    supa,
    "book_slot",
    { slot_start: offeredIso },
    baseDeps({
      facts: {
        offered_slots_pending: { slots: [offeredIso], offered_at: new Date().toISOString() },
      },
      holds: [{ id: "h1", slot_datetime: offeredIso, status: "held", expires_at: past }],
      lastInbound: "sim",
      isLikelyConfirmation: () => true,
    }),
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.matchedHold?.id, "h2");
});

Deno.test("Guard 4: slot unavailable on refresh → reoffer", async () => {
  const offeredIso = "2026-06-20T17:00:00-03:00";
  const supa = fakeSupabase({
    data: { available: false, slots: [], formatted: ["seg 21/06 17h"] },
    error: null,
  });
  const r = await assertCanBook(
    supa,
    "book_slot",
    { slot_start: offeredIso },
    baseDeps({
      facts: {
        offered_slots_pending: { slots: [offeredIso], offered_at: new Date().toISOString() },
      },
      holds: [],
      lastInbound: "sim",
      isLikelyConfirmation: () => true,
    }),
  );
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.error_code, "slot_unavailable");
    assertEquals(r.downgrade, "reoffer_slots");
  }
});
