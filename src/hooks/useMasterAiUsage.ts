import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { estimateCostUsd } from "@/lib/ai-pricing";

export type UsagePeriod = 7 | 30 | 90;

export interface ModelUsage {
  model: string;
  runs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface CompanyUsage {
  companyId: string;
  companyName: string;
  runs: number;
  totalTokens: number;
  costUsd: number;
}

export interface MasterAiUsage {
  totals: {
    runs: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  byModel: ModelUsage[];
  byCompany: CompanyUsage[];
  topModel: string | null;
  loading: boolean;
}

export function useMasterAiUsage(period: UsagePeriod = 30): MasterAiUsage {
  const [state, setState] = useState<MasterAiUsage>({
    totals: { runs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 },
    byModel: [],
    byCompany: [],
    topModel: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();

      const [runsRes, companiesRes] = await Promise.all([
        supabase
          .from("sdr_agent_runs")
          .select("company_id, model, prompt_tokens, completion_tokens, total_tokens")
          .gte("created_at", since)
          .limit(50000),
        supabase.from("companies").select("id, name"),
      ]);

      if (cancelled) return;

      const rows = runsRes.data ?? [];
      const companyMap = new Map<string, string>(
        (companiesRes.data ?? []).map((c: any) => [c.id, c.name]),
      );

      const modelAgg = new Map<string, ModelUsage>();
      const companyAgg = new Map<string, CompanyUsage>();
      const totals = { runs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };

      for (const r of rows as any[]) {
        const model = r.model ?? "desconhecido";
        const pt = r.prompt_tokens ?? 0;
        const ct = r.completion_tokens ?? 0;
        const tt = r.total_tokens ?? pt + ct;
        const cost = estimateCostUsd(model, pt, ct);

        totals.runs += 1;
        totals.promptTokens += pt;
        totals.completionTokens += ct;
        totals.totalTokens += tt;
        totals.costUsd += cost;

        const m = modelAgg.get(model) ?? {
          model,
          runs: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        m.runs += 1;
        m.promptTokens += pt;
        m.completionTokens += ct;
        m.totalTokens += tt;
        m.costUsd += cost;
        modelAgg.set(model, m);

        const cid = r.company_id;
        const c = companyAgg.get(cid) ?? {
          companyId: cid,
          companyName: companyMap.get(cid) ?? "—",
          runs: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        c.runs += 1;
        c.totalTokens += tt;
        c.costUsd += cost;
        companyAgg.set(cid, c);
      }

      const byModel = [...modelAgg.values()].sort((a, b) => b.totalTokens - a.totalTokens);
      const byCompany = [...companyAgg.values()]
        .sort((a, b) => b.totalTokens - a.totalTokens)
        .slice(0, 10);

      setState({
        totals,
        byModel,
        byCompany,
        topModel: byModel[0]?.model ?? null,
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  return state;
}

export function useCompanyUsageMap(period: UsagePeriod = 30) {
  const [data, setData] = useState<Map<string, CompanyUsage>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await supabase
        .from("sdr_agent_runs")
        .select("company_id, model, prompt_tokens, completion_tokens, total_tokens")
        .gte("created_at", since)
        .limit(50000);

      if (cancelled) return;
      const agg = new Map<string, CompanyUsage>();
      for (const r of (rows ?? []) as any[]) {
        const pt = r.prompt_tokens ?? 0;
        const ct = r.completion_tokens ?? 0;
        const tt = r.total_tokens ?? pt + ct;
        const cost = estimateCostUsd(r.model, pt, ct);
        const c = agg.get(r.company_id) ?? {
          companyId: r.company_id,
          companyName: "",
          runs: 0,
          totalTokens: 0,
          costUsd: 0,
        };
        c.runs += 1;
        c.totalTokens += tt;
        c.costUsd += cost;
        agg.set(r.company_id, c);
      }
      setData(agg);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  return { data, loading };
}
