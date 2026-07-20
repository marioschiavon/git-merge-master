// Fetches recent human annotations and formats them as a "lessons learned"
// block that can be appended to any AI system prompt. Prioritizes explicit
// corrections (rejected / edited) over neutral notes.
//
// Usage:
//   const block = await fetchAnnotationsContext(supabase, {
//     companyId, leadId, maxChars: 1200
//   });
//   const systemPrompt = basePrompt + block;

export type AnnotationsContextInput = {
  companyId: string;
  leadId?: string | null;
  perLeadLimit?: number;
  perCompanyLimit?: number;
  maxChars?: number;
};

const ACTION_LABEL: Record<string, string> = {
  rejected: "rejeitada",
  edited: "editada",
  approved: "aprovada",
  none: "nota",
};

function truncate(s: string, n: number): string {
  const clean = (s || "").replace(/\s+/g, " ").trim();
  if (clean.length <= n) return clean;
  return clean.slice(0, n - 1).trimEnd() + "…";
}

export async function fetchAnnotationsContext(
  supabase: any,
  input: AnnotationsContextInput,
): Promise<string> {
  const {
    companyId,
    leadId = null,
    perLeadLimit = 10,
    perCompanyLimit = 5,
    maxChars = 1200,
  } = input;
  if (!companyId) return "";

  try {
    const queries: Promise<any>[] = [];
    if (leadId) {
      queries.push(
        supabase
          .from("message_annotations")
          .select("note, human_action, source_kind, lead_id, created_at")
          .eq("company_id", companyId)
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(perLeadLimit),
      );
    }
    // Company-wide notes (either not tied to a lead or from other leads —
    // for the same company). Keep small to avoid noise.
    queries.push(
      supabase
        .from("message_annotations")
        .select("note, human_action, source_kind, lead_id, created_at")
        .eq("company_id", companyId)
        .is("lead_id", null)
        .order("created_at", { ascending: false })
        .limit(perCompanyLimit),
    );

    const results = await Promise.all(queries);
    const leadRows: any[] = leadId ? results[0]?.data || [] : [];
    const companyRows: any[] = (leadId ? results[1] : results[0])?.data || [];

    const all: Array<{ note: string; action: string; scope: "lead" | "empresa" }> = [];
    for (const r of leadRows) {
      if (!r?.note) continue;
      all.push({ note: r.note, action: r.human_action || "none", scope: "lead" });
    }
    for (const r of companyRows) {
      if (!r?.note) continue;
      all.push({ note: r.note, action: r.human_action || "none", scope: "empresa" });
    }
    if (all.length === 0) return "";

    // Prioritize explicit corrections
    const weight = (a: string) =>
      a === "rejected" ? 0 : a === "edited" ? 1 : a === "none" ? 2 : 3;
    all.sort((a, b) => weight(a.action) - weight(b.action));

    const header = "\n\n=== CORREÇÕES E OBSERVAÇÕES DO TIME (aprenda com estas anotações — o humano corrigiu ou reforçou o comportamento esperado) ===\n";
    const footer = "\nAplique essas correções nas próximas mensagens. Se uma nota disser para NÃO fazer algo, respeite.";

    const lines: string[] = [];
    let used = header.length + footer.length;
    for (const item of all) {
      const label = ACTION_LABEL[item.action] || "nota";
      const scopeTag = item.scope === "empresa" ? "[empresa]" : `[${label}]`;
      const line = `- ${scopeTag} ${truncate(item.note, 220)}`;
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    if (lines.length === 0) return "";
    return header + lines.join("\n") + footer;
  } catch (e) {
    console.error("fetchAnnotationsContext error:", e);
    return "";
  }
}
