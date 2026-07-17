import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type EnrichmentQueueStatus = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  not_queued: number;
  total: number;
  inFlight: number;
};

export function useEnrichmentQueueStatus() {
  const { companyId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<EnrichmentQueueStatus>({
    queryKey: ["enrichment-queue-status", companyId],
    enabled: !!companyId,
    refetchInterval: 10_000,
    queryFn: async () => {
      const empty: EnrichmentQueueStatus = {
        pending: 0, processing: 0, completed: 0, failed: 0, not_queued: 0, total: 0, inFlight: 0,
      };
      if (!companyId) return empty;
      const { data, error } = await supabase
        .from("leads")
        .select("enrichment_status")
        .eq("company_id", companyId);
      if (error) throw error;
      const acc = { ...empty };
      for (const row of data || []) {
        const s = (row as any).enrichment_status as string | null;
        if (s === "pending") acc.pending++;
        else if (s === "processing") acc.processing++;
        else if (s === "completed") acc.completed++;
        else if (s === "failed") acc.failed++;
        else if (s === "not_queued") acc.not_queued++;
      }
      acc.total = acc.pending + acc.processing + acc.completed + acc.failed + acc.not_queued;
      acc.inFlight = acc.pending + acc.processing;
      return acc;
    },
  });

  // Realtime nudge: whenever a lead row changes, invalidate the query.
  useEffect(() => {
    if (!companyId) return;
    const ch = supabase
      .channel(`leads-enrichment-${companyId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leads", filter: `company_id=eq.${companyId}` },
        () => qc.invalidateQueries({ queryKey: ["enrichment-queue-status", companyId] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads", filter: `company_id=eq.${companyId}` },
        () => qc.invalidateQueries({ queryKey: ["enrichment-queue-status", companyId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [companyId, qc]);

  return query;
}

/** Returns true briefly after the queue drains from >0 in-flight to 0. */
export function useJustFinishedFlag(inFlight: number, total: number) {
  const [justFinished, setJustFinished] = useState(false);
  const [prevInFlight, setPrevInFlight] = useState(inFlight);

  useEffect(() => {
    if (prevInFlight > 0 && inFlight === 0 && total > 0) {
      setJustFinished(true);
      const t = setTimeout(() => setJustFinished(false), 30_000);
      setPrevInFlight(inFlight);
      return () => clearTimeout(t);
    }
    setPrevInFlight(inFlight);
  }, [inFlight, total, prevInFlight]);

  return justFinished;
}
