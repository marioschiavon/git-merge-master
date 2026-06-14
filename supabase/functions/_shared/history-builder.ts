// Builds the AI Gateway `messages[]` array using native chat roles
// (`user`, `assistant`, `system`) instead of serializing the whole transcript
// into a single user-message blob.
//
// Why: when the past SDR turns are squashed into one user message, the model
// treats them as if "the lead said all of this", and tends to re-offer slots
// it already proposed verbally because it has no anchor that *it* was the one
// who spoke. With native roles the model sees the conversation as a real
// dialog and respects its own prior turns.
//
// We still inject a short structured `system` block summarizing
// scheduling state, knowledge base, lead memory etc. — that comes from
// `buildSystemPrompt` in sdr-agent.

import type { ChatMessage } from "./ai-gateway.ts";

export interface TranscriptMessage {
  direction: string;
  content: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  channel?: string | null;
}

function fmtBrtShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * Convert stored conversation messages into native ChatMessage[] for the LLM.
 *
 * - inbound  → role: "user"
 * - outbound → role: "assistant"
 * - other    → role: "system" (rare; system events about booking lifecycle)
 *
 * Empty content is dropped so we don't send blank turns to the gateway.
 * Each message is prefixed with the BRT timestamp so the model has temporal
 * anchors without needing a separate metadata channel.
 */
export function buildNativeHistory(messages: TranscriptMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const content = String(m.content ?? "").trim();
    if (!content) continue;
    const when = fmtBrtShort(m.created_at);
    const ch = m.channel ? ` ${m.channel}` : "";

    if (m.direction === "outbound") {
      // Assistant turn = something the SDR previously sent.
      out.push({
        role: "assistant",
        content: `[${when}${ch}] ${content}`,
      });
    } else if (m.direction === "inbound") {
      // User turn = the lead's reply.
      out.push({
        role: "user",
        content: `[${when}${ch}] ${content}`,
      });
    } else {
      // System events (booking confirmation marks, internal notes, etc.)
      // We append as `system` so they don't pollute the assistant track.
      out.push({
        role: "system",
        content: `[${when}${ch} sistema] ${content}`,
      });
    }
  }
  return out;
}
