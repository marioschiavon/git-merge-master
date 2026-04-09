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
  return useMutation({
    mutationFn: async (params: { conversation_id: string; content: string; direction: string; ai_suggested?: boolean; metadata?: any }) => {
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
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["messages", vars.conversation_id] }),
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
