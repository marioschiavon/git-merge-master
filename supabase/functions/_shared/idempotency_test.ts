import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildIdempotencyKey } from "./idempotency.ts";

Deno.test("buildIdempotencyKey is deterministic", async () => {
  const a = await buildIdempotencyKey({
    conversation_id: "conv-1",
    lead_id: "lead-1",
    action_type: "book",
    requested_start: "2026-06-20T17:00:00-03:00",
  });
  const b = await buildIdempotencyKey({
    conversation_id: "conv-1",
    lead_id: "lead-1",
    action_type: "book",
    requested_start: "2026-06-20T17:00:00-03:00",
  });
  assertEquals(a, b);
  assertEquals(a.length, 64); // SHA-256 hex
});

Deno.test("different slot_start → different key", async () => {
  const a = await buildIdempotencyKey({
    conversation_id: "conv-1",
    action_type: "book",
    requested_start: "2026-06-20T17:00:00-03:00",
  });
  const b = await buildIdempotencyKey({
    conversation_id: "conv-1",
    action_type: "book",
    requested_start: "2026-06-21T17:00:00-03:00",
  });
  assertNotEquals(a, b);
});

Deno.test("different action_type → different key", async () => {
  const a = await buildIdempotencyKey({
    conversation_id: "conv-1",
    action_type: "book",
    requested_start: "2026-06-20T17:00:00-03:00",
  });
  const b = await buildIdempotencyKey({
    conversation_id: "conv-1",
    action_type: "cancel",
    requested_start: "2026-06-20T17:00:00-03:00",
  });
  assertNotEquals(a, b);
});

Deno.test("nullable fields default to empty string consistently", async () => {
  const a = await buildIdempotencyKey({ action_type: "cancel", provider_booking_uid: "uid-1" });
  const b = await buildIdempotencyKey({
    conversation_id: null,
    lead_id: null,
    action_type: "cancel",
    requested_start: null,
    provider_booking_uid: "uid-1",
  });
  assertEquals(a, b);
});
