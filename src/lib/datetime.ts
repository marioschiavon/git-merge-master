// Centralized date/time formatting in America/Sao_Paulo timezone.
// Always pass ISO strings (UTC) — these helpers convert correctly using
// Intl APIs (handles BRT/BRST/DST automatically). DO NOT subtract offsets manually.

const TZ = "America/Sao_Paulo";

export function formatBRTShort(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
  const time = d.toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} às ${time}`;
}

export function formatBRTLong(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const time = d.toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} às ${time}`;
}

export function formatBRTTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const BRT_TIMEZONE = TZ;

function brtParts(d: Date) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p; // YYYY-MM-DD
}

/** Chave do dia (YYYY-MM-DD) em BRT — usada para separar mensagens por dia. */
export function brtDayKey(iso: string): string {
  return brtParts(new Date(iso));
}

/** "29/09 às 14:32" (inclui ano se não for o ano atual). */
export function formatBRTMessage(iso: string): string {
  const d = new Date(iso);
  const sameYear = brtParts(d).slice(0, 4) === brtParts(new Date()).slice(0, 4);
  const date = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", ...(sameYear ? {} : { year: "numeric" }) });
  return `${date} às ${formatBRTTime(iso)}`;
}

/** "Hoje", "Ontem" ou "seg., 28/09" (com ano se diferente). */
export function formatBRTDayLabel(iso: string): string {
  const key = brtDayKey(iso);
  const today = brtParts(new Date());
  const yesterday = brtParts(new Date(Date.now() - 86_400_000));
  if (key === today) return "Hoje";
  if (key === yesterday) return "Ontem";
  const d = new Date(iso);
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", ...(sameYear ? {} : { year: "numeric" }) });
}

/** Data completa com segundos, para tooltip. */
export function formatBRTFull(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "full", timeStyle: "medium" }) + " (Brasília)";
}
