// Policy Engine (Phase 4) — PURE decision function. No I/O, no LLM.
// Takes the classified intent + extracted entities + current state and decides:
//  - which conversation stage we are in
//  - which tools the LLM is allowed to call this turn
//  - whether to force a specific tool (skip LLM "routing" entirely)
//  - a short directive injected into the system prompt
//
// Tested in isolation; no fetch/db dependencies.

import type { Intent } from "./intent-classifier.ts";

export type Tool =
  | "search_knowledge"
  | "list_knowledge"
  | "read_knowledge_item"
  | "check_calendar"
  | "update_lead_facts"
  | "book_slot"
  | "reschedule_booking"
  | "cancel_booking"
  | "create_new_contact"
  | "mark_referrer"
  | "finalize";

export type Stage =
  | "qualification"
  | "product_qna"
  | "scheduling_request"
  | "scheduling_clarify"
  | "scheduling_confirming_now"
  | "reschedule_request"
  | "rescheduling_confirming_now"
  | "cancel_request"
  | "cancel_clarify"
  | "booking_confirmed"
  | "no_op_already_booked"
  | "referral_provided"
  | "closed_lost"
  | "general";

export type PostAction = "mark_referrer" | "release_slot_holds";

export interface PolicyDecision {
  stage: Stage;
  allowed_tools: Tool[];
  /** When set: the orchestrator executes this tool directly with `forced_args`
   *  and skips letting the LLM choose. The LLM is only invoked AFTER, to write
   *  the user-facing message (typically reusing `message_suggestion`). */
  forced_tool: Tool | null;
  forced_args: Record<string, unknown> | null;
  /** Deterministic side-effects the orchestrator should run AFTER forced_tool
   *  (and before the LLM writes the message). Examples: mark current lead as
   *  referrer, release dangling slot holds when the conversation closes. */
  post_actions?: PostAction[];
  /** Short directive injected at the top of the system prompt for this turn. */
  response_directive: string;
  reason: string;
}

const CONFIDENCE_FLOOR = 0.55;

export interface PolicyInputs {
  intent: Intent;
  confidence: number;
  entities: {
    selected_slot_iso: string | null;
    ambiguous_slot: boolean;
    date_preference: { start_after?: string; end_before?: string; raw?: string } | null;
    prefers_period: "morning" | "afternoon" | "evening" | null;
    referral_contact?: {
      name?: string;
      email?: string;
      phone?: string;
      permission_to_mention?: boolean;
    } | null;
  };
  state: {
    has_active_booking: boolean;
    active_booking_at: string | null;
    active_booking_uid: string | null;
    offered_slots: string[];   // slots oferecidos no turno anterior, ainda válidos
    held_slots: string[];       // holds ativos no banco
  };
}

export function decidePolicy(input: PolicyInputs): PolicyDecision {
  const { intent, confidence, entities, state } = input;
  const lowConf = confidence < CONFIDENCE_FLOOR;
  const candidates = Array.from(new Set([...state.offered_slots, ...state.held_slots]));

  // ── 1. Slot já apontado de forma inequívoca + booking ativo num horário DIFERENTE
  // Vale para QUALQUER intent (confirm_slot, create_booking, reschedule_booking…),
  // porque com booking ativo o caminho correto é SEMPRE reschedule — nunca book_slot.
  if (entities.selected_slot_iso && state.has_active_booking &&
      !slotsEqual(entities.selected_slot_iso, state.active_booking_at)) {
    return {
      stage: "rescheduling_confirming_now",
      allowed_tools: ["reschedule_booking", "finalize"],
      forced_tool: "reschedule_booking",
      forced_args: { slot_start: entities.selected_slot_iso },
      response_directive:
        `O lead tinha reserva ativa em ${state.active_booking_at} e escolheu ${entities.selected_slot_iso}. ` +
        `A tool reschedule_booking JÁ foi executada — escreva uma confirmação curta mencionando o novo horário. ` +
        `NÃO pergunte de novo se ele quer remarcar e NÃO chame book_slot.`,
      reason: "selected_slot_diverges_from_active_booking",
    };
  }

  // ── 2. Slot escolhido coincide com booking já confirmado → no-op
  if (entities.selected_slot_iso && state.has_active_booking &&
      slotsEqual(entities.selected_slot_iso, state.active_booking_at)) {
    return {
      stage: "no_op_already_booked",
      allowed_tools: ["finalize"],
      forced_tool: null,
      forced_args: null,
      response_directive:
        `O horário que o lead mencionou JÁ é o da reserva ativa (${state.active_booking_at}). ` +
        `Apenas reforce a confirmação — NÃO chame book_slot nem reschedule_booking.`,
      reason: "selected_slot_matches_active_booking",
    };
  }

  switch (intent) {
    // ── CONFIRM SLOT ──────────────────────────────────────────────
    case "confirm_slot": {
      if (entities.selected_slot_iso) {
        // Sem booking ativo: book_slot direto.
        if (!state.has_active_booking) {
          return {
            stage: "scheduling_confirming_now",
            allowed_tools: ["book_slot", "finalize"],
            forced_tool: "book_slot",
            forced_args: { slot_start: entities.selected_slot_iso },
            response_directive:
              `O lead confirmou ${entities.selected_slot_iso}. book_slot foi executada — ` +
              `escreva uma confirmação curta para o lead.`,
            reason: "confirm_slot_with_unique_selection",
          };
        }
        // Com booking ativo (caso já tratado acima); cai em rescheduling.
      }
      // Selecionou mas ambíguo, ou não conseguiu casar
      if (entities.ambiguous_slot || candidates.length > 1) {
        return {
          stage: "scheduling_clarify",
          allowed_tools: ["finalize"],
          forced_tool: null,
          forced_args: null,
          response_directive: buildClarifyDirective(candidates),
          reason: "confirm_slot_ambiguous",
        };
      }
      // Só uma opção pendente e o lead disse algo afirmativo
      if (candidates.length === 1) {
        const onlyIso = candidates[0];
        if (state.has_active_booking && !slotsEqual(onlyIso, state.active_booking_at)) {
          return {
            stage: "rescheduling_confirming_now",
            allowed_tools: ["reschedule_booking", "finalize"],
            forced_tool: "reschedule_booking",
            forced_args: { slot_start: onlyIso },
            response_directive: `Único slot pendente: ${onlyIso}. reschedule_booking executada — confirme ao lead.`,
            reason: "confirm_slot_single_candidate_reschedule",
          };
        }
        return {
          stage: "scheduling_confirming_now",
          allowed_tools: ["book_slot", "finalize"],
          forced_tool: "book_slot",
          forced_args: { slot_start: onlyIso },
          response_directive: `Único slot pendente: ${onlyIso}. book_slot executada — confirme ao lead.`,
          reason: "confirm_slot_single_candidate",
        };
      }
      // Nada pendente: caiu como confirm sem oferta — tratar como ask_availability
      return askAvailability(input, "confirm_without_candidates");
    }

    // ── RESCHEDULE ────────────────────────────────────────────────
    case "reschedule_booking": {
      if (!state.has_active_booking) {
        // Sem booking ativo, mas pede reagendar → tratar como create + clarify
        if (lowConf) return clarify("Posso confirmar: você quer marcar uma reunião comigo? Se sim, me diga uma janela que funciona pra você (dia/período).", "reschedule_without_booking_lowconf");
        return askAvailability(input, "reschedule_without_active_booking");
      }
      if (entities.selected_slot_iso) {
        return {
          stage: "rescheduling_confirming_now",
          allowed_tools: ["reschedule_booking", "finalize"],
          forced_tool: "reschedule_booking",
          forced_args: { slot_start: entities.selected_slot_iso },
          response_directive: `Reagendamento confirmado para ${entities.selected_slot_iso} — escreva mensagem curta.`,
          reason: "reschedule_with_explicit_slot",
        };
      }
      // Precisa novos horários — o LLM chama check_calendar.
      return {
        stage: "reschedule_request",
        allowed_tools: ["check_calendar", "update_lead_facts", "finalize"],
        forced_tool: null,
        forced_args: null,
        response_directive:
          `O lead quer REMARCAR a reserva ativa (${state.active_booking_at}). ` +
          (entities.date_preference
            ? `Use check_calendar com start_after=${entities.date_preference.start_after ?? "—"} / end_before=${entities.date_preference.end_before ?? "—"} e ofereça até 2 horários. NÃO chame book_slot — use reschedule_booking depois que o lead escolher.`
            : `Use check_calendar e ofereça até 2 horários. NÃO chame book_slot — use reschedule_booking depois que o lead escolher.`),
        reason: "reschedule_needs_new_slots",
      };
    }

    // ── CANCEL ────────────────────────────────────────────────────
    case "cancel_booking": {
      if (!state.has_active_booking) {
        return clarify(
          "Só pra confirmar: você quer cancelar alguma coisa específica? Não vejo uma reunião marcada aqui — me conta o que está acontecendo.",
          "cancel_without_booking",
        );
      }
      if (lowConf) {
        return clarify(
          `Você quer mesmo cancelar a reunião de ${state.active_booking_at}? Se preferir remarcar pra outro horário, me diz que eu ajusto.`,
          "cancel_low_confidence",
        );
      }
      return {
        stage: "cancel_request",
        allowed_tools: ["cancel_booking", "finalize"],
        forced_tool: "cancel_booking",
        forced_args: state.active_booking_uid ? { booking_uid: state.active_booking_uid } : {},
        response_directive: `Cancelamento executado. Escreva mensagem curta de despedida cordial, deixando porta aberta.`,
        reason: "cancel_with_active_booking",
      };
    }

    // ── CREATE BOOKING ────────────────────────────────────────────
    case "create_booking": {
      // Se já tem booking, é reagendar/no-op.
      if (state.has_active_booking) {
        return clarify(
          `Você já tem uma reunião marcada para ${state.active_booking_at}. ` +
          `Quer manter ou prefere trocar pra outro horário?`,
          "create_with_existing_booking",
        );
      }
      if (entities.selected_slot_iso) {
        return {
          stage: "scheduling_confirming_now",
          allowed_tools: ["book_slot", "finalize"],
          forced_tool: "book_slot",
          forced_args: { slot_start: entities.selected_slot_iso },
          response_directive: `Booking executado para ${entities.selected_slot_iso} — confirme ao lead.`,
          reason: "create_with_explicit_slot",
        };
      }
      return askAvailability(input, "create_needs_slots");
    }

    // ── ASK AVAILABILITY ──────────────────────────────────────────
    case "ask_availability":
      return askAvailability(input, "explicit_ask");

    // ── PRODUCT QNA / OBJECTION ──────────────────────────────────
    case "product_qna":
    case "objection":
      return {
        stage: "product_qna",
        allowed_tools: ["search_knowledge", "list_knowledge", "read_knowledge_item", "check_calendar", "update_lead_facts", "finalize"],
        forced_tool: null,
        forced_args: null,
        response_directive:
          intent === "objection"
            ? `Lead apresentou objeção. Use search_knowledge para fundamentar a resposta. Reconheça a preocupação, responda com dados, ofereça reunião sem pressionar.`
            : `Lead tem dúvida sobre produto. Use search_knowledge ANTES de afirmar fatos. Se a KB cobrir, responda direto; se não, combine highlights + value_proposition e convide para a reunião.`,
        reason: intent,
      };

    case "referral":
      return {
        stage: "referral_provided",
        allowed_tools: ["update_lead_facts", "finalize"],
        forced_tool: null,
        forced_args: null,
        response_directive: `Agradeça a indicação e pergunte se pode entrar em contato com o indicado mencionando o lead.`,
        reason: "referral",
      };

    case "not_interested":
      return {
        stage: "closed_lost",
        allowed_tools: ["update_lead_facts", "finalize"],
        forced_tool: null,
        forced_args: null,
        response_directive: `Reconheça com cordialidade, NÃO insista. Deixe porta aberta para o futuro em uma frase curta.`,
        reason: "not_interested",
      };

    case "smalltalk":
      return {
        stage: "general",
        allowed_tools: ["search_knowledge", "update_lead_facts", "finalize"],
        forced_tool: null,
        forced_args: null,
        response_directive: `Responda curto e natural. Se fizer sentido, puxe a conversa de volta para qualificar/agendar.`,
        reason: "smalltalk",
      };

    case "other":
    default:
      return {
        stage: "general",
        allowed_tools: ["search_knowledge", "check_calendar", "update_lead_facts", "finalize"],
        forced_tool: null,
        forced_args: null,
        response_directive: `Intent não classificada com clareza. Releia o histórico e responda de forma útil; se for dúvida, busque na KB; se for sobre agenda, use check_calendar.`,
        reason: "other_or_unclassified",
      };
  }
}

function askAvailability(input: PolicyInputs, why: string): PolicyDecision {
  const dp = input.entities.date_preference;
  return {
    stage: "scheduling_request",
    allowed_tools: ["check_calendar", "update_lead_facts", "finalize"],
    forced_tool: null,
    forced_args: null,
    response_directive:
      `O lead quer agendar. Use check_calendar agora ` +
      (dp ? `com start_after=${dp.start_after ?? "—"} / end_before=${dp.end_before ?? "—"} ` : "") +
      `e finalize com decision=offer_slots oferecendo NO MÁXIMO 2 horários. ` +
      (input.entities.prefers_period
        ? `Priorize ${labelPeriod(input.entities.prefers_period)}.`
        : ""),
    reason: why,
  };
}

function clarify(message: string, why: string): PolicyDecision {
  return {
    stage: "scheduling_clarify",
    allowed_tools: ["finalize"],
    forced_tool: null,
    forced_args: null,
    response_directive:
      `Peça esclarecimento ao lead com esta mensagem (ou uma variação curta e natural): "${message}". ` +
      `NÃO chame nenhuma tool de booking neste turno.`,
    reason: why,
  };
}

function buildClarifyDirective(candidates: string[]): string {
  if (candidates.length === 0) {
    return `A mensagem do lead é ambígua. Peça uma data/hora específica.`;
  }
  return (
    `A mensagem do lead aponta de forma ambígua entre os horários ATIVOS: ${candidates.join(", ")}. ` +
    `Peça que escolha referenciando dia E hora explicitamente. NÃO chame book_slot/reschedule_booking.`
  );
}

function slotsEqual(a: string | null, b: string | null, toleranceMs = 60_000): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (isNaN(ta) || isNaN(tb)) return false;
  return Math.abs(ta - tb) < toleranceMs;
}

function labelPeriod(p: "morning" | "afternoon" | "evening"): string {
  return p === "morning" ? "manhã" : p === "afternoon" ? "tarde" : "noite";
}

export function renderPolicyBlock(d: PolicyDecision): string {
  return [
    "## ⚙️ Política deste turno (decidida em código — siga à risca)",
    `- Stage: **${d.stage}**`,
    `- Tools permitidas: ${d.allowed_tools.join(", ")}`,
    d.forced_tool
      ? `- Tool FORÇADA: ${d.forced_tool} já foi executada antes da sua resposta. Você só precisa escrever a mensagem final ao lead.`
      : `- Nenhuma tool forçada — você decide qual chamar dentro das permitidas.`,
    `- Diretriz: ${d.response_directive}`,
  ].join("\n");
}
