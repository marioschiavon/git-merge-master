// State machine for the SDR agent (Phase 3).
// Pure functions that compute structured state from context.
// The state is injected into the system prompt every turn and drives
// `allowed_actions` + `finalize_allowed` — calculated in code, not inferred
// by the model.

export type ConversationStage =
  | "awaiting_first_reply"
  | "qualification"
  | "product_qna"
  | "scheduling_request"
  | "scheduling_waiting_confirmation"
  | "scheduling_confirming_now"
  | "reschedule_request"
  | "cancel_request"
  | "booking_confirmed"
  | "referral_provided"
  | "closed_lost"
  | "general";

export type AllowedAction =
  | "search_knowledge"
  | "list_knowledge"
  | "read_knowledge_item"
  | "check_calendar"
  | "update_lead_facts"
  | "book_slot"
  | "reschedule_booking"
  | "cancel_booking"
  | "finalize";

export interface StructuredState {
  conversation_stage: ConversationStage;
  current_intent: { category: string | null; sub_intent: string | null };
  timezone: string;
  offered_slots: string[];
  selected_slot: string | null;
  active_booking: { uid: string; scheduled_at: string; status: string } | null;
  pending_action: string | null;
  allowed_actions: AllowedAction[];
  finalize_allowed: boolean;
  confirmation_status: "explicit" | "ambiguous" | "none";
  date_preference: { start_after?: string; end_before?: string; raw?: string } | null;
}

const SCHEDULING_INTENTS = new Set([
  "wants_to_schedule", "wants_meeting", "asks_availability",
  "wants_to_book", "schedule_request",
]);
const RESCHEDULE_INTENTS = new Set([
  "reschedule_request", "wants_to_reschedule", "change_time",
]);
const CANCEL_INTENTS = new Set([
  "cancel_request", "cancel_meeting", "wants_to_cancel",
]);
const QNA_INTENTS = new Set([
  "product_question", "pricing", "how_it_works", "objection",
  "asks_features", "asks_integrations",
]);
const REFERRAL_INTENTS = new Set(["provides_referral", "refers_someone"]);
const CLOSED_INTENTS = new Set(["not_interested", "unsubscribe"]);

export interface StateInputs {
  hasInbound: boolean;
  lastInbound: string;
  lastIntent: { category?: string | null; sub_intent?: string | null } | null;
  factsOfferedSlotsPending: { slots?: string[]; offered_at?: string } | null;
  heldSlots: Array<{ slot_datetime: string; status: string }>;
  activeBookings: Array<{ calcom_booking_uid: string; scheduled_at: string; status: string }>;
  datePreference: { start_after?: string; end_before?: string; raw?: string } | null;
  /** Match function from caller (reuses sdr-agent's matchesSlotReference). */
  matchesSlotRef: (text: string, isos: string[]) => { iso: string | null; ambiguous: boolean };
  /** Pure heuristic for explicit confirmation (reuses sdr-agent's isLikelyConfirmation). */
  isLikelyConfirmation: (text: string) => boolean;
}

export function computeState(inputs: StateInputs): StructuredState {
  const tz = "America/Sao_Paulo";
  const cat = inputs.lastIntent?.category ?? null;
  const sub = inputs.lastIntent?.sub_intent ?? null;

  // Fresh offered slots (≤30 min).
  const pendingFresh = inputs.factsOfferedSlotsPending?.offered_at
    ? Date.now() - new Date(inputs.factsOfferedSlotsPending.offered_at).getTime() < 30 * 60_000
    : false;
  const offered_slots = (pendingFresh ? inputs.factsOfferedSlotsPending?.slots : null) ?? [];

  // Active booking (most recent).
  const ab = inputs.activeBookings.find((b) => b.status === "confirmed" || b.status === "pending");
  const active_booking = ab
    ? { uid: ab.calcom_booking_uid, scheduled_at: ab.scheduled_at, status: ab.status }
    : null;

  // Confirmation / selection detection on last inbound vs offered_slots.
  const candidates = offered_slots.length > 0
    ? offered_slots
    : inputs.heldSlots.filter((h) => h.status === "held").map((h) => h.slot_datetime);
  const ref = inputs.lastInbound && candidates.length > 0
    ? inputs.matchesSlotRef(inputs.lastInbound, candidates)
    : { iso: null, ambiguous: false };
  const explicit = inputs.lastInbound ? inputs.isLikelyConfirmation(inputs.lastInbound) : false;
  const selected_slot = ref.iso ?? (explicit && candidates.length === 1 ? candidates[0] : null);
  const confirmation_status: StructuredState["confirmation_status"] =
    ref.iso ? "explicit" : ref.ambiguous ? "ambiguous" : explicit ? "explicit" : "none";

  // Stage detection (priority order).
  let stage: ConversationStage;
  if (!inputs.hasInbound) {
    stage = "awaiting_first_reply";
  } else if (sub && CLOSED_INTENTS.has(sub)) {
    stage = "closed_lost";
  } else if (sub && REFERRAL_INTENTS.has(sub)) {
    stage = "referral_provided";
  } else if (sub && CANCEL_INTENTS.has(sub)) {
    stage = "cancel_request";
  } else if (sub && RESCHEDULE_INTENTS.has(sub) && active_booking) {
    stage = "reschedule_request";
  } else if (selected_slot && (offered_slots.length > 0 || candidates.length > 0)) {
    stage = "scheduling_confirming_now";
  } else if (offered_slots.length > 0) {
    stage = "scheduling_waiting_confirmation";
  } else if (sub && SCHEDULING_INTENTS.has(sub)) {
    stage = "scheduling_request";
  } else if ((sub && QNA_INTENTS.has(sub)) || cat === "objection" || cat === "qualification_qna") {
    stage = "product_qna";
  } else if (active_booking) {
    stage = "booking_confirmed";
  } else {
    stage = "general";
  }

  // Allowed actions + finalize_allowed by stage.
  const { allowed_actions, finalize_allowed, pending_action } = decideAllowed(stage, {
    has_offered: offered_slots.length > 0,
    has_selected: !!selected_slot,
    has_active_booking: !!active_booking,
    has_date_pref: !!inputs.datePreference,
  });

  return {
    conversation_stage: stage,
    current_intent: { category: cat, sub_intent: sub },
    timezone: tz,
    offered_slots,
    selected_slot,
    active_booking,
    pending_action,
    allowed_actions,
    finalize_allowed,
    confirmation_status,
    date_preference: inputs.datePreference,
  };
}

function decideAllowed(
  stage: ConversationStage,
  flags: { has_offered: boolean; has_selected: boolean; has_active_booking: boolean; has_date_pref: boolean },
): { allowed_actions: AllowedAction[]; finalize_allowed: boolean; pending_action: string | null } {
  const base: AllowedAction[] = ["update_lead_facts", "finalize"];
  switch (stage) {
    case "awaiting_first_reply":
      return { allowed_actions: ["search_knowledge", ...base], finalize_allowed: true, pending_action: null };

    case "product_qna":
      return {
        allowed_actions: ["search_knowledge", "list_knowledge", "read_knowledge_item", "check_calendar", "update_lead_facts", "finalize"],
        finalize_allowed: false, // exigir search_knowledge antes de finalize
        pending_action: "answer_with_kb",
      };

    case "scheduling_request":
      return {
        allowed_actions: ["check_calendar", "update_lead_facts", "finalize"],
        finalize_allowed: false, // exigir check_calendar antes de oferecer slots
        pending_action: "offer_slots",
      };

    case "scheduling_waiting_confirmation":
      return {
        allowed_actions: ["update_lead_facts", "finalize"],
        finalize_allowed: true,
        pending_action: "await_lead_choice",
      };

    case "scheduling_confirming_now":
      return {
        allowed_actions: ["book_slot", "update_lead_facts", "finalize"],
        finalize_allowed: false, // exigir book_slot antes de send_message confirmando
        pending_action: "book_then_confirm",
      };

    case "reschedule_request":
      if (flags.has_selected) {
        return {
          allowed_actions: ["reschedule_booking", "update_lead_facts", "finalize"],
          finalize_allowed: false,
          pending_action: "reschedule_then_confirm",
        };
      }
      return {
        allowed_actions: ["check_calendar", "update_lead_facts", "finalize"],
        finalize_allowed: false,
        pending_action: "offer_new_slots",
      };

    case "cancel_request":
      return {
        allowed_actions: ["cancel_booking", "update_lead_facts", "finalize"],
        finalize_allowed: false,
        pending_action: "cancel_then_confirm",
      };

    case "booking_confirmed":
      return {
        allowed_actions: ["search_knowledge", "update_lead_facts", "finalize"],
        finalize_allowed: true,
        pending_action: null,
      };

    case "referral_provided":
      // create_referral_lead tool não implementada ainda (Fase 2.3 futura).
      return { allowed_actions: ["update_lead_facts", "finalize"], finalize_allowed: true, pending_action: "register_referral" };

    case "closed_lost":
      return { allowed_actions: ["update_lead_facts", "finalize"], finalize_allowed: true, pending_action: null };

    case "qualification":
    case "general":
    default:
      return {
        allowed_actions: ["search_knowledge", "check_calendar", "update_lead_facts", "finalize"],
        finalize_allowed: true,
        pending_action: null,
      };
  }
}

export function renderStateBlock(state: StructuredState): string {
  return [
    "## Estado estruturado deste turno (calculado em código — NÃO infira)",
    "```json",
    JSON.stringify(state, null, 2),
    "```",
    "**Regras de estado:**",
    `- Tools permitidas neste turno: ${state.allowed_actions.join(", ")}.`,
    state.finalize_allowed
      ? "- `finalize` está LIBERADO."
      : `- \`finalize\` ESTÁ BLOQUEADO até que você chame a tool requerida pelo estado (${state.pending_action ?? "ver allowed_actions"}).`,
    state.pending_action ? `- Ação pendente: **${state.pending_action}**.` : "",
    state.selected_slot
      ? `- Lead apontou o slot: ${state.selected_slot} (confirmação=${state.confirmation_status}).`
      : "",
    state.offered_slots.length > 0 && !state.selected_slot
      ? `- ${state.offered_slots.length} slot(s) oferecido(s) aguardando escolha.`
      : "",
  ].filter(Boolean).join("\n");
}
