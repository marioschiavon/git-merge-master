import { useWhatsAppQueueStatus } from "@/hooks/useWhatsAppQueueStatus";
import { Loader2, MessageCircle } from "lucide-react";

function formatEta(iso: string | null): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "agora";
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "em segundos";
  if (mins < 60) return `em ~${mins}min`;
  const hours = Math.round(mins / 60);
  return `em ~${hours}h`;
}

export function WhatsAppQueueBadge() {
  const { data } = useWhatsAppQueueStatus();
  if (!data) return null;
  const total = data.pending + data.sending;
  if (total === 0 && data.sentLastHour === 0 && data.failedLastDay === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {total > 0 ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      ) : (
        <MessageCircle className="h-3.5 w-3.5 text-primary" />
      )}
      <span>
        Fila WhatsApp:{" "}
        <b className="text-foreground">{data.sending}</b> enviando ·{" "}
        <b className="text-foreground">{data.pending}</b> na fila ·{" "}
        <b className="text-foreground">{data.sentLastHour}</b> enviadas na última hora
        {data.failedLastDay > 0 && (
          <>
            {" "}· <b className="text-destructive">{data.failedLastDay}</b> falharam
          </>
        )}
        {data.nextScheduledFor && total > 0 && (
          <>
            {" "}· próxima {formatEta(data.nextScheduledFor)}
          </>
        )}
      </span>
    </div>
  );
}
