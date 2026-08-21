import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { BulkProgress } from "@/hooks/useBulkLeadActions";

export function BulkActionProgress({ progress, label = "Enviando leads" }: { progress: BulkProgress; label?: string }) {
  if (progress.status === "idle") return null;

  const isRunning = progress.status === "running";
  const isDone = progress.status === "done";
  const isError = progress.status === "error";

  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        isError ? "border-destructive/40 bg-destructive/5" : isDone ? "border-green-200 bg-green-50" : "bg-muted/40"
      }`}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {isDone && <CheckCircle2 className="h-4 w-4 text-green-700" />}
          {isError && <AlertTriangle className="h-4 w-4 text-destructive" />}
          <span className="font-medium">
            {isRunning && `${label}…`}
            {isDone && "Concluído"}
            {isError && "Falhou"}
          </span>
          <span className="text-muted-foreground">
            {isError ? progress.error : `${progress.processed} de ${progress.total}`}
          </span>
        </div>
        {!isError && <span className="text-xs text-muted-foreground">{progress.percent}%</span>}
      </div>
      <Progress value={isError ? progress.percent : progress.percent} className="mt-2 h-1.5" />
    </div>
  );
}
