// Derives a "readiness" signal for a lead based on whether we have enough
// intel (lead_insights payload) to actually run a cadence, independent of
// the technical enrichment_status of the last job.

export type ReadinessKey =
  | "ready"
  | "partial"
  | "needs_review"
  | "processing"
  | "held"
  | "failed";

export interface Readiness {
  key: ReadinessKey;
  label: string;
  cls: string;
  tooltip: string;
}

interface LeadLike {
  website?: string | null;
  enrichment_status?: string | null;
}

interface InsightRow {
  insights?: any;
  raw_summary?: string | null;
}

function nonEmpty(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

export function computeReadiness(
  lead: LeadLike | null | undefined,
  insight: InsightRow | null | undefined,
): Readiness | null {
  if (!lead) return null;

  const status = lead.enrichment_status;

  if (status === "not_queued") {
    return {
      key: "held",
      label: "Em espera",
      cls: "bg-slate-100 text-slate-700 border border-slate-300",
      tooltip: "Lead importado mas fora do lote atual de enriquecimento. Use 'Enriquecer mais' para liberar.",
    };
  }


  if (status === "pending" || status === "processing") {
    return {
      key: "processing",
      label: "Enriquecendo…",
      cls: "bg-amber-100 text-amber-800",
      tooltip: "Enriquecimento em andamento",
    };
  }

  if (status === "failed") {
    return {
      key: "failed",
      label: "Falhou",
      cls: "bg-red-100 text-red-800",
      tooltip: "O job de enriquecimento falhou. Tente reprocessar.",
    };
  }

  const ins = insight?.insights || null;
  const hasProposta = nonEmpty(ins?.proposta_valor);
  const hasContexto =
    nonEmpty(ins?.resumo) ||
    nonEmpty(ins?.dores) ||
    nonEmpty(ins?.pain_points) ||
    nonEmpty(ins?.business_summary) ||
    nonEmpty(insight?.raw_summary);

  if (hasProposta && hasContexto) {
    return {
      key: "ready",
      label: "Pronto",
      cls: "bg-emerald-100 text-emerald-800",
      tooltip: "Insights e proposta de valor prontos para rodar cadência.",
    };
  }

  if (ins && (hasProposta || hasContexto)) {
    return {
      key: "partial",
      label: "Parcial",
      cls: "bg-blue-100 text-blue-800",
      tooltip:
        "Enriquecimento rodou mas faltou proposta de valor ou contexto. Reanalise o website.",
    };
  }

  // No insight row at all
  return {
    key: "needs_review",
    label: "Revisar",
    cls: "bg-amber-100 text-amber-900 border border-amber-300",
    tooltip: lead.website
      ? "Nenhum insight extraído. Rode a análise do website."
      : "Sem website ou redes sociais para analisar. Complete os dados do lead.",
  };
}
