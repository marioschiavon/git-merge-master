/** Lowercase + remove accents + collapse punctuation/whitespace for robust PT-BR matching. */
export function normalizePtText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MEETING_TERMS = "reuniao|call|conversa|apresentacao|encontro|papo|meet|demo|videochamada|ligacao";

export const CLARIFYING_PATTERNS = {
  duration: new RegExp(
    `\\b(` +
      `quanto\\s+tempo|quanto\\s+(vai\\s+)?dura|quanto\\s+dura|qual\\s+(a\\s+)?duracao|` +
      `duracao\\s+(da|de|do)\\s+(${MEETING_TERMS})|` +
      `tempo\\s+(de|da|do|pra|para|na|e\\s+de|e\\s+da)\\s+(${MEETING_TERMS})|` +
      `(${MEETING_TERMS})\\s+(dura|demora|leva|e\\s+rapida|e\\s+rapido|longa|curta|rapida|rapido)|` +
      `vai\\s+demorar|demora\\s+muito|leva\\s+quanto|dura\\s+quanto|e\\s+rapid|quantos?\\s+minutos` +
    `)\\b`,
  ),
  format: new RegExp(
    `\\b(` +
      `e\\s+(online|presencial|por\\s+video|por\\s+telefone|remota)|` +
      `formato\\s+(da|de|do)\\s+(${MEETING_TERMS})|onde\\s+(vai\\s+)?ser|por\\s+onde\\s+(vai\\s+)?ser|` +
      `google\\s+meet|zoom|teams|link\\s+(da|de|do)\\s+(${MEETING_TERMS})` +
    `)\\b`,
  ),
  attendees: /\b(quem\s+(vai\s+)?(participa|participar|estara|vai\s+estar|estarah)|quem\s+(e|sao)\s+o(s)?\s+(participante|convidado)|quem\s+mais\s+(vai|estara|participa))\b/,
  objective: /\b(qual\s+(o\s+)?(objetivo|assunto|pauta|tema)|sobre\s+o\s+que\s+(vai\s+)?ser|o\s+que\s+(vai\s+)?ser\s+tratado|pra\s+que\s+(e|serve)|qual\s+a\s+ideia)\b/,
} as const;

export type ClarifyingKind = keyof typeof CLARIFYING_PATTERNS;

export function detectMeetingClarifier(text: string): ClarifyingKind | null {
  const norm = normalizePtText(text);
  for (const [kind, pattern] of Object.entries(CLARIFYING_PATTERNS)) {
    if (pattern.test(norm)) return kind as ClarifyingKind;
  }
  return null;
}

export function meetingClarifierSubIntent(kind: ClarifyingKind): string {
  if (kind === "duration") return "asks_duration";
  if (kind === "format") return "asks_format";
  if (kind === "attendees") return "asks_attendees";
  return "asks_objective";
}

export function clarifyingReplyFor(kind: ClarifyingKind, meetingMinutes: number | null): string {
  if (kind === "duration") {
    return meetingMinutes
      ? `É uma apresentação rápida, em torno de ${meetingMinutes} minutos.`
      : "É uma apresentação rápida, bem objetiva.";
  }
  if (kind === "format") return "É online, por videochamada. Te envio o link junto com a confirmação.";
  if (kind === "attendees") return "Sou eu que conduzo a conversa inicial. Se fizer sentido, trazemos mais alguém do time depois.";
  return "Quero entender melhor seu contexto e te mostrar como podemos ajudar — bem direto ao ponto.";
}