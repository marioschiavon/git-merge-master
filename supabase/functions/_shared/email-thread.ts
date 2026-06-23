// Helper para responder dentro da mesma thread de email.
// Lê as mensagens da conversa (com rfc_message_id) para devolver os headers de
// reply (In-Reply-To, References), o threadId do Gmail e um subject "Re: …"
// normalizado a partir do PRIMEIRO assunto real da thread.

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

const GENERIC_SUBJECTS = new Set(
  ["continuando nossa conversa", "re: continuando nossa conversa", "(sem assunto)", "sem assunto"],
);

function normalizeReplySubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const trimmed = subject.trim();
  if (!trimmed) return null;
  if (GENERIC_SUBJECTS.has(trimmed.toLowerCase())) return null;
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
    // Pega todas as mensagens de email da conversa que já têm Message-ID RFC
    // (ordenadas cronologicamente). Usa `sent_at` — a tabela `messages` NÃO
    // tem `created_at`, então ordenar por essa coluna gerava erro silencioso
    // e o reply saía como thread nova.
    const { data, error } = await supabase
      .from("messages")
      .select("rfc_message_id, gmail_thread_id, metadata, direction, sent_at")
      .eq("conversation_id", conversationId)
      .not("rfc_message_id", "is", null)
      .order("sent_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("[email-thread] select error:", error);
      return EMPTY;
    }
    const rows = (data || []) as Array<{
      rfc_message_id: string | null;
      gmail_thread_id: string | null;
      metadata: any;
      direction: string | null;
      sent_at: string | null;
    }>;
    if (rows.length === 0) return EMPTY;

    // In-Reply-To: preferir a ÚLTIMA mensagem inbound. Se não houver, usa a
    // última mensagem em geral (mantém a cadeia mesmo sem inbound novo).
    const lastInbound = [...rows].reverse().find((r) => r.direction === "inbound" && r.rfc_message_id);
    const last = rows[rows.length - 1];
    const inReplyTo = (lastInbound?.rfc_message_id ?? last?.rfc_message_id) ?? null;

    // References: cadeia completa de Message-IDs em ordem cronológica.
    const refs = rows.map((r) => r.rfc_message_id).filter(Boolean).join(" ").trim() || null;

    // gmail_thread_id: usar o da última mensagem que tenha um (geralmente
    // todas têm o mesmo, mas a inbound mais recente é a fonte de verdade).
    const threadId = [...rows].reverse().find((r) => r.gmail_thread_id)?.gmail_thread_id || null;

    // Subject: usar o PRIMEIRO assunto real da thread (ignora "Continuando
    // nossa conversa" e outros placeholders). Procura entre todas as
    // mensagens, do mais antigo pro mais novo.
    let originalSubject: string | null = null;
    for (const r of rows) {
      const s = (r.metadata?.subject || "").toString().trim();
      if (!s) continue;
      if (GENERIC_SUBJECTS.has(s.toLowerCase())) continue;
      // Limpa "Re:" iniciais para descobrir o assunto base.
      const base = s.replace(/^\s*(re|res|fwd|fw)\s*:\s*/i, "").trim();
      if (!base) continue;
      originalSubject = base;
      break;
    }

    return {
      in_reply_to_rfc_id: inReplyTo,
      references: refs,
      gmail_thread_id: threadId,
      reply_subject: normalizeReplySubject(originalSubject),
    };
  } catch (e) {
    console.error("[email-thread] getEmailReplyContext error:", e);
    return EMPTY;
  }
}
