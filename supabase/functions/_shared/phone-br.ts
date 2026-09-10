// Regra única de formatação de telefone do app.
// Saída sempre em E.164 (+55DDDNUMERO para o Brasil) ou null quando o número
// é curto/incompleto demais para ser usado.

const BR_DDDS = new Set<string>([
  "11","12","13","14","15","16","17","18","19",
  "21","22","24","27","28",
  "31","32","33","34","35","37","38",
  "41","42","43","44","45","46","47","48","49",
  "51","53","54","55",
  "61","62","63","64","65","66","67","68","69",
  "71","73","74","75","77","79",
  "81","82","83","84","85","86","87","88","89",
  "91","92","93","94","95","96","97","98","99",
]);

function normalizeBrLocal(local: string): string | null {
  // local = DDD + número (10 ou 11 dígitos)
  if (local.length < 10 || local.length > 11) return null;
  const ddd = local.slice(0, 2);
  if (!BR_DDDS.has(ddd)) return null;
  let rest = local.slice(2);
  if (rest.length === 8 && /^[6-9]/.test(rest)) rest = "9" + rest; // nono dígito
  if (rest.length === 9 && !/^9/.test(rest)) return null;
  return `+55${ddd}${rest}`;
}

export function normalizePhoneBR(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().replace(/^whatsapp:/i, "");
  if (!s) return null;
  const hadPlus = s.trimStart().startsWith("+");
  let d = s.replace(/\D/g, "");
  if (!d) return null;

  // 00 = prefixo internacional discado
  if (!hadPlus && d.startsWith("00")) d = d.slice(2);

  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    return normalizeBrLocal(d.slice(2));
  }

  if (!hadPlus) {
    let local = d;
    if (local.length === 11 || local.length === 12) {
      if (local.startsWith("0")) local = local.slice(1); // 0 de operadora
    }
    const br = normalizeBrLocal(local);
    if (br) return br;
  }

  // Número internacional (outro país): preserva como está.
  if (d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}

/** Dígitos prontos para a API do WhatsApp (sem "+"). */
export function toWhatsAppDigits(raw: string | null | undefined): string {
  const e164 = normalizePhoneBR(raw);
  if (e164) return e164.replace(/\D/g, "");
  return String(raw ?? "").replace(/\D/g, "");
}
