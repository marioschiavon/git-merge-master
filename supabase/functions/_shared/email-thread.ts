// Helper para responder dentro da mesma thread de email.
// Lê a última mensagem da conversa para devolver os headers de reply (In-Reply-To,
// References), o threadId do Gmail e um subject "Re: …" já normalizado.

export interface EmailReplyContext {
  in_reply_to_rfc_id: string | null;
  references: string | null;
  gmail_thread_id: string | null;
  reply_subject: string | null;
}

const EMPTY: EmailReplyContext = {
  in_reply_to_rfc_id: null,
  references: null,
  gmail_thread_id: null,
  reply_subject: null,
};

function normalizeReplySubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const trimmed = subject.trim();
  if (!trimmed) return null;
  // Evita duplicar "Re:" — aceita "Re:", "RE:", "Res:", "Re :".
  if (/^re\s*:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

export async function getEmailReplyContext(
  supabase: any,
  conversationId: string | null | undefined,
): Promise<EmailReplyContext> {
  if (!conversationId) return EMPTY;
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("rfc_message_id, gmail_thread_id, metadata, direction, created_at")
      .eq("conversation_id", conversationId)
      .not("rfc_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return EMPTY;

    const meta = (data.metadata || {}) as Record<string, any>;
    const subject: string | null = meta.subject || null;
    const prevReferences: string | null = meta.references || null;

    // References = cadeia anterior (se houver) + último Message-ID.
    const refs = prevReferences
      ? `${prevReferences} ${data.rfc_message_id}`.trim()
      : data.rfc_message_id;

    return {
      in_reply_to_rfc_id: data.rfc_message_id,
      references: refs,
      gmail_thread_id: data.gmail_thread_id || null,
      reply_subject: normalizeReplySubject(subject),
    };
  } catch (e) {
    console.error("[email-thread] getEmailReplyContext error:", e);
    return EMPTY;
  }
}
