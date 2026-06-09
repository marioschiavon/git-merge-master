// Centralized date/time formatting in America/Sao_Paulo timezone for Edge Functions.
// Always pass ISO strings (UTC) — these helpers use Intl APIs (handles BRT/BRST/DST).
// DO NOT subtract offsets manually.

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

export const BRT_TIMEZONE = TZ;
