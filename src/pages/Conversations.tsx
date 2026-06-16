import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useConversations, useLeadMessages, useSendMessage, useAiReply } from "@/hooks/useConversations";
import { useConversationTakeover, useTakeoverToggle } from "@/hooks/useHumanInbox";
import { HumanCopilotPanel } from "@/components/inbox/HumanCopilotPanel";
import { Switch } from "@/components/ui/switch";
import { SlotHoldsCard } from "@/components/SlotHoldsCard";
import { BookingCard } from "@/components/BookingCard";
import { MessageCircle, Send, Sparkles, Loader2, ArrowLeft, User, Bot, RotateCcw, CalendarCheck, CalendarClock, CalendarX, AlertTriangle, CheckCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const sentimentColors: Record<string, string> = {
  interesse: "bg-green-100 text-green-800",
  objeção: "bg-yellow-100 text-yellow-800",
  dúvida: "bg-blue-100 text-blue-800",
  rejeição: "bg-red-100 text-red-800",
  neutro: "bg-gray-100 text-gray-800",
};

const channelLabel = (ch?: string) => {
  if (!ch) return "";
  if (ch === "whatsapp") return "WhatsApp";
  if (ch === "email") return "Email";
  if (ch === "linkedin") return "LinkedIn";
  return ch;
};

type LeadGroup = {
  lead_id: string;
  lead: any;
  conversations: any[]; // raw conversation rows
  lastActivity: string;
};

export default function Conversations() {
  const { data: conversations = [], isLoading, refetch } = useConversations();
  const { isMasterAdmin, isCompanyAdmin, companyId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Agrupa conversas por lead
  const leadGroups: LeadGroup[] = useMemo(() => {
    const map = new Map<string, LeadGroup>();
    for (const c of conversations as any[]) {
      const lid = c.lead_id;
      if (!lid) continue;
      const g = map.get(lid);
      if (g) {
        g.conversations.push(c);
        if (c.created_at > g.lastActivity) g.lastActivity = c.created_at;
      } else {
        map.set(lid, {
          lead_id: lid,
          lead: c.leads,
          conversations: [c],
          lastActivity: c.created_at,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
  }, [conversations]);

  const selectedGroup = leadGroups.find((g) => g.lead_id === selectedLeadId) || null;
  const selectedConvList = useMemo(
    () => (selectedGroup ? selectedGroup.conversations.map((c) => ({ id: c.id, channel: c.channel })) : []),
    [selectedGroup]
  );
  const selectedConvIds = useMemo(() => selectedConvList.map((c) => c.id), [selectedConvList]);

  // Realtime
  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`conv-realtime-${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        (payload: any) => {
          const convId = payload.new?.conversation_id || payload.old?.conversation_id;
          if (convId) {
            queryClient.invalidateQueries({ queryKey: ["messages", convId] });
            // invalida agregadas que contenham essa conversation
            queryClient.invalidateQueries({ queryKey: ["lead-messages"] });
          }
          queryClient.invalidateQueries({ queryKey: ["conversations", companyId] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `company_id=eq.${companyId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["conversations", companyId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  const { data: messages = [] } = useLeadMessages(selectedConvList);
  const sendMessage = useSendMessage();
  const aiReply = useAiReply();
  const [newMessage, setNewMessage] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [resetting, setResetting] = useState(false);

  // Canal de resposta = canal da última inbound; fallback: conversa mais antiga
  const replyChannel = useMemo(() => {
    if (!selectedGroup) return null;
    const lastInbound = [...messages].reverse().find((m: any) => m.direction === "inbound");
    if (lastInbound?.channel) return lastInbound.channel;
    const oldest = [...selectedGroup.conversations].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
    return oldest?.channel || null;
  }, [selectedGroup, messages]);

  const replyConversationId = useMemo(() => {
    if (!selectedGroup || !replyChannel) return null;
    const match = selectedGroup.conversations.find((c) => c.channel === replyChannel);
    return match?.id || selectedGroup.conversations[0]?.id || null;
  }, [selectedGroup, replyChannel]);

  const { data: takeoverState } = useConversationTakeover(replyConversationId);
  const takeover = useTakeoverToggle();
  const humanOn = !!takeoverState?.human_takeover;


  const handleReset = async () => {
    setResetting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("reset-test-data", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      toast.success("Dados de teste resetados com sucesso!");
      setSelectedLeadId(null);
      refetch();
    } catch (err: any) {
      toast.error("Erro ao resetar: " + (err.message || "erro desconhecido"));
    } finally {
      setResetting(false);
    }
  };

  const handleSend = async (direction: string, content?: string) => {
    if (!replyConversationId) return;
    const text = content || newMessage.trim();
    if (!text) return;
    await sendMessage.mutateAsync({
      conversation_id: replyConversationId,
      content: text,
      direction,
    });
    setNewMessage("");
  };

  const handleAiSuggest = async () => {
    if (!selectedGroup || messages.length === 0) return;
    const lead = selectedGroup.lead;
    const result = await aiReply.mutateAsync({
      conversationHistory: messages.map((m: any) => ({ direction: m.direction, content: m.content })),
      leadInfo: lead ? { name: lead.name, company_name: lead.company_name } : undefined,
      channel: replyChannel || undefined,
    });
    setAiSuggestion(result);
  };

  const handleUseSuggestion = () => {
    if (!aiSuggestion) return;
    setNewMessage(aiSuggestion.suggested_reply);
    setAiSuggestion(null);
  };

  if (selectedGroup) {
    const channels = Array.from(new Set(selectedGroup.conversations.map((c) => c.channel)));
    return (
      <div className="p-6 h-full flex gap-4 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedLeadId(null); setAiSuggestion(null); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">{selectedGroup.lead?.name || "Conversa"}</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{selectedGroup.lead?.company_name}</span>
              <span>·</span>
              <div className="flex gap-1">
                {channels.map((ch) => (
                  <Badge key={ch} variant="outline" className="text-[10px] h-4">{channelLabel(ch)}</Badge>
                ))}
              </div>
            </div>
          </div>
          {replyConversationId && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
              <Bot className={`h-3.5 w-3.5 ${humanOn ? "opacity-30" : "text-primary"}`} />
              <Switch
                checked={humanOn}
                disabled={takeover.isPending}
                onCheckedChange={(checked) =>
                  takeover.mutate({
                    conversation_id: replyConversationId,
                    enable: checked,
                    reason: "manual",
                    resume_agent: !checked,
                  })
                }
              />
              <User className={`h-3.5 w-3.5 ${humanOn ? "text-primary" : "opacity-30"}`} />
              <span className="text-xs font-medium">{humanOn ? "Humano" : "IA"}</span>
            </div>
          )}
        </div>

        {humanOn && (
          <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            👤 Você está no controle desta conversa. A IA não responderá automaticamente até você devolver.
          </div>
        )}

        <BookingCard leadId={selectedGroup.lead_id} />

        <SlotHoldsCard leadId={selectedGroup.lead_id} compact />

        <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-0">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda.</p>
          ) : (
            messages.map((msg: any) => {
              if (msg.direction === "system") {
                const evType = msg.metadata?.event_type as string | undefined;
                const iconMap: Record<string, any> = {
                  booking_created: CalendarCheck,
                  booking_rescheduled: CalendarClock,
                  booking_cancelled: CalendarX,
                  booking_no_show: AlertTriangle,
                  booking_completed: CheckCheck,
                };
                const Icon = iconMap[evType || ""] || CalendarCheck;
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      <Icon className="h-3 w-3" />
                      <span>{msg.content}</span>
                      <span className="opacity-60">· {new Date(msg.sent_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                  </div>
                );
              }
              return (
              <div key={msg.id} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[70%] rounded-lg p-3 ${msg.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <div className="flex items-center gap-1 mb-1">
                    {msg.direction === "outbound" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    <span className="text-xs opacity-70">{msg.direction === "outbound" ? "SDR" : "Prospect"}</span>
                    {msg.channel && (
                      <Badge variant="secondary" className="text-[10px] h-4">{channelLabel(msg.channel)}</Badge>
                    )}
                    {msg.ai_suggested && <Badge variant="secondary" className="text-[10px] h-4"><Sparkles className="h-2 w-2 mr-0.5" />IA</Badge>}
                    {msg.metadata?.simulated && <Badge className="bg-amber-100 text-amber-800 text-[10px] h-4">🧪 Simulado</Badge>}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.metadata?.tone_detected && (
                    <Badge className={`mt-1 text-[10px] ${sentimentColors[msg.metadata.sentiment] || ""}`}>
                      {msg.metadata.tone_detected}
                    </Badge>
                  )}
                </div>
              </div>
              );
            })
          )}
        </div>

        {aiSuggestion && (
          <Card className="mb-3 border-primary/30">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Sugestão da IA</span>
                <Badge className={`text-xs ${sentimentColors[aiSuggestion.sentiment] || ""}`}>{aiSuggestion.sentiment}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{aiSuggestion.reasoning}</p>
              <pre className="text-sm whitespace-pre-wrap bg-muted p-2 rounded">{aiSuggestion.suggested_reply}</pre>
              <Button size="sm" onClick={handleUseSuggestion}>Usar esta resposta</Button>
            </CardContent>
          </Card>
        )}

        {replyChannel && (
          <p className="text-xs text-muted-foreground mb-1">
            Respondendo via <span className="font-medium text-foreground">{channelLabel(replyChannel)}</span>
          </p>
        )}
        <div className="flex gap-2">
          <Textarea
            placeholder="Digite uma mensagem..."
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            className="min-h-[60px]"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend("outbound"); } }}
          />
          <div className="flex flex-col gap-2">
            <Button size="icon" onClick={() => handleSend("outbound")} disabled={!newMessage.trim() || sendMessage.isPending || !replyConversationId}>
              <Send className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={handleAiSuggest} disabled={aiReply.isPending || messages.length === 0}>
              {aiReply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        </div>
        {humanOn && replyConversationId && (
          <div className="w-80 shrink-0 overflow-y-auto">
            <HumanCopilotPanel
              conversationId={replyConversationId}
              leadId={selectedGroup.lead_id}
              onInsertText={(t) => setNewMessage((prev) => (prev ? prev + "\n\n" + t : t))}
            />
          </div>
        )}
      </div>
    );
  }


  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Conversas</h1>
          <p className="text-muted-foreground">Histórico de mensagens com leads</p>
        </div>
        {(isMasterAdmin || isCompanyAdmin) && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={resetting}>
                {resetting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RotateCcw className="h-4 w-4 mr-1" />}
                Resetar testes
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Resetar dados de teste?</AlertDialogTitle>
                <AlertDialogDescription>
                  Isso vai apagar todas as conversas, mensagens, agendamentos (slot_holds) e resetar enrollments com reunião marcada. Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleReset}>Confirmar reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : leadGroups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageCircle className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Nenhuma conversa ainda. As conversas aparecerão aqui quando leads forem contactados.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {leadGroups.map((g) => {
            const channels = Array.from(new Set(g.conversations.map((c) => c.channel)));
            return (
              <Card key={g.lead_id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedLeadId(g.lead_id)}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{g.lead?.name || "Lead"}</p>
                    <p className="text-xs text-muted-foreground">{g.lead?.company_name || ""} · {g.lead?.email || ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {channels.map((ch) => (
                      <Badge key={ch} variant="outline" className="text-xs">{channelLabel(ch)}</Badge>
                    ))}
                    <span className="text-xs text-muted-foreground">{new Date(g.lastActivity).toLocaleDateString("pt-BR")}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
