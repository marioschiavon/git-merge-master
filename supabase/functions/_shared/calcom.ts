// Shared Cal.com helpers.
const CALCOM_EVENT_TYPES_API_VERSION = "2024-06-14";

export async function resolveEventTypeId(apiKey: string): Promise<number> {
  const manualId = Deno.env.get("CALCOM_EVENT_TYPE_ID");
  if (manualId && !isNaN(Number(manualId))) {
    return Number(manualId);
  }
  const res = await fetch("https://api.cal.com/v2/event-types", {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch event types from Cal.com: ${res.status}`);
  }
  const json = await res.json();
  const eventTypes = json.data?.eventTypes || json.data || [];
  if (!eventTypes.length) throw new Error("No event types found in Cal.com account");
  return eventTypes[0].id;
}

/** Fetch lengthInMinutes for a given event type id from Cal.com live. */
export async function fetchEventTypeLengthMinutes(
  apiKey: string,
  eventTypeId: number,
): Promise<number | null> {
  try {
    const res = await fetch(`https://api.cal.com/v2/event-types/${eventTypeId}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "cal-api-version": CALCOM_EVENT_TYPES_API_VERSION,
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const et = json.data?.eventType || json.data || json;
    const len = et?.lengthInMinutes ?? et?.length;
    return typeof len === "number" && len > 0 ? len : null;
  } catch (_e) {
    return null;
  }
}
