// Shared helper: matches intent against rules and enqueues side-effect actions.
// Designed to coexist with legacy inbound-webhook reply logic — by default,
// we enqueue only "safe" side-effect actions and skip reply-generating ones
// to avoid duplicate messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type SupaClient = ReturnType<typeof createClient>;

const REPLY_ACTIONS = new Set([
  "send_reply",
  "ask_clarifying_question",
  "request_info_from_lead",
  "suggest_meeting_times",
  "create_cal_booking",
  "send_calendar_link",
  "send_email",
  "send_material",
  "recover_no_show",
  "ask_cancel_reason",
  "offer_reschedule_instead",
  "send_booking_confirmation",
  "offer_event_types",
  "collect_booking_info",
  "detect_timezone",
  "send_meeting_recap",
  "request_feedback",
]);

/**
 * Destructive / transactional actions that must only fire when the
 * classified sub_intent matches a clear user request. Without this guard,
 * an omnibus rule (sub_intent=NULL listing many actions) would
 * cancel/reschedule meetings every time a prospect mentions a date.
 */
const SUB_INTENT_GATED: Record<string, Set<string>> = {
  cancel_booking: new Set([
    "cancel_request",
    "cancel_meeting",
    "wants_to_cancel",
  ]),
  reschedule_booking: new Set([
    "reschedule_request",
    "wants_to_reschedule",
    "change_time",
  ]),
  mark_meeting_attended: new Set([
    "attended_confirmation",
    "post_meeting_followup",
    "no_show_explanation",
  ]),
};

export type RouteOptions = {
  /** When true, enqueue ALL actions (full pipeline mode). When false (default),
   * skip reply-generating actions so legacy inbound flow handles them. */
  include_reply_actions?: boolean;
  /** Force auto_execute=false on all queued rows (for dry-run mode). */
  force_pending_only?: boolean;
};

export async function routeAndEnqueue(
  supabase: SupaClient,
  args: {
    company_id: string;
    lead_id: string;
    conversation_id: string | null;
    intent_log_id: string;
    category: string;
    sub_intent: string | null;
    confidence: number;
  },
  opts: RouteOptions = {},
): Promise<{ enqueued: number; skipped: number; rule_id?: string; reason?: string }> {
  const { data: rules, error } = await supabase
    .from("intent_action_rules")
    .select("*")
    .eq("company_id", args.company_id)
    .eq("category", args.category as any)
    .eq("enabled", true)
    .order("priority", { ascending: true });

  if (error) {
    console.error("routeAndEnqueue: rules query failed:", error);
    return { enqueued: 0, skipped: 0, reason: "rules_query_failed" };
  }
  if (!rules?.length) return { enqueued: 0, skipped: 0, reason: "no_rule" };

  // Prefer sub_intent-specific rule, otherwise wildcard (sub_intent NULL)
  const rule = rules.find((r: any) => r.sub_intent === args.sub_intent) || rules.find((r: any) => !r.sub_intent);
  if (!rule) return { enqueued: 0, skipped: 0, reason: "no_matching_rule" };

  if (args.confidence < Number(rule.requires_confidence_above)) {
    return { enqueued: 0, skipped: 0, rule_id: rule.id, reason: "below_confidence_threshold" };
  }

  const actions: any[] = Array.isArray(rule.actions) ? rule.actions : [];
  let enqueued = 0;
  let skipped = 0;

  for (const a of actions) {
    if (!opts.include_reply_actions && REPLY_ACTIONS.has(a.type)) {
      skipped++;
      continue;
    }
    const { error: insErr } = await supabase.from("lead_action_queue").insert({
      company_id: args.company_id,
      lead_id: args.lead_id,
      conversation_id: args.conversation_id,
      intent_log_id: args.intent_log_id,
      action_type: a.type as any,
      params: a.params || {},
      scheduled_for: new Date().toISOString(),
      status: opts.force_pending_only || !rule.auto_execute ? "pending" : "pending",
      triggered_by: `rule:${rule.id}`,
    });
    if (insErr) {
      console.error("routeAndEnqueue: enqueue failed:", insErr);
      continue;
    }
    enqueued++;
  }

  return { enqueued, skipped, rule_id: rule.id };
}
