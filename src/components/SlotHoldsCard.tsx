import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { useSlotHolds, formatSlotBRT, type SlotHold } from "@/hooks/useSlotHolds";

const statusMeta: Record<string, { label: string; cls: string; icon: any }> = {
  held: { label: "Reservado", cls: "bg-blue-100 text-blue-800 border-blue-200", icon: Lock },
  confirmed: { label: "Confirmado", cls: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
  cancelled: { label: "Cancelado", cls: "bg-gray-100 text-gray-700 border-gray-200", icon: XCircle },
  expired: { label: "Expirado", cls: "bg-amber-100 text-amber-800 border-amber-200", icon: Clock },
};

function HoldRow({ hold }: { hold: SlotHold }) {
  const meta = statusMeta[hold.status] || statusMeta.held;
  const Icon = meta.icon;
  const expiresIn = new Date(hold.expires_at).getTime() - Date.now();
  const minutesLeft = Math.max(0, Math.round(expiresIn / 60000));
  const noUid = hold.status === "held" && !hold.cal_booking_uid;
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 text-sm border-b last:border-b-0">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{formatSlotBRT(hold.slot_datetime)}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {noUid && (
          <span title="Reserva NÃO efetivada na Cal.com (cal_booking_uid vazio)">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
          </span>
        )}
        {hold.status === "held" && (
          <span className="text-xs text-muted-foreground">
            {minutesLeft > 0 ? `${minutesLeft}m restantes` : "expira agora"}
          </span>
        )}
        <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>{meta.label}</Badge>
      </div>
    </div>
  );
}

interface Props {
  leadId: string | null | undefined;
  compact?: boolean;
}

export function SlotHoldsCard({ leadId, compact }: Props) {
  const { data: holds = [], isLoading } = useSlotHolds(leadId);
  if (!leadId) return null;
  if (isLoading) return null;

  const active = holds.filter((h) => h.status === "held");
  const history = holds.filter((h) => h.status !== "held");

  if (holds.length === 0) {
    if (compact) return null;
    return (
      <p className="text-sm text-muted-foreground">Nenhum horário oferecido a este lead ainda.</p>
    );
  }

  if (compact) {
    // Inline badge variant for conversation header
    if (active.length === 0) return null;
    const earliestExpiry = Math.min(...active.map((a) => new Date(a.expires_at).getTime()));
    const minutesLeft = Math.max(0, Math.round((earliestExpiry - Date.now()) / 60000));
    return (
      <Card className="border-blue-200 bg-blue-50/40 mb-3">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="h-3.5 w-3.5 text-blue-700" />
            <span className="text-xs font-semibold text-blue-900">
              {active.length} {active.length === 1 ? "horário reservado" : "horários reservados"} na Cal.com · expira em {minutesLeft}m
            </span>
          </div>
          <div className="space-y-0">
            {active.map((h) => <HoldRow key={h.id} hold={h} />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {active.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">Reservas ativas</p>
          <div className="rounded-md border px-3">
            {active.map((h) => <HoldRow key={h.id} hold={h} />)}
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1 mt-2">Histórico</p>
          <div className="rounded-md border px-3 opacity-80">
            {history.slice(0, 8).map((h) => <HoldRow key={h.id} hold={h} />)}
          </div>
        </div>
      )}
    </div>
  );
}
