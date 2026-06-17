// Shared helpers to safely label a referrer (indicante) in outbound messages.
// Avoids leaking placeholders like "Contato sem nome" into LLM prompts/messages.

const RAW_NAME_BLACKLIST = new Set<string>([
  "contato sem nome",
  "indicação sem nome",
  "indicacao sem nome",
  "(indicante sem nome)",
  "indicante sem nome",
  "lead sem nome",
  "sem nome",
  "n/a",
  "na",
  "null",
  "undefined",
]);

const looksLikeEmail = (s: string) => /@/.test(s);
const looksLikePhone = (s: string) => /^\+?\d[\d\s().-]{6,}$/.test(s.trim());

export function isUsableReferrerName(s?: string | null): boolean {
  if (!s) return false;
  const t = s.trim();
  if (!t) return false;
  if (RAW_NAME_BLACKLIST.has(t.toLowerCase())) return false;
  if (looksLikeEmail(t) || looksLikePhone(t)) return false;
  return true;
}

export function buildReferrerLabel(
  referrer?: { name?: string | null; company_name?: string | null } | null,
): { label: string; nameClean: string; companyClean: string } {
  const nameClean = isUsableReferrerName(referrer?.name) ? (referrer!.name as string).trim() : "";
  const companyClean = (referrer?.company_name || "").trim();
  const label = nameClean
    ? nameClean
    : companyClean
      ? `alguém da ${companyClean}`
      : "um contato em comum";
  return { label, nameClean, companyClean };
}

// Final outbound safety net — replaces any leftover placeholder in the
// generated message before it reaches the lead.
const FORBIDDEN_RE =
  /\b(contato sem nome|indica[cç][aã]o sem nome|indicante sem nome|lead sem nome|\[indicante\]|\[nome do indicante\]|\{\{?referrer_name\}?\}?)\b/gi;

export function sanitizeReferrerMentions(text: string, label: string): string {
  if (!text) return text;
  return text.replace(FORBIDDEN_RE, label);
}
