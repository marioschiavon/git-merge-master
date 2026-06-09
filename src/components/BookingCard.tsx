import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Calendar, Video, CalendarClock, XCircle, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useLeadBooking, formatBookingBRT } from "@/hooks/useLeadBooking";
import { useCancelBooking, useRescheduleBooking } from "@/hooks/useCalcom";

const variantMap: Record<string, { cls: string; label: string; icon: any }> = {
  confirmed:   { cls: "border-green-200 bg-green-50",   label: "Confirmada",  icon: CheckCircle2 },
  pending:     { cls: "border-blue-200 bg-blue-50",     label: "Pendente",    icon: CalendarClock },
  rescheduled: { cls: "border-amber-200 bg-amber-50",   label: "Remarcada",   icon: CalendarClock },
  cancelled:   { cls: "border-gray-200 bg-gray-50",     label: "Cancelada",   icon: XCircle },
  no_show:     { cls: "border-red-200 bg-red-50",       label: "Não compareceu", icon: AlertTriangle },
  completed:   { cls: "border-slate-200 bg-slate-50",   label: "Concluída",   icon: CheckCircle2 },
};

function isoToLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props { leadId: string | null | undefined; }

export function BookingCard({ leadId }: Props) {
  const { data: booking, isLoading } = useLeadBooking(leadId);
  const cancel = useCancelBooking();
  const reschedule = useRescheduleBooking();
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [newStart, setNewStart] = useState("");

  if (!leadId || isLoading || !booking) return null;

  const meta = variantMap[booking.status] || variantMap.pending;
  const Icon = meta.icon;
  const isActive = booking.status === "confirmed" || booking.status === "rescheduled" || booking.status === "pending";
  const isCancelled = booking.status === "cancelled";

  const handleReschedule = async () => {
    if (!booking.calcom_booking_uid || !newStart) return;
    await reschedule.mutateAsync({
      booking_uid: booking.calcom_booking_uid,
      start: new Date(newStart).toISOString(),
    });
    setRescheduleOpen(false);
    setNewStart("");
  };

  return (
    <Card className={`mb-3 ${meta.cls}`}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Icon className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">Reunião {meta.label.toLowerCase()}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{booking.status}</Badge>
              </div>
              {booking.scheduled_at && (
                <p className={`text-sm ${isCancelled ? "line-through text-muted-foreground" : "font-medium"}`}>
                  {formatBookingBRT(booking.scheduled_at)}
                </p>
              )}
              {booking.title && (
                <p className="text-xs text-muted-foreground truncate">{booking.title}</p>
              )}
            </div>
          </div>

          {isActive && (
            <div className="flex flex-wrap items-center gap-1 shrink-0">
              {booking.meeting_url && (
                <Button size="sm" variant="outline" asChild>
                  <a href={booking.meeting_url} target="_blank" rel="noopener noreferrer">
                    <Video className="h-3.5 w-3.5 mr-1" /> Meet
                  </a>
                </Button>
              )}

              <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setNewStart(isoToLocalInput(booking.scheduled_at))}
                    disabled={!booking.calcom_booking_uid}
                  >
                    <CalendarClock className="h-3.5 w-3.5 mr-1" /> Remarcar
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Remarcar reunião</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor="new-start">Nova data e hora (BRT)</Label>
                    <Input
                      id="new-start"
                      type="datetime-local"
                      value={newStart}
                      onChange={(e) => setNewStart(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      A Cal.com verificará a disponibilidade do novo horário.
                    </p>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setRescheduleOpen(false)}>Cancelar</Button>
                    <Button onClick={handleReschedule} disabled={!newStart || reschedule.isPending}>
                      {reschedule.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
                      Confirmar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!booking.calcom_booking_uid}>
                    <XCircle className="h-3.5 w-3.5 mr-1" /> Cancelar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancelar reunião?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso cancela a reunião na Cal.com e libera o horário. Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Voltar</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => cancel.mutate({ booking_uid: booking.calcom_booking_uid! })}
                    >
                      Cancelar reunião
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
