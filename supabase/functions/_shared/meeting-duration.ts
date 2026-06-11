// Returns the default Cal.com meeting duration (minutes) for a company, or null
// if not configured. Used to inject a "só mencione se o lead perguntar" hint
// into AI prompts.
export async function getMeetingDurationMinutes(
  supabase: any,
  companyId: string,
): Promise<number | null> {
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
    // Fallback: first active event type
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
    console.error("getMeetingDurationMinutes failed", e);
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
