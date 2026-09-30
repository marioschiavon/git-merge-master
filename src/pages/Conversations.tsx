import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useConversations, useLeadMessages, useSendMessage, useAiReply, useLastInboundSnippets } from "@/hooks/useConversations";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConversationTakeover, useTakeoverToggle } from "@/hooks/useHumanInbox";
import { HumanCopilotPanel } from "@/components/inbox/HumanCopilotPanel";
import { Switch } from "@/components/ui/switch";
import { SlotHoldsCard } from "@/components/SlotHoldsCard";
import { BookingCard } from "@/components/BookingCard";
import { MessageCircle, Send, Sparkles, Loader2, ArrowLeft, User, Bot, RotateCcw, CalendarCheck, CalendarClock, CalendarX, AlertTriangle, CheckCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { brtDayKey, formatBRTDayLabel, formatBRTFull, formatBRTMessage } from "@/lib/datetime";

function deliveryLabel(s?: string): string | null {
  if (!s) return null;
  if (s === "delivered" || s === "sent") return "Entregue";
  if (s === "queued") return "Na fila";
  if (s === "failed") return "Falhou";
  return null;
}

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
  lastReplyAt: string | null;
  lastReplyConvId: string | null;
};

const periodLabel: Record<string, string> = {
  hoje: "hoje",
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
  tudo: "no total",
};

export default function Conversations() {
  const { data: conversations = [], isLoading, refetch } = useConversations();
  const { isMasterAdmin, isCompanyAdmin, companyId } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const leadParam = searchParams.get("lead");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(leadParam);

  const selectLead = (leadId: string | null) => {
    setSelectedLeadId(leadId);
    const next = new URLSearchParams(searchParams);
    if (leadId) next.set("lead", leadId);
    else next.delete("lead");
    setSearchParams(next, { replace: true });
  };

  // Sincroniza seleção com a URL (ex.: vindo de Acompanhamento)
  useEffect(() => {
    setSelectedLeadId(leadParam);
  }, [leadParam]);

  // Filtros da lista (guardados na URL)
  const replyFilter = searchParams.get("filtro") || "todas"; // todas | responderam | sem_resposta
  const period = searchParams.get("periodo") || "tudo"; // hoje | 7d | 30d | tudo
  const [search, setSearch] = useState("");
  const setParam = (k: string, v: string, def: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === def) next.delete(k); else next.set(k, v);
    setSearchParams(next, { replace: true });
  };

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
        if (c.last_inbound_at && (!g.lastReplyAt || c.last_inbound_at > g.lastReplyAt)) {
          g.lastReplyAt = c.last_inbound_at;
          g.lastReplyConvId = c.id;
        }
      } else {
        map.set(lid, {
          lead_id: lid,
          lead: c.leads,
          conversations: [c],
          lastActivity: c.created_at,
          lastReplyAt: c.last_inbound_at || null,
          lastReplyConvId: c.last_inbound_at ? c.id : null,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const ka = a.lastReplyAt && a.lastReplyAt > a.lastActivity ? a.lastReplyAt : a.lastActivity;
      const kb = b.lastReplyAt && b.lastReplyAt > b.lastActivity ? b.lastReplyAt : b.lastActivity;
      return ka < kb ? 1 : -1;
    });
  }, [conversations]);

  const periodStart = useMemo(() => {
    const now = new Date();
    if (period === "hoje") { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString(); }
    if (period === "7d") return new Date(now.getTime() - 7 * 86400000).toISOString();
    if (period === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString();
    return null;
  }, [period]);

  const repliedInPeriod = useMemo(
    () => leadGroups.filter((g) => g.lastReplyAt && (!periodStart || g.lastReplyAt >= periodStart)),
    [leadGroups, periodStart],
  );

  const visibleGroups = useMemo(() => {
    let list = leadGroups;
    if (replyFilter === "responderam") {
      list = repliedInPeriod.slice().sort((a, b) => (a.lastReplyAt! < b.lastReplyAt! ? 1 : -1));
    } else if (replyFilter === "sem_resposta") {
      list = list.filter((g) => !g.lastReplyAt);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((g) =>
        [g.lead?.name, g.lead?.company_name, g.lead?.email].filter(Boolean).join(" ").toLowerCase().includes(q),
      );
    }
    return list;
  }, [leadGroups, repliedInPeriod, replyFilter, search]);

  const snippetConvIds = useMemo(
    () => visibleGroups.slice(0, 300).map((g) => g.lastReplyConvId).filter(Boolean) as string[],
    [visibleGroups],
  );
  const { data: snippets } = useLastInboundSnippets(snippetConvIds);

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
      selectLead(null);
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
          <Button variant="ghost" size="icon" onClick={() => { selectLead(null); setAiSuggestion(null); }}>
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
            messages.map((msg: any, i: number) => {
              const ts: string = msg.sent_at || msg.created_at;
              const prev: any = messages[i - 1];
              const prevTs: string | undefined = prev ? prev.sent_at || prev.created_at : undefined;
              const daySep = !prevTs || brtDayKey(prevTs) !== brtDayKey(ts) ? (
                <div className="flex items-center gap-2 py-1">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-medium text-muted-foreground">{formatBRTDayLabel(ts)}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              ) : null;
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
                  <div key={msg.id} className="space-y-3">
                    {daySep}
                    <div className="flex justify-center">
                      <div className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                        <Icon className="h-3 w-3" />
                        <span>{msg.content}</span>
                        <time className="opacity-60" dateTime={ts} title={formatBRTFull(ts)}>· {formatBRTMessage(ts)}</time>
                      </div>
                    </div>
                  </div>
                );
              }
              const bubble = (
              <div className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
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
                  <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] opacity-70">
                    {msg.direction === "outbound" && deliveryLabel(msg.metadata?.delivery_status) && (
                      <span>{deliveryLabel(msg.metadata?.delivery_status)} ·</span>
                    )}
                    <time dateTime={ts} title={formatBRTFull(ts)}>{formatBRTMessage(ts)}</time>
                  </div>
                </div>
              </div>
              );
              return (
                <div key={msg.id} className="space-y-3">
                  {daySep}
                  {bubble}
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

      {!isLoading && leadParam && !selectedGroup && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Esse lead ainda não tem conversas registradas.
        </div>
      )}

      {!isLoading && leadGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={replyFilter} onValueChange={(v) => setParam("filtro", v, "todas")}>
              <TabsList>
                <TabsTrigger value="todas">Todas</TabsTrigger>
                <TabsTrigger value="responderam">Responderam</TabsTrigger>
                <TabsTrigger value="sem_resposta">Sem resposta</TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={period} onValueChange={(v) => setParam("periodo", v, "tudo")}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
                <SelectItem value="tudo">Todo o período</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Buscar por nome ou empresa"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[240px]"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{repliedInPeriod.length}</span>{" "}
            {repliedInPeriod.length === 1 ? "lead respondeu" : "leads responderam"} {periodLabel[period] || ""}
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : leadGroups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageCircle className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Nenhuma conversa ainda. As conversas aparecerão aqui quando leads forem contactados.</p>
          </CardContent>
        </Card>
      ) : visibleGroups.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma conversa encontrada com esses filtros.</p>
      ) : (
        <div className="space-y-2">
          {visibleGroups.map((g) => {
            const channels = Array.from(new Set(g.conversations.map((c) => c.channel)));
            const snip = g.lastReplyConvId ? snippets?.get(g.lastReplyConvId) : null;
            return (
              <Card key={g.lead_id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => selectLead(g.lead_id)}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{g.lead?.name || "Lead"}</p>
                    <p className="text-xs text-muted-foreground">{g.lead?.company_name || ""} · {g.lead?.email || ""}</p>
                    {snip?.content && (
                      <p className="text-xs text-muted-foreground mt-1 truncate max-w-[520px]">“{snip.content}”</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {g.lastReplyAt && (
                      <Badge variant="default" className="text-xs" title={formatBRTFull(g.lastReplyAt)}>
                        Respondeu · {formatBRTMessage(g.lastReplyAt)}
                      </Badge>
                    )}
                    {channels.map((ch) => (
                      <Badge key={ch} variant="outline" className="text-xs">{channelLabel(ch)}</Badge>
                    ))}
                    {!g.lastReplyAt && (
                      <span className="text-xs text-muted-foreground">{new Date(g.lastActivity).toLocaleDateString("pt-BR")}</span>
                    )}
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
