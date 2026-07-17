import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useEnrichmentQueueStatus, useJustFinishedFlag } from "@/hooks/useEnrichmentQueueStatus";

export function EnrichmentQueueBadge() {
  const { data } = useEnrichmentQueueStatus();
  const inFlight = data?.inFlight ?? 0;
  const total = data?.total ?? 0;
  const justFinished = useJustFinishedFlag(inFlight, total);

  if (!data || total === 0) return null;

  const done = data.completed + data.failed;
  const trackedTotal = done + inFlight; // ignore not_queued from the progress bar
  const pct = trackedTotal > 0 ? Math.round((done / trackedTotal) * 100) : 0;

  if (inFlight > 0) {
    return (
      <div className="rounded-lg border bg-primary/5 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="font-medium">Enriquecendo leads…</span>
            <span className="text-muted-foreground">
              {done} de {trackedTotal} prontos
              {data.processing > 0 && ` · ${data.processing} em execução`}
            </span>
          </div>
          {data.failed > 0 && (
            <div className="flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {data.failed} falharam
            </div>
          )}
        </div>
        <Progress value={pct} className="mt-2 h-1.5" />
      </div>
    );
  }

  if (justFinished) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-medium">Pronto!</span>
        <span>Todos os leads foram enriquecidos.</span>
      </div>
    );
  }

  return null;
}
