// Extract preferred date range hints from a Portuguese message.
// Returns { start_after, end_before } as ISO UTC strings (BRT semantics).
// All times anchored to America/Sao_Paulo (UTC-3, ignoring DST for simplicity).

const BRT_OFFSET_HOURS = 3;

function brtToUtcIso(year: number, month: number, day: number, hour = 0, minute = 0): string {
  // Build a UTC date that corresponds to (year, month, day, hour, minute) BRT.
  return new Date(Date.UTC(year, month, day, hour + BRT_OFFSET_HOURS, minute)).toISOString();
}

function nowBrt(): Date {
  const n = new Date();
  return new Date(n.getTime() - BRT_OFFSET_HOURS * 3600000);
}

const WEEKDAY_MAP: Record<string, number> = {
  domingo: 0, segunda: 1, terca: 2, terça: 2, quarta: 3, quinta: 4,
  sexta: 5, sabado: 6, sábado: 6,
};

export type DateRangeHint = {
  start_after?: string;
  end_before?: string;
  reason?: string;
};

export function extractDateRangeFromText(text: string): DateRangeHint | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const nb = nowBrt();
  const todayDow = nb.getUTCDay();

  // "semana que vem" / "próxima semana" / "na semana que vem"
  if (/\b(semana que vem|pr[óo]xima semana|na semana que vem|outra semana)\b/.test(t)) {
    // Next Monday 00:00 BRT
    const daysUntilMon = ((1 - todayDow + 7) % 7) || 7;
    const start = new Date(nb);
    start.setUTCDate(start.getUTCDate() + daysUntilMon);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6); // Sunday
    return {
      start_after: brtToUtcIso(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0),
      end_before: brtToUtcIso(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59),
      reason: "semana_que_vem",
    };
  }

  // "daqui (a|à)? X dias" / "em X dias"
  const daqui = t.match(/\b(?:daqui (?:a |à )?|em )(\d{1,2})\s+dias?\b/);
  if (daqui) {
    const n = parseInt(daqui[1]);
    const start = new Date(nb);
    start.setUTCDate(start.getUTCDate() + n);
    return {
      start_after: brtToUtcIso(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0),
      reason: "daqui_x_dias",
    };
  }

  // "depois do dia DD/MM" or "a partir do dia DD/MM"
  const depoisSlash = t.match(/\b(?:depois do dia|a partir do dia|ap[óo]s o dia)\s+(\d{1,2})\/(\d{1,2})\b/);
  if (depoisSlash) {
    const day = parseInt(depoisSlash[1]);
    const month = parseInt(depoisSlash[2]) - 1;
    return {
      start_after: brtToUtcIso(nb.getUTCFullYear(), month, day, 0, 0),
      reason: "depois_do_dia_slash",
    };
  }

  // "depois do dia DD"
  const depoisDia = t.match(/\b(?:depois do dia|a partir do dia|ap[óo]s o dia)\s+(\d{1,2})\b/);
  if (depoisDia) {
    const day = parseInt(depoisDia[1]);
    let month = nb.getUTCMonth();
    if (day < nb.getUTCDate()) month += 1;
    return {
      start_after: brtToUtcIso(nb.getUTCFullYear(), month, day, 0, 0),
      reason: "depois_do_dia",
    };
  }

  // "próxima segunda/terça/..." — entire day range
  const proxDow = t.match(/\bpr[óo]xim[ao]\s+(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)\b/);
  if (proxDow) {
    const target = WEEKDAY_MAP[proxDow[1].replace("ç", "c").replace("á", "a")];
    if (target != null) {
      let diff = target - todayDow;
      if (diff <= 0) diff += 7;
      const day = new Date(nb);
      day.setUTCDate(day.getUTCDate() + diff);
      return {
        start_after: brtToUtcIso(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0),
        end_before: brtToUtcIso(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59),
        reason: "proxima_weekday",
      };
    }
  }

  // "fim do mês" / "no fim do mês"
  if (/\b(no )?fim do m[êe]s\b/.test(t)) {
    const day25 = new Date(Date.UTC(nb.getUTCFullYear(), nb.getUTCMonth(), 25));
    if (day25.getTime() < nb.getTime()) {
      day25.setUTCMonth(day25.getUTCMonth() + 1);
    }
    return {
      start_after: brtToUtcIso(day25.getUTCFullYear(), day25.getUTCMonth(), day25.getUTCDate(), 0, 0),
      reason: "fim_do_mes",
    };
  }

  // classify-intent often returns "next week" / "this week" textually
  if (/\bnext week\b/.test(t)) {
    const daysUntilMon = ((1 - todayDow + 7) % 7) || 7;
    const start = new Date(nb);
    start.setUTCDate(start.getUTCDate() + daysUntilMon);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return {
      start_after: brtToUtcIso(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(), 0, 0),
      end_before: brtToUtcIso(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59),
      reason: "next_week_textual",
    };
  }

  return null;
}
