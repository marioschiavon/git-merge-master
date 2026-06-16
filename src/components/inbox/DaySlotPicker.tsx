import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type DaySlot = { start: string; label: string };

export function DaySlotPicker({
  conversationId,
  selectedStart,
  onSelectStart,
  minDate,
}: {
  conversationId: string;
  selectedStart: string | null;
  onSelectStart: (iso: string | null) => void;
  minDate?: Date;
}) {
  const [date, setDate] = useState<Date | undefined>();
  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [loading, setLoading] = useState(false);

  const min = minDate ?? new Date(Date.now() + 24 * 3600 * 1000);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setSlots([]);
    onSelectStart(null);
    const key = format(date, "yyyy-MM-dd");
    supabase.functions
      .invoke("human-day-slots", { body: { conversation_id: conversationId, date: key } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          toast.error(error.message || "Erro ao buscar horários");
          return;
        }
        if ((data as any)?.error) {
          toast.error((data as any).error);
          return;
        }
        setSlots((data as any)?.slots || []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, conversationId]);

  return (
    <div className="space-y-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "w-full justify-start text-left font-normal h-8 text-xs",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5 mr-2" />
            {date ? format(date, "PPP", { locale: ptBR }) : <span>Escolher data</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={setDate}
            disabled={(d) => d < new Date(min.toDateString())}
            initialFocus
            locale={ptBR}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>

      {date && (
        <div className="rounded-md border bg-muted/30 p-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 justify-center">
              <Loader2 className="h-3 w-3 animate-spin" /> Buscando horários…
            </div>
          ) : slots.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-2 text-center">Sem horários nesse dia.</p>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {slots.map((s) => (
                <Button
                  key={s.start}
                  size="sm"
                  variant={selectedStart === s.start ? "default" : "outline"}
                  className="h-7 text-[11px] px-1"
                  onClick={() => onSelectStart(s.start)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
