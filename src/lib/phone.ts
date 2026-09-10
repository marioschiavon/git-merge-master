// Regra única de formatação de telefone do app (espelho de
// supabase/functions/_shared/phone-br.ts). Saída em E.164.

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
  if (local.length < 10 || local.length > 11) return null;
  const ddd = local.slice(0, 2);
  if (!BR_DDDS.has(ddd)) return null;
  let rest = local.slice(2);
  if (rest.length === 8 && /^[6-9]/.test(rest)) rest = "9" + rest;
  if (rest.length === 9 && !/^9/.test(rest)) return null;
  return `+55${ddd}${rest}`;
}

export function normalizePhoneBR(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().replace(/^whatsapp:/i, "");
  if (!s) return null;
  const hadPlus = s.trimStart().startsWith("+");
  let d = s.replace(/\D/g, "");
  if (!d) return null;

  if (!hadPlus && d.startsWith("00")) d = d.slice(2);

  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    return normalizeBrLocal(d.slice(2));
  }

  if (!hadPlus) {
    let local = d;
    if ((local.length === 11 || local.length === 12) && local.startsWith("0")) {
      local = local.slice(1);
    }
    const br = normalizeBrLocal(local);
    if (br) return br;
  }

  if (d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}
