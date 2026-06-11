// Returns the default Cal.com meeting duration (minutes) for a company, or null
// if not configured. Prefers live data from the Cal.com API, falling back to
// the cached calcom_event_types table.
import { fetchEventTypeLengthMinutes, resolveEventTypeId } from "./calcom.ts";

export async function getMeetingDurationMinutes(
  supabase: any,
  companyId: string,
): Promise<number | null> {
  // 1. Try live Cal.com API first (always fresh).
  try {
    const apiKey = Deno.env.get("CALCOM_API_KEY");
    if (apiKey) {
      let eventTypeId: number | null = null;
      const { data: comp } = await supabase
        .from("companies")
        .select("calcom_default_event_type_id")
        .eq("id", companyId)
        .maybeSingle();
      if (comp?.calcom_default_event_type_id) {
        eventTypeId = Number(comp.calcom_default_event_type_id);
      }
      if (!eventTypeId) {
        try { eventTypeId = await resolveEventTypeId(apiKey); } catch (_e) { /* ignore */ }
      }
      if (eventTypeId) {
        const liveLen = await fetchEventTypeLengthMinutes(apiKey, eventTypeId);
        if (liveLen) {
          // Refresh cache in background (don't block on it).
          supabase
            .from("calcom_event_types")
            .update({ length_minutes: liveLen, synced_at: new Date().toISOString() })
            .eq("company_id", companyId)
            .eq("calcom_id", eventTypeId)
            .then(() => {}, () => {});
          return liveLen;
        }
      }
    }
  } catch (e) {
    console.error("getMeetingDurationMinutes live fetch failed", e);
  }

  // 2. Fallback: cached DB lookup.
  try {
    const { data: comp } = await supabase
      .from("companies")
      .select("calcom_default_event_type_id")
      .eq("id", companyId)
      .maybeSingle();
    const defaultId = comp?.calcom_default_event_type_id;
    if (defaultId) {
      const { data: et } = await supabase
        .from("calcom_event_types")
        .select("length_minutes")
        .eq("company_id", companyId)
        .eq("calcom_id", defaultId)
        .maybeSingle();
      if (et?.length_minutes) return Number(et.length_minutes);
    }
    const { data: any1 } = await supabase
      .from("calcom_event_types")
      .select("length_minutes")
      .eq("company_id", companyId)
      .eq("active", true)
      .not("length_minutes", "is", null)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (any1?.length_minutes) return Number(any1.length_minutes);
    return null;
  } catch (e) {
    console.error("getMeetingDurationMinutes db fallback failed", e);
    return null;
  }
}

/** Block to inject into system prompts: instructs the AI to never volunteer
 *  the meeting duration, and only reveal it if the lead asks. */
export function meetingDurationPromptBlock(minutes: number | null): string {
  const known = typeof minutes === "number" && minutes > 0;
  return `\n=== DURAÇÃO DA REUNIÃO (REGRA IMPORTANTE) ===
- Nas mensagens proativas, NUNCA mencione a duração exata da reunião.
- Refira-se como "uma conversa rápida de apresentação", "um papo curto" ou "uma call rápida".
- ${known
    ? `Só informe a duração real (${minutes} minutos) se o lead perguntar diretamente "quanto tempo dura?" ou equivalente.`
    : `Se o lead perguntar a duração, responda algo como "rápido, no máximo meia hora" sem cravar um número.`}
- Está PROIBIDO escrever "reunião de 15 minutos", "call de 30min" ou qualquer variação que cite minutos sem que o lead tenha perguntado.`;
}
