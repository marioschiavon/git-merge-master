import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export function useConversations() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["conversations", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("conversations")
        .select("*, leads(name, email, company_name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });
}

export function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["messages", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!conversationId,
  });
}

export function useLeadMessages(conversations: Array<{ id: string; channel: string }>) {
  const ids = conversations.map((c) => c.id).sort().join(",");
  return useQuery({
    queryKey: ["lead-messages", ids],
    queryFn: async () => {
      if (!conversations.length) return [];
      const channelMap = new Map(conversations.map((c) => [c.id, c.channel]));
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .in("conversation_id", conversations.map((c) => c.id))
        .order("sent_at", { ascending: true });
      if (error) throw error;
      return (data || []).map((m: any) => ({ ...m, channel: channelMap.get(m.conversation_id) }));
    },
    enabled: conversations.length > 0,
  });
}

export function useCreateConversation() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (params: { lead_id: string; channel: string; cadence_enrollment_id?: string }) => {
      if (!companyId) throw new Error("Sem empresa vinculada");
      const { data, error } = await supabase
        .from("conversations")
        .insert({
          company_id: companyId,
          lead_id: params.lead_id,
          channel: params.channel as any,
          cadence_enrollment_id: params.cadence_enrollment_id || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conversations"] }),
    onError: (e: any) => toast.error(e.message),
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (params: { conversation_id: string; content: string; direction: string; ai_suggested?: boolean; metadata?: any }) => {
      // Mensagens outbound passam pela edge function que envia via Twilio/canal antes de salvar
      if (params.direction === "outbound") {
        const { data, error } = await supabase.functions.invoke("send-outbound-message", {
          body: {
            conversation_id: params.conversation_id,
            content: params.content,
            ai_suggested: params.ai_suggested || false,
            metadata: params.metadata || {},
          },
        });
        if (error) throw error;
        if (data?.delivery_status === "failed") {
          toast.error(`Falha no envio: ${data?.twilio_error || data?.delivery_error || "erro desconhecido"}`);
        } else if (data?.delivery_status === "delivered") {
          toast.success("Mensagem enviada");
        }
        return data?.message;
      }

      // Inbound (raro daqui) cai no caminho legado
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: params.conversation_id,
          content: params.content,
          direction: params.direction,
          ai_suggested: params.ai_suggested || false,
          metadata: params.metadata || {},
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["messages", vars.conversation_id] });
      qc.invalidateQueries({ queryKey: ["lead-messages"] });
      if (companyId) qc.invalidateQueries({ queryKey: ["conversations", companyId] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useAiReply() {
  return useMutation({
    mutationFn: async (params: { conversationHistory: any[]; leadInfo?: any; channel?: string }) => {
      const { data, error } = await supabase.functions.invoke("ai-reply", { body: params });
      if (error) throw error;
      return data as { tone_detected: string; sentiment: string; reasoning: string; suggested_reply: string };
    },
    onError: (e: any) => toast.error(e.message || "Erro ao analisar conversa"),
  });
}
