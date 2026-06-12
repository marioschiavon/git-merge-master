import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { formatBRTLong } from "../_shared/datetime.ts";
import { resolveEventTypeId } from "../_shared/calcom.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CALCOM_SLOTS_API_VERSION = "2024-09-04";
/** Returns YYYY-MM-DD for an ISO datetime in America/Sao_Paulo. */
function sptDateKey(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

/**
 * Pick up to 2 slots from Cal.com's date-grouped slot map, on different days,
 * spread by at least `minSpreadHours` hours, excluding any datetimes in `excludeSet`
 * and any whole days in `excludeDateSet` (YYYY-MM-DD in America/Sao_Paulo).
 */
function pickSpreadSlots(
  slotsData: Record<string, Array<{ start: string }>>,
  excludeSet: Set<number>,
  minSpreadHours: number,
  excludeDateSet: Set<string> = new Set(),
): { date: string; start: string }[] {
  const sortedDates = Object.keys(slotsData).sort();
  const minSpreadMs = minSpreadHours * 3600000;

  const isAllowed = (s: { start: string }, firstTs?: number): boolean => {
    const ts = new Date(s.start).getTime();
    if (excludeSet.has(ts)) return false;
    if ([...excludeSet].some((exc) => Math.abs(ts - exc) < 60000)) return false;
    if (excludeDateSet.has(sptDateKey(s.start))) return false;
    if (firstTs !== undefined && ts - firstTs < minSpreadMs) return false;
    return true;
  };

  // 1st slot: middle of first day with availability
  let first: { date: string; start: string } | null = null;
  let firstIdx = -1;
  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const daySlots = (slotsData[date] || []).filter((s) => isAllowed(s));
    if (daySlots.length > 0) {
      const mid = Math.min(Math.floor(daySlots.length / 2), daySlots.length - 1);
      first = { date, start: daySlots[mid].start };
      firstIdx = i;
      break;
    }
  }
  if (!first) return [];

  // 2nd slot: first date with availability that is ≥ minSpreadHours after the 1st
  const firstTs = new Date(first.start).getTime();
  const firstDayKey = sptDateKey(first.start);
  let second: { date: string; start: string } | null = null;
  for (let i = firstIdx + 1; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const daySlots = (slotsData[date] || []).filter((s) => {
      if (sptDateKey(s.start) === firstDayKey) return false;
      return isAllowed(s, firstTs);
    });
    if (daySlots.length > 0) {
      const mid = Math.min(Math.floor(daySlots.length / 2), daySlots.length - 1);
      second = { date, start: daySlots[mid].start };
      break;
    }
  }

  return second ? [first, second] : [first];
}



serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");
    if (!CALCOM_API_KEY) {
      throw new Error("Cal.com secret not configured (CALCOM_API_KEY)");
    }

    const eventTypeId = await resolveEventTypeId(CALCOM_API_KEY);

    const body = await req.json();
    const { company_id, lead_id, enrollment_id, conversation_id, preferred_channel, check_datetime, exclude_datetimes, exclude_dates, start_after, end_before } = body;

    // Parse exclusion list (array of ISO datetime strings to skip)
    const excludeSet = new Set<number>();
    if (Array.isArray(exclude_datetimes)) {
      for (const dt of exclude_datetimes) {
        const ts = new Date(dt).getTime();
        if (!isNaN(ts)) excludeSet.add(ts);
      }
      console.log(`Excluding ${excludeSet.size} previously offered datetimes`);
    }

    // Parse day-level exclusion (YYYY-MM-DD strings, or ISO datetimes converted to SPT date)
    const excludeDateSet = new Set<string>();
    if (Array.isArray(exclude_dates)) {
      for (const d of exclude_dates) {
        if (typeof d !== "string") continue;
        const key = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : sptDateKey(d);
        if (key) excludeDateSet.add(key);
      }
      console.log(`Excluding ${excludeDateSet.size} previously offered dates (day-level)`);
    }


    if (!company_id || !lead_id) {
      return new Response(JSON.stringify({ error: "company_id and lead_id are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load already-active holds for this lead so we never insert/reserve duplicates.
    const { data: existingHoldsRaw } = await supabase
      .from("slot_holds")
      .select("id, slot_datetime, status, expires_at, cal_booking_uid")
      .eq("lead_id", lead_id)
      .in("status", ["held", "confirmed"])
      .gt("expires_at", new Date().toISOString());
    const existingHolds = existingHoldsRaw ?? [];
    const existingHoldMs = new Map<number, typeof existingHolds[number]>();
    for (const h of existingHolds) {
      const ts = new Date(h.slot_datetime).getTime();
      if (!isNaN(ts)) existingHoldMs.set(ts, h);
    }
    // Existing held datetimes are implicitly "already offered" — exclude them when picking new slots.
    for (const ts of existingHoldMs.keys()) excludeSet.add(ts);

    // Helper: returns existing hold record if the slot datetime is already held for this lead.
    const findExistingHold = (iso: string) => {
      const ts = new Date(iso).getTime();
      if (isNaN(ts)) return null;
      // exact match first
      const exact = existingHoldMs.get(ts);
      if (exact) return exact;
      // tolerance match (within 60s)
      for (const [k, v] of existingHoldMs) {
        if (Math.abs(k - ts) < 60000) return v;
      }
      return null;
    };


    // Window selection — enforce a minimum lead time so we never offer "in 30 minutes"
    const MIN_LEAD_HOURS = Number(Deno.env.get("CALCOM_MIN_LEAD_HOURS") || 24);
    const DEFAULT_WINDOW_DAYS = Number(Deno.env.get("CALCOM_WINDOW_DAYS") || 14);
    const MIN_SPREAD_HOURS = Number(Deno.env.get("CALCOM_MIN_SPREAD_HOURS") || 48);

    const earliestStart = new Date(Date.now() + MIN_LEAD_HOURS * 3600000);
    let startDate = earliestStart;
    if (start_after) {
      const sa = new Date(start_after);
      if (!isNaN(sa.getTime()) && sa.getTime() > startDate.getTime()) startDate = sa;
    }
    let endDate: Date;
    if (end_before) {
      const eb = new Date(end_before);
      endDate = !isNaN(eb.getTime()) && eb.getTime() > startDate.getTime()
        ? eb
        : new Date(startDate.getTime() + DEFAULT_WINDOW_DAYS * 86400000);
    } else {
      endDate = new Date(startDate.getTime() + DEFAULT_WINDOW_DAYS * 86400000);
    }
    console.log(`Slot window: ${startDate.toISOString()} → ${endDate.toISOString()} (min lead ${MIN_LEAD_HOURS}h, spread ${MIN_SPREAD_HOURS}h)`);

    const slotsUrl = new URL("https://api.cal.com/v2/slots");
    slotsUrl.searchParams.set("eventTypeId", String(eventTypeId));
    slotsUrl.searchParams.set("start", startDate.toISOString());
    slotsUrl.searchParams.set("end", endDate.toISOString());

    const slotsRes = await fetch(slotsUrl.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${CALCOM_API_KEY}`,
        "cal-api-version": CALCOM_SLOTS_API_VERSION,
      },
    });

    if (!slotsRes.ok) {
      const errText = await slotsRes.text();
      console.error("Cal.com API error:", errText);
      throw new Error(`Cal.com API error: ${slotsRes.status}`);
    }

    const slotsJson = await slotsRes.json();
    const slotsData = slotsJson.data || {};

    // If check_datetime is provided, verify availability of that specific time
    if (check_datetime) {
      const requestedTime = new Date(check_datetime).getTime();
      const TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

      let matchedSlot: string | null = null;
      for (const date of Object.keys(slotsData)) {
        for (const slot of slotsData[date]) {
          const slotTime = new Date(slot.start).getTime();
          if (Math.abs(slotTime - requestedTime) <= TOLERANCE_MS) {
            matchedSlot = slot.start;
            break;
          }
        }
        if (matchedSlot) break;
      }

      if (matchedSlot) {
        // Dedupe: if a hold already exists for this exact slot, reuse it.
        const dupHold = findExistingHold(matchedSlot);
        if (dupHold) {
          console.log("Reusing existing hold for", matchedSlot);
          return new Response(JSON.stringify({
            success: true,
            available: true,
            exact_slot: matchedSlot,
            slots: [dupHold],
            deduped: true,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Available — reserve just this one slot
        let reservationUid = "";
        try {
          const reserveRes = await fetch("https://api.cal.com/v2/slots/reservations", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${CALCOM_API_KEY}`,
              "cal-api-version": CALCOM_SLOTS_API_VERSION,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              eventTypeId: eventTypeId,
              slotStart: matchedSlot,
              reservationDuration: 120,
            }),
          });
          if (reserveRes.ok) {
            const reserveData = await reserveRes.json();
            reservationUid = reserveData.data?.reservationUid || reserveData.data?.uid || "";
          }
        } catch (e) {
          console.error("Reserve single slot error:", e);
        }

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 2);

        const { data: insertedHolds, error: insertError } = await supabase
          .from("slot_holds")
          .insert([{
            company_id,
            lead_id,
            enrollment_id: enrollment_id || null,
            conversation_id: conversation_id || null,
            slot_datetime: matchedSlot,
            status: "held",
            expires_at: expiresAt.toISOString(),
            preferred_channel: preferred_channel || null,
            cal_booking_uid: reservationUid || null,
          }])
          .select();

        if (insertError) throw insertError;

        return new Response(JSON.stringify({
          success: true,
          available: true,
          exact_slot: matchedSlot,
          slots: insertedHolds,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } else {
        // Not available — pick 2 alternatives spread apart, anchored to the
        // requested window. If nothing fits, expand the window by +14 days
        // and refetch once before giving up.
        let workingSlotsData = slotsData;
        let selectedSlots = pickSpreadSlots(workingSlotsData, excludeSet, MIN_SPREAD_HOURS, excludeDateSet);

        if (selectedSlots.length === 0) {
          const expandedEnd = new Date(endDate.getTime() + 14 * 86400000);
          console.log(`No alternatives in window — expanding end to ${expandedEnd.toISOString()}`);
          const expandedUrl = new URL("https://api.cal.com/v2/slots");
          expandedUrl.searchParams.set("eventTypeId", String(eventTypeId));
          expandedUrl.searchParams.set("start", startDate.toISOString());
          expandedUrl.searchParams.set("end", expandedEnd.toISOString());
          try {
            const r = await fetch(expandedUrl.toString(), {
              method: "GET",
              headers: {
                "Authorization": `Bearer ${CALCOM_API_KEY}`,
                "cal-api-version": CALCOM_SLOTS_API_VERSION,
              },
            });
            if (r.ok) {
              const j = await r.json();
              workingSlotsData = j.data || {};
              selectedSlots = pickSpreadSlots(workingSlotsData, excludeSet, MIN_SPREAD_HOURS, excludeDateSet);
            }
          } catch (e) {
            console.error("Expanded fetch error:", e);
          }
        }

        // Reserve alternatives
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 2);
        const holdsToInsert = [];
        for (const s of selectedSlots) {
          let uid = "";
          try {
            const rRes = await fetch("https://api.cal.com/v2/slots/reservations", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${CALCOM_API_KEY}`,
                "cal-api-version": CALCOM_SLOTS_API_VERSION,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ eventTypeId, slotStart: s.start, reservationDuration: 120 }),
            });
            if (rRes.ok) { const d = await rRes.json(); uid = d.data?.reservationUid || d.data?.uid || ""; }
          } catch (_) { /* skip */ }
          holdsToInsert.push({
            company_id, lead_id,
            enrollment_id: enrollment_id || null,
            conversation_id: conversation_id || null,
            slot_datetime: s.start, status: "held",
            expires_at: expiresAt.toISOString(),
            preferred_channel: preferred_channel || null,
            cal_booking_uid: uid || null,
          });
        }

        if (holdsToInsert.length > 0) {
          await supabase.from("slot_holds").insert(holdsToInsert).select();
        }

        const formattedSlots = selectedSlots.map(s => formatBRTLong(s.start));

        return new Response(JSON.stringify({
          success: true,
          available: false,
          requested: check_datetime,
          formatted: formattedSlots,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Normal flow: Pick 2 slots on different days spread apart
    const selectedSlots = pickSpreadSlots(slotsData, excludeSet, MIN_SPREAD_HOURS, excludeDateSet);

    if (selectedSlots.length < 1) {
      return new Response(JSON.stringify({
        error: "Não há slots disponíveis na janela solicitada",
        available_count: 0,
        window: { start: startDate.toISOString(), end: endDate.toISOString() },
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Reserve each slot via Cal.com v2
    const reservationUids: string[] = [];
    for (const slot of selectedSlots) {
      try {
        const reserveRes = await fetch("https://api.cal.com/v2/slots/reservations", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${CALCOM_API_KEY}`,
            "cal-api-version": CALCOM_SLOTS_API_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            eventTypeId: eventTypeId,
            slotStart: slot.start,
            slotEnd: undefined, // Cal.com calculates based on event type duration
            reservationDuration: 120, // 2 hours hold
          }),
        });

        if (reserveRes.ok) {
          const reserveData = await reserveRes.json();
          reservationUids.push(reserveData.data?.reservationUid || reserveData.data?.uid || "");
          console.log("Slot reserved:", slot.start, reserveData.data);
        } else {
          const errText = await reserveRes.text();
          console.error("Failed to reserve slot:", slot.start, errText);
          reservationUids.push("");
        }
      } catch (e) {
        console.error("Reserve slot error:", e);
        reservationUids.push("");
      }
    }

    // Save holds in the database
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2);

    const holdsToInsert = selectedSlots.map((s, i) => ({
      company_id,
      lead_id,
      enrollment_id: enrollment_id || null,
      conversation_id: conversation_id || null,
      slot_datetime: s.start,
      status: "held",
      expires_at: expiresAt.toISOString(),
      preferred_channel: preferred_channel || null,
      cal_booking_uid: reservationUids[i] || null,
    }));

    const { data: insertedHolds, error: insertError } = await supabase
      .from("slot_holds")
      .insert(holdsToInsert)
      .select();

    if (insertError) throw insertError;

    // Format slots for display in messages (America/Sao_Paulo)
    const formattedSlots = selectedSlots.map(s => formatBRTLong(s.start));

    return new Response(JSON.stringify({
      success: true,
      slots: insertedHolds,
      formatted: formattedSlots,
      expires_at: expiresAt.toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("calcom-slots error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
