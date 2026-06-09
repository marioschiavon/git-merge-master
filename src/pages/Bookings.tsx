import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, X, Calendar, ExternalLink } from "lucide-react";
import { useBookings, useCancelBooking, useRescheduleBooking, BOOKING_STATUS_LABELS, BookingStatus } from "@/hooks/useCalcom";

const STATUS_VARIANTS: Record<BookingStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  confirmed: "default",
  rescheduled: "secondary",
  cancelled: "destructive",
  no_show: "destructive",
  completed: "secondary",
};

export default function Bookings() {
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const { data: bookings, isLoading } = useBookings(status === "all" ? {} : { status });
  const cancel = useCancelBooking();
  const reschedule = useRescheduleBooking();
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [newStart, setNewStart] = useState("");

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Calendar className="h-6 w-6" /> Reuniões</h1>
          <p className="text-muted-foreground">Gerencie reservas do Cal.com</p>
        </div>
      </div>

      <Tabs value={status} onValueChange={(v) => setStatus(v as any)}>
        <TabsList>
          <TabsTrigger value="all">Todas</TabsTrigger>
          <TabsTrigger value="confirmed">Confirmadas</TabsTrigger>
          <TabsTrigger value="rescheduled">Remarcadas</TabsTrigger>
          <TabsTrigger value="cancelled">Canceladas</TabsTrigger>
          <TabsTrigger value="no_show">No-show</TabsTrigger>
          <TabsTrigger value="completed">Concluídas</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : !bookings?.length ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhuma reunião encontrada</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {bookings.map((b: any) => (
            <Card key={b.id}>
              <CardContent className="pt-4 flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={STATUS_VARIANTS[b.status as BookingStatus]}>{BOOKING_STATUS_LABELS[b.status as BookingStatus]}</Badge>
                    <span className="font-medium">{b.leads?.name || "Lead removido"}</span>
                    {b.leads?.company_name && <span className="text-sm text-muted-foreground">• {b.leads.company_name}</span>}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {b.scheduled_at ? new Date(b.scheduled_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Sem horário"}
                    {b.duration_minutes && ` • ${b.duration_minutes} min`}
                    {b.title && ` • ${b.title}`}
                  </div>
                  {rescheduling === b.id && (
                    <div className="flex gap-2 mt-2">
                      <Input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} className="max-w-xs" />
                      <Button size="sm" onClick={async () => {
                        await reschedule.mutateAsync({ booking_uid: b.calcom_booking_uid, start: new Date(newStart).toISOString() });
                        setRescheduling(null);
                      }}>Confirmar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setRescheduling(null)}>Cancelar</Button>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {b.meeting_url && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={b.meeting_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" />Abrir</a>
                    </Button>
                  )}
                  {["confirmed", "pending", "rescheduled"].includes(b.status) && b.calcom_booking_uid && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => { setRescheduling(b.id); setNewStart(""); }}>
                        Remarcar
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => {
                        const reason = prompt("Motivo do cancelamento (opcional):") || undefined;
                        cancel.mutate({ booking_uid: b.calcom_booking_uid, reason });
                      }}>
                        <X className="h-3 w-3 mr-1" />Cancelar
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
