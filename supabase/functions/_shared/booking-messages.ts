// Insert a system message in the lead's conversation for booking lifecycle events.

export type BookingEventType =
  | "booking_created"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "booking_no_show"
  | "booking_completed";

import { formatBRTLong } from "./datetime.ts";

const formatBRT = formatBRTLong;

function buildContent(event: BookingEventType, scheduled_at?: string | null, previous?: string | null) {
  switch (event) {
    case "booking_created":
      return scheduled_at
        ? `📅 Reunião confirmada para ${formatBRT(scheduled_at)}`
        : `📅 Reunião confirmada`;
    case "booking_rescheduled":
      return scheduled_at && previous
        ? `🔄 Reunião remarcada para ${formatBRT(scheduled_at)} (antes: ${formatBRT(previous)})`
        : scheduled_at
        ? `🔄 Reunião remarcada para ${formatBRT(scheduled_at)}`
        : `🔄 Reunião remarcada`;
    case "booking_cancelled":
      return scheduled_at
        ? `❌ Reunião cancelada (era ${formatBRT(scheduled_at)})`
        : `❌ Reunião cancelada`;
    case "booking_no_show":
      return scheduled_at
        ? `⚠️ Lead não compareceu (${formatBRT(scheduled_at)})`
        : `⚠️ Lead não compareceu`;
    case "booking_completed":
      return scheduled_at
        ? `✔️ Reunião concluída (${formatBRT(scheduled_at)})`
        : `✔️ Reunião concluída`;
  }
}

export async function insertBookingSystemMessage(
  supabase: any,
  params: {
    lead_id: string;
    company_id: string;
    event_type: BookingEventType;
    booking_uid?: string | null;
    scheduled_at?: string | null;
    previous_scheduled_at?: string | null;
    channel_fallback?: string;
  }
) {
  const { lead_id, company_id, event_type, booking_uid, scheduled_at, previous_scheduled_at } = params;

  // Find most recent conversation for this lead
  const { data: existingConv } = await supabase
    .from("conversations")
    .select("id")
    .eq("lead_id", lead_id)
    .eq("company_id", company_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversation_id = existingConv?.id;

  if (!conversation_id) {
    // Create one using lead's preferred channel
    const { data: lead } = await supabase
      .from("leads")
      .select("preferred_channel")
      .eq("id", lead_id)
      .maybeSingle();
    const channel = lead?.preferred_channel || params.channel_fallback || "whatsapp";
    const { data: created, error: convErr } = await supabase
      .from("conversations")
      .insert({ lead_id, company_id, channel })
      .select("id")
      .single();
    if (convErr) {
      console.error("insertBookingSystemMessage: failed to create conversation", convErr);
      return null;
    }
    conversation_id = created.id;
  }

  const content = buildContent(event_type, scheduled_at, previous_scheduled_at);

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id,
      direction: "system",
      content,
      metadata: {
        event_type,
        booking_uid: booking_uid || null,
        scheduled_at: scheduled_at || null,
        previous_scheduled_at: previous_scheduled_at || null,
      },
    })
    .select()
    .single();

  if (error) {
    console.error("insertBookingSystemMessage: failed to insert message", error);
    return null;
  }
  return data;
}
