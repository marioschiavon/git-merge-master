import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Mail } from "lucide-react";

interface Props {
  leadId: string;
}

type DeliveryRow = {
  id: string;
  recipient_email: string;
  subject: string | null;
  status: string;
  error_message: string | null;
  from_email: string | null;
  provider: string;
  created_at: string;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "sent") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Enviado
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Falhou
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" /> Em fila
    </Badge>
  );
}

export function EmailDeliveryCard({ leadId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["email-delivery", leadId],
    refetchInterval: 30000,
    queryFn: async () => {
      const [logRes, queueRes] = await Promise.all([
        (supabase as any)
          .from("email_delivery_log")
          .select("id, recipient_email, subject, status, error_message, from_email, provider, created_at")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("cadence_execution_queue")
          .select("id, status, scheduled_for, attempts, last_error")
          .eq("lead_id", leadId)
          .in("status", ["pending", "processing"])
          .order("scheduled_for", { ascending: true }),
      ]);
      return {
        attempts: (logRes.data ?? []) as DeliveryRow[],
        queued: queueRes.data ?? [],
      };
    },
  });

  const attempts = data?.attempts ?? [];
  const queued = data?.queued ?? [];

  const sent = attempts.filter((a) => a.status === "sent").length;
  const failed = attempts.filter((a) => a.status === "failed").length;

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-1.5">
          <Mail className="h-4 w-4" />
          Entrega de email
        </h4>
        <div className="flex items-center gap-1.5">
          {queued.length > 0 && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" /> {queued.length} em fila
            </Badge>
          )}
          {sent > 0 && <Badge variant="secondary">{sent} enviados</Badge>}
          {failed > 0 && <Badge variant="destructive">{failed} falhas</Badge>}
        </div>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : attempts.length === 0 && queued.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma tentativa de envio de email para este lead.</p>
      ) : (
        <div className="space-y-2">
          {queued.map((q: any) => (
            <div key={q.id} className="flex items-start justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="truncate">Execução de cadência agendada</p>
                <p className="text-muted-foreground">
                  {new Date(q.scheduled_for).toLocaleString("pt-BR")}
                  {q.attempts > 0 && ` · ${q.attempts} tentativa(s)`}
                </p>
                {q.last_error && <p className="text-destructive break-words">{q.last_error}</p>}
              </div>
              <StatusBadge status="queued" />
            </div>
          ))}

          {attempts.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-2 text-xs">
              <div className="min-w-0">
                <p className="truncate">{a.subject || "(sem assunto)"}</p>
                <p className="text-muted-foreground truncate">
                  {a.from_email ? `${a.from_email} → ` : ""}
                  {a.recipient_email} · {new Date(a.created_at).toLocaleString("pt-BR")}
                </p>
                {a.error_message && (
                  <p className="text-destructive break-words">{a.error_message}</p>
                )}
              </div>
              <StatusBadge status={a.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
