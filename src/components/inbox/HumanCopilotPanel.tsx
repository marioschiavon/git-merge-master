import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Sparkles, CalendarPlus, CalendarX, CalendarClock, Send, Bot, MessageSquareReply } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTakeoverToggle } from "@/hooks/useHumanInbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Slot = { hold_id: string; slot_datetime: string; label: string };

const SNIPPETS: { label: string; text: string }[] = [
  { label: "Apresentação", text: "Oi! Aqui é o time comercial. Posso te explicar em 2 linhas como ajudamos empresas como a sua e ver se faz sentido a gente conversar?" },
  { label: "Pedir melhor horário", text: "Topa marcarmos um papo rápido de 20 minutos esta semana? Me diga 2 horários que ficam bons pra você." },
  { label: "Enviar materiais", text: "Vou te mandar agora um material com casos e diferenciais. Qualquer dúvida me chame por aqui." },
  { label: "Follow-up gentil", text: "Só passando pra confirmar se faz sentido seguirmos. Se preferir, me diga um melhor momento e eu volto a falar." },
];

export function HumanCopilotPanel({
  conversationId,
  leadId,
  onInsertText,
  onSentDirect,
}: {
  conversationId: string;
  leadId: string | null;
  onInsertText: (text: string) => void;
  onSentDirect?: () => void;
}) {
  const takeover = useTakeoverToggle();
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [suggest, setSuggest] = useState<{ sentiment: string; reasoning: string; suggested_reply: string } | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const handleSuggest = async () => {
    setLoadingSuggest(true);
    try {
      const { data, error } = await supabase.functions.invoke("human-suggest-reply", {
        body: { conversation_id: conversationId },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      setSuggest(data as any);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao gerar sugestão");
    } finally {
      setLoadingSuggest(false);
    }
  };

  const handleOfferSlots = async () => {
    setLoadingSlots(true);
    try {
      const { data, error } = await supabase.functions.invoke("human-offer-slots", {
        body: { conversation_id: conversationId },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      const d = data as any;
      setSlots(d.slots || []);
      if (d.suggested_message) onInsertText(d.suggested_message);
      toast.success(`${d.slots?.length || 0} horários reservados`);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao buscar horários");
    } finally {
      setLoadingSlots(false);
    }
  };

  const handleBookHold = async (hold: Slot) => {
    setBusy(`book-${hold.hold_id}`);
    try {
      const { data, error } = await supabase.functions.invoke("human-book-slot", {
        body: { conversation_id: conversationId, hold_id: hold.hold_id, notify_lead: true },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Reunião confirmada e mensagem enviada");
      onSentDirect?.();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao confirmar reunião");
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async (notify: boolean) => {
    setBusy("cancel");
    try {
      const { data, error } = await supabase.functions.invoke("human-cancel-booking", {
        body: { conversation_id: conversationId, notify_lead: notify, reason: "Cancelado pelo operador" },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Reunião cancelada");
      if (notify) onSentDirect?.();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao cancelar");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Copiloto humano
        </CardTitle>
        <p className="text-xs text-muted-foreground">A IA está pausada. Use as ações abaixo para conduzir.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={handleSuggest} disabled={loadingSuggest}>
            {loadingSuggest ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <MessageSquareReply className="h-3.5 w-3.5 mr-2" />}
            Gerar resposta com IA
          </Button>
          {suggest && (
            <div className="rounded-md border bg-muted/40 p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">{suggest.sentiment}</Badge>
                <span className="text-[10px] text-muted-foreground line-clamp-1">{suggest.reasoning}</span>
              </div>
              <p className="text-xs whitespace-pre-wrap">{suggest.suggested_reply}</p>
              <Button size="sm" variant="secondary" className="h-7 text-xs w-full" onClick={() => { onInsertText(suggest.suggested_reply); setSuggest(null); }}>
                <Send className="h-3 w-3 mr-1" /> Usar no compositor
              </Button>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Agenda</p>
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={handleOfferSlots} disabled={loadingSlots}>
            {loadingSlots ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5 mr-2" />}
            Sugerir 2 horários
          </Button>
          {slots.length > 0 && (
            <div className="space-y-1.5">
              {slots.map((s) => (
                <div key={s.hold_id} className="flex items-center justify-between gap-2 rounded border px-2 py-1.5 text-xs">
                  <span className="truncate">{s.label}</span>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" disabled={busy === `book-${s.hold_id}`} onClick={() => handleBookHold(s)}>
                    {busy === `book-${s.hold_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : "Agendar"}
                  </Button>
                </div>
              ))}
            </div>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-start text-red-600 hover:text-red-700">
                <CalendarX className="h-3.5 w-3.5 mr-2" /> Cancelar reunião ativa
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancelar a reunião ativa do lead?</AlertDialogTitle>
                <AlertDialogDescription>
                  Vamos cancelar no Cal.com e liberar os horários reservados. Você pode avisar o lead automaticamente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleCancel(false)} disabled={busy === "cancel"}>
                  Só cancelar
                </AlertDialogAction>
                <AlertDialogAction onClick={() => handleCancel(true)} disabled={busy === "cancel"}>
                  Cancelar e avisar lead
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Snippets rápidos</p>
          {SNIPPETS.map((s) => (
            <Button key={s.label} variant="ghost" size="sm" className="w-full justify-start h-auto py-1.5 text-left" onClick={() => onInsertText(s.text)}>
              <CalendarClock className="h-3 w-3 mr-2 shrink-0 opacity-60" />
              <span className="text-xs truncate">{s.label}</span>
            </Button>
          ))}
        </div>

        <Separator />

        <Button
          variant="default"
          size="sm"
          className="w-full"
          disabled={takeover.isPending}
          onClick={() => takeover.mutate({ conversation_id: conversationId, enable: false, resume_agent: true })}
        >
          {takeover.isPending ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Bot className="h-3.5 w-3.5 mr-2" />}
          Devolver para a IA
        </Button>
      </CardContent>
    </Card>
  );
}
