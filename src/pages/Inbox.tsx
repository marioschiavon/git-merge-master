import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Inbox as InboxIcon, Loader2, Send, User, Bot, MessageSquare, Mail, Linkedin, AlertTriangle } from "lucide-react";
import { useInboxQueue, useTakeoverToggle, type InboxConversation } from "@/hooks/useHumanInbox";
import { useMessages, useSendMessage } from "@/hooks/useConversations";
import { SLABadge } from "@/components/inbox/SLABadge";
import { HumanCopilotPanel } from "@/components/inbox/HumanCopilotPanel";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const initials = (name?: string | null) => (name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

const channelIcon = (ch: string) => {
  if (ch === "email") return <Mail className="h-3 w-3" />;
  if (ch === "whatsapp") return <MessageSquare className="h-3 w-3" />;
  if (ch === "linkedin") return <Linkedin className="h-3 w-3" />;
  return null;
};

const reasonLabel: Record<string, { text: string; cls: string }> = {
  rejected_approval: { text: "rejeitado", cls: "bg-red-100 text-red-800" },
  manual: { text: "manual", cls: "bg-blue-100 text-blue-800" },
  sla_breach: { text: "SLA", cls: "bg-amber-100 text-amber-800" },
};

export default function Inbox() {
  const { data: queue = [], isLoading } = useInboxQueue();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialConvId = searchParams.get("conversation");
  const [selectedId, setSelectedId] = useState<string | null>(initialConvId);
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [text, setText] = useState("");

  useEffect(() => {
    if (!selectedId && queue.length > 0) setSelectedId(queue[0].id);
    if (selectedId && !queue.find((c) => c.id === selectedId) && queue.length > 0) setSelectedId(queue[0].id);
  }, [queue, selectedId]);

  useEffect(() => {
    if (selectedId) setSearchParams((p) => { p.set("conversation", selectedId); return p; }, { replace: true });
  }, [selectedId, setSearchParams]);

  const filtered = useMemo(() => {
    if (filter === "mine") return queue.filter((c) => c.human_taken_by === user?.id);
    return queue;
  }, [queue, filter, user?.id]);

  const slaBreached = useMemo(() => queue.filter((c) => {
    if (!c.last_inbound_at) return false;
    return Date.now() - new Date(c.last_inbound_at).getTime() > 15 * 60_000;
  }).length, [queue]);

  const selected = useMemo<InboxConversation | null>(
    () => filtered.find((c) => c.id === selectedId) || queue.find((c) => c.id === selectedId) || null,
    [filtered, queue, selectedId],
  );

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      <div className="px-6 py-4 border-b">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <InboxIcon className="h-5 w-5" />
              Inbox humana
            </h1>
            <p className="text-xs text-muted-foreground">Conversas que estão sob controle do operador.</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">{queue.length} ativas</Badge>
            {slaBreached > 0 && (
              <Badge className="text-xs bg-red-100 text-red-800 gap-1">
                <AlertTriangle className="h-3 w-3" /> {slaBreached} SLA estourado
              </Badge>
            )}
            <div className="flex rounded-md border overflow-hidden text-xs">
              <button
                className={cn("px-3 py-1", filter === "all" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
                onClick={() => setFilter("all")}
              >Todos</button>
              <button
                className={cn("px-3 py-1 border-l", filter === "mine" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
                onClick={() => setFilter("mine")}
              >Meus</button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] overflow-hidden">
        {/* Lista */}
        <div className="border-r overflow-hidden flex flex-col">
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Nenhuma conversa em modo humano.</div>
            ) : (
              <div className="divide-y">
                {filtered.map((c) => {
                  const isActive = c.id === selectedId;
                  const r = reasonLabel[c.human_takeover_reason || "manual"] || reasonLabel.manual;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={cn("w-full text-left p-3 hover:bg-muted/50 transition", isActive && "bg-muted")}
                    >
                      <div className="flex items-start gap-2.5">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">{initials(c.lead?.name)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium truncate">{c.lead?.name || "Lead"}</span>
                            <SLABadge lastInboundAt={c.last_inbound_at} />
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{c.lead?.company_name || ""}</p>
                          {c.last_message && (
                            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                              {c.last_message.direction === "outbound" ? "Você: " : ""}{c.last_message.content}
                            </p>
                          )}
                          <div className="flex items-center gap-1 mt-1">
                            <Badge variant="outline" className="text-[10px] gap-1 h-4 px-1.5">{channelIcon(c.channel)} {c.channel}</Badge>
                            <Badge className={cn("text-[10px] h-4 px-1.5", r.cls)} variant="secondary">{r.text}</Badge>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Chat */}
        <div className="flex flex-col overflow-hidden border-r">
          {selected ? (
            <ChatPanel
              conversation={selected}
              text={text}
              setText={setText}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Selecione uma conversa.</div>
          )}
        </div>

        {/* Copiloto */}
        <div className="overflow-y-auto p-4">
          {selected ? (
            <HumanCopilotPanel
              conversationId={selected.id}
              leadId={selected.lead_id}
              onInsertText={(t) => setText((prev) => (prev ? prev + "\n\n" + t : t))}
              onSentDirect={() => { /* mensagens já invalidam via realtime */ }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ conversation, text, setText }: { conversation: InboxConversation; text: string; setText: (v: string | ((p: string) => string)) => void }) {
  const { data: messages = [] } = useMessages(conversation.id);
  const sendMessage = useSendMessage();
  const takeover = useTakeoverToggle();

  const handleSend = async () => {
    const t = text.trim();
    if (!t) return;
    await sendMessage.mutateAsync({ conversation_id: conversation.id, content: t, direction: "outbound" });
    setText("");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{conversation.lead?.name || "Lead"}</span>
            <Badge variant="outline" className="text-[10px] gap-1">{channelIcon(conversation.channel)} {conversation.channel}</Badge>
            <SLABadge lastInboundAt={conversation.last_inbound_at} />
          </div>
          <p className="text-xs text-muted-foreground truncate">{conversation.lead?.company_name || ""} · {conversation.lead?.email || ""}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={takeover.isPending}
          onClick={() => takeover.mutate({ conversation_id: conversation.id, enable: false, resume_agent: true })}
        >
          <Bot className="h-3.5 w-3.5 mr-1.5" />
          Devolver à IA
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">Sem mensagens.</p>
          ) : (
            messages.map((m: any) => {
              if (m.direction === "system") {
                return (
                  <div key={m.id} className="flex justify-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      {m.content}
                    </div>
                  </div>
                );
              }
              const out = m.direction === "outbound";
              const actor = m.metadata?.actor;
              return (
                <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[75%] rounded-lg px-3 py-2 text-sm", out ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    <div className="flex items-center gap-1 mb-0.5 text-[10px] opacity-80">
                      {out ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                      <span>{out ? (actor === "human" ? "Operador" : "SDR") : "Lead"}</span>
                      <span className="ml-1">{formatDistanceToNow(new Date(m.sent_at), { locale: ptBR, addSuffix: true })}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <div className="flex gap-2">
          <Textarea
            placeholder="Escreva sua resposta..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); } }}
          />
          <Button onClick={handleSend} disabled={!text.trim() || sendMessage.isPending} className="self-end">
            {sendMessage.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">Cmd/Ctrl + Enter para enviar</p>
      </div>
    </div>
  );
}
