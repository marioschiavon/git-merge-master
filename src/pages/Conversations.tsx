import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useConversations, useMessages, useSendMessage, useAiReply } from "@/hooks/useConversations";
import { SlotHoldsCard } from "@/components/SlotHoldsCard";
import { MessageCircle, Send, Sparkles, Loader2, ArrowLeft, User, Bot, RotateCcw } from "lucide-react";
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

export default function Conversations() {
  const { data: conversations = [], isLoading, refetch } = useConversations();
  const { isMasterAdmin, isCompanyAdmin } = useAuth();
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const { data: messages = [] } = useMessages(selectedConvId);
  const sendMessage = useSendMessage();
  const aiReply = useAiReply();
  const [newMessage, setNewMessage] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("reset-test-data", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      toast.success("Dados de teste resetados com sucesso!");
      setSelectedConvId(null);
      refetch();
    } catch (err: any) {
      toast.error("Erro ao resetar: " + (err.message || "erro desconhecido"));
    } finally {
      setResetting(false);
    }
  };

  const selectedConv = conversations.find((c: any) => c.id === selectedConvId);

  const handleSend = async (direction: string, content?: string) => {
    if (!selectedConvId) return;
    const text = content || newMessage.trim();
    if (!text) return;
    await sendMessage.mutateAsync({
      conversation_id: selectedConvId,
      content: text,
      direction,
    });
    setNewMessage("");
  };

  const handleAiSuggest = async () => {
    if (!selectedConvId || messages.length === 0) return;
    const lead = (selectedConv as any)?.leads;
    const result = await aiReply.mutateAsync({
      conversationHistory: messages.map((m: any) => ({ direction: m.direction, content: m.content })),
      leadInfo: lead ? { name: lead.name, company_name: lead.company_name } : undefined,
      channel: (selectedConv as any)?.channel,
    });
    setAiSuggestion(result);
  };

  const handleUseSuggestion = () => {
    if (!aiSuggestion) return;
    setNewMessage(aiSuggestion.suggested_reply);
    setAiSuggestion(null);
  };

  if (selectedConvId) {
    return (
      <div className="p-6 h-full flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedConvId(null); setAiSuggestion(null); }}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold">{(selectedConv as any)?.leads?.name || "Conversa"}</h2>
            <p className="text-xs text-muted-foreground">{(selectedConv as any)?.leads?.company_name} · {(selectedConv as any)?.channel}</p>
          </div>
        </div>

        <SlotHoldsCard leadId={(selectedConv as any)?.leads?.id || (selectedConv as any)?.lead_id} compact />

        <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-0">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem ainda.</p>
          ) : (
            messages.map((msg: any) => (
              <div key={msg.id} className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[70%] rounded-lg p-3 ${msg.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <div className="flex items-center gap-1 mb-1">
                    {msg.direction === "outbound" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                    <span className="text-xs opacity-70">{msg.direction === "outbound" ? "SDR" : "Prospect"}</span>
                    {msg.ai_suggested && <Badge variant="secondary" className="text-[10px] h-4"><Sparkles className="h-2 w-2 mr-0.5" />IA</Badge>}
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.metadata?.tone_detected && (
                    <Badge className={`mt-1 text-[10px] ${sentimentColors[msg.metadata.sentiment] || ""}`}>
                      {msg.metadata.tone_detected}
                    </Badge>
                  )}
                </div>
              </div>
            ))
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

        <div className="flex gap-2">
          <Textarea
            placeholder="Digite uma mensagem..."
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            className="min-h-[60px]"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend("outbound"); } }}
          />
          <div className="flex flex-col gap-2">
            <Button size="icon" onClick={() => handleSend("outbound")} disabled={!newMessage.trim() || sendMessage.isPending}>
              <Send className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="outline" onClick={handleAiSuggest} disabled={aiReply.isPending || messages.length === 0}>
              {aiReply.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </Button>
          </div>
        </div>
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
      ) : conversations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MessageCircle className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Nenhuma conversa ainda. As conversas aparecerão aqui quando leads forem contactados.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv: any) => (
            <Card key={conv.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setSelectedConvId(conv.id)}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{conv.leads?.name || "Lead"}</p>
                  <p className="text-xs text-muted-foreground">{conv.leads?.company_name || ""} · {conv.leads?.email || ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{conv.channel}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(conv.created_at).toLocaleDateString("pt-BR")}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
