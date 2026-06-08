/**
 * Strip quoted email text from replies (Gmail PT/EN, Outlook, generic ">").
 * Shared by inbound-webhook, inbound-email-webhook, gmail-sync-inbox.
 */
export function stripQuotedEmail(text: string): string {
  if (!text) return text;

  // Gmail PT: "Em <data>, <nome> <email> escreveu:" — pode estar no início, ou após \n.
  // Match no início da linha (com ou sem newline antes) E exigir "escreveu:" depois.
  const emRegex = /(^|\r?\n)\s*Em\s[\s\S]*?escreveu\s*:/i;
  const emMatch = text.match(emRegex);
  if (emMatch && emMatch.index !== undefined) {
    const cleaned = text.substring(0, emMatch.index).trim();
    if (cleaned) return stripLeadingQuotes(cleaned);
  }

  // Gmail EN: "On <data> <nome> wrote:"
  const onRegex = /(^|\r?\n)\s*On\s[\s\S]*?wrote\s*:/i;
  const onMatch = text.match(onRegex);
  if (onMatch && onMatch.index !== undefined) {
    const cleaned = text.substring(0, onMatch.index).trim();
    if (cleaned) return stripLeadingQuotes(cleaned);
  }

  const patterns = [
    /(^|\r?\n)\s*-{3,}\s*Original Message\s*-{3,}/im,
    /(^|\r?\n)\s*_{10,}/im,
    /(^|\r?\n)\s*From:\s+.+\r?\nSent:\s+/im,
    /(^|\r?\n)\s*De:\s+.+\r?\nEnviado:\s+/im,
  ];

  let clean = text;
  for (const p of patterns) {
    const m = clean.match(p);
    if (m && m.index !== undefined) {
      clean = clean.substring(0, m.index).trim();
      break;
    }
  }

  return stripLeadingQuotes(clean) || text.trim();
}

function stripLeadingQuotes(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}
