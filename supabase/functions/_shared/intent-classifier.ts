// Semantic intent classifier for SDR agent (Phase 4 — policy-first pipeline).
// Calls Gemini Flash with a closed taxonomy and JSON output. NEVER decides actions —
// only labels the intent so the Policy Engine can route deterministically.

import { chatCompletion, type ChatMessage } from "./ai-gateway.ts";

export type Intent =
  | "create_booking"      // lead pede para agendar (sem booking ativo)
  | "reschedule_booking"  // lead pede para mudar / não consegue mais
  | "cancel_booking"      // lead quer desmarcar sem oferecer novo
  | "confirm_slot"        // lead aponta UM dos horários oferecidos
  | "ask_availability"    // lead pergunta horários / janela
  | "product_qna"         // dúvida sobre produto/preço/processo
  | "objection"           // resistência / preocupação
  | "referral"            // indica outra pessoa
  | "not_interested"      // descarte explícito
  | "smalltalk"           // saudação / agradecimento sem ação
  | "other";

export interface IntentResult {
  intent: Intent;
  confidence: number; // 0..1
  reasoning: string;
  raw: unknown;
}

const CLASSIFIER_MODEL = "google/gemini-2.5-flash";

const SYSTEM_PROMPT = `Você é um classificador de intenção de mensagens recebidas por um SDR de IA em pt-BR.
Devolva APENAS JSON no formato:
{"intent":"<um_dos_valores>","confidence":<0..1>,"reasoning":"<curto>"}

Taxonomia FECHADA:
- create_booking: lead pede para agendar uma reunião e NÃO existe reserva ativa.
- reschedule_booking: lead pede para mudar/trocar/antecipar/adiar horário, ou diz que NÃO CONSEGUE MAIS no horário marcado (mesmo sem palavra "remarcar"). Use sempre que houver reserva ativa E a mensagem indicar mudança.
- cancel_booking: lead quer desmarcar SEM pedir novo horário (ex.: "cancela", "desisti", "não quero mais").
- confirm_slot: lead aponta UM dos horários já oferecidos pelo SDR (ex.: "dia 18", "o primeiro", "às 17h", "esse mesmo", "confirmo"). USE este intent quando houver slots oferecidos pendentes E a mensagem referenciar dia/hora/posição.
- ask_availability: lead pergunta horários/disponibilidade SEM apontar opção específica (ex.: "tem na quinta?", "manhã da semana que vem?").
- product_qna: dúvida sobre produto, preço, prazo, integração, política.
- objection: resistência ("tá caro", "não tenho time", "preciso pensar").
- referral: lead indica outra pessoa OU sinaliza que não é o interlocutor certo. Inclui: "não sou eu", "não é comigo", "não seria comigo", "esse assunto não é comigo", "quem cuida disso é o(a) X", "fala com X", "procura o financeiro", "sou só o assistente". MESMO sem contato/nome ainda — é referral (precisamos PEDIR o contato), NÃO not_interested.
- not_interested: recusa do PRODUTO/empresa ("não tenho interesse", "não precisamos", "para de me mandar mensagem", "não quero mais receber"). NÃO confundir com redirecionamento de interlocutor — se o lead só disse que não é com ele, classifique como referral.
- smalltalk: saudação, agradecimento, conversa sem ação clara.
- other: qualquer outra coisa.

Regras:
- Se a mensagem é AMBÍGUA entre 2 intents, escolha o de maior risco operacional (reschedule > create > confirm > ask) e devolva confidence ≤ 0.6.
- "Dia X" / "às Xh" / ordinal SEM contexto de slots oferecidos = ask_availability (não confirm_slot).
- "Pode ser" / "confirmo" sozinho = confirm_slot SE houver slots pendentes; senão smalltalk.
- Considere o estado fornecido (active_booking, offered_slots) para desambiguar.`;

export async function classifyIntent(args: {
  lastInbound: string;
  recentHistory: Array<{ direction: string; content: string }>;
  state: {
    hasActiveBooking: boolean;
    activeBookingAt: string | null;
    offeredSlots: string[];
  };
}): Promise<IntentResult> {
  const inbound = (args.lastInbound || "").trim();
  if (!inbound) {
    return { intent: "other", confidence: 0, reasoning: "empty inbound", raw: null };
  }

  // Fast-path determinístico: "não sou eu / não é comigo / quem cuida disso é / fala com X"
  // → referral, mesmo sem contato ainda. Evita o erro recorrente do LLM rotular como not_interested.
  if (REDIRECT_RE.test(inbound)) {
    return {
      intent: "referral",
      confidence: 0.9,
      reasoning: "deterministic: redirect signal (não sou eu / quem cuida / fala com)",
      raw: { fast_path: "redirect" },
    };
  }

  // Pequena janela de contexto: últimas 4 mensagens.
  const tail = args.recentHistory.slice(-4)
    .map((m) => `${m.direction === "inbound" ? "LEAD" : "SDR"}: ${(m.content || "").slice(0, 240)}`)
    .join("\n");

  const stateBlock = JSON.stringify({
    has_active_booking: args.state.hasActiveBooking,
    active_booking_at: args.state.activeBookingAt,
    offered_slots_count: args.state.offeredSlots.length,
    offered_slots: args.state.offeredSlots.slice(0, 4),
  });

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Estado: ${stateBlock}\n` +
        `Últimas trocas:\n${tail}\n\n` +
        `Mensagem atual do LEAD (classificar):\n"""${inbound}"""\n\n` +
        `Responda APENAS o JSON.`,
    },
  ];

  try {
    const res = await chatCompletion({
      model: CLASSIFIER_MODEL,
      messages,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const txt = typeof raw === "string" ? raw : JSON.stringify(raw);
    const parsed = JSON.parse(txt);
    const intent = normalizeIntent(parsed.intent);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
    return {
      intent,
      confidence,
      reasoning: String(parsed.reasoning ?? ""),
      raw: parsed,
    };
  } catch (e) {
    console.error("intent-classifier failed:", e);
    return { intent: "other", confidence: 0, reasoning: `error: ${String(e)}`, raw: null };
  }
}

function normalizeIntent(x: unknown): Intent {
  const s = String(x ?? "").toLowerCase().trim();
  const allowed: Intent[] = [
    "create_booking", "reschedule_booking", "cancel_booking", "confirm_slot",
    "ask_availability", "product_qna", "objection", "referral",
    "not_interested", "smalltalk", "other",
  ];
  return (allowed as string[]).includes(s) ? (s as Intent) : "other";
}
