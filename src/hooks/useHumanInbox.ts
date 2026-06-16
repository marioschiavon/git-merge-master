import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type InboxConversation = {
  id: string;
  lead_id: string;
  channel: string;
  last_inbound_at: string | null;
  human_taken_at: string | null;
  human_taken_by: string | null;
  human_takeover_reason: string | null;
  lead: {
    id: string;
    name: string | null;
    email: string | null;
    company_name: string | null;
  } | null;
  last_message: { content: string; direction: string; sent_at: string } | null;
};

export function useInboxQueue() {
  const { companyId } = useAuth();
  const qc = useQueryClient();

  // Realtime: re-fetch when conversations or messages change
  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`inbox-realtime-${companyId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `company_id=eq.${companyId}` }, () => {
        qc.invalidateQueries({ queryKey: ["inbox-queue", companyId] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => {
        qc.invalidateQueries({ queryKey: ["inbox-queue", companyId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [companyId, qc]);

  return useQuery({
    queryKey: ["inbox-queue", companyId],
    enabled: !!companyId,
    refetchInterval: 30_000,
    queryFn: async (): Promise<InboxConversation[]> => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, lead_id, channel, last_inbound_at, human_taken_at, human_taken_by, human_takeover_reason, leads(id, name, email, company_name)")
        .eq("company_id", companyId!)
        .eq("human_takeover", true)
        .order("last_inbound_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      const convIds = (data || []).map((c) => c.id);
      let lastMap = new Map<string, any>();
      if (convIds.length > 0) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("conversation_id, content, direction, sent_at")
          .in("conversation_id", convIds)
          .order("sent_at", { ascending: false })
          .limit(convIds.length * 5);
        for (const m of msgs || []) {
          if (!lastMap.has(m.conversation_id)) lastMap.set(m.conversation_id, m);
        }
      }
      return (data || []).map((c: any) => ({
        id: c.id,
        lead_id: c.lead_id,
        channel: c.channel,
        last_inbound_at: c.last_inbound_at,
        human_taken_at: c.human_taken_at,
        human_taken_by: c.human_taken_by,
        human_takeover_reason: c.human_takeover_reason,
        lead: c.leads || null,
        last_message: lastMap.get(c.id) || null,
      }));
    },
  });
}

export function useTakeoverToggle() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (params: { conversation_id: string; enable: boolean; reason?: string; resume_agent?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("human-takeover-toggle", { body: params });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["inbox-queue", companyId] });
      qc.invalidateQueries({ queryKey: ["conversations", companyId] });
      qc.invalidateQueries({ queryKey: ["conversation-takeover", vars.conversation_id] });
      toast.success(vars.enable ? "Você assumiu a conversa" : "Conversa devolvida para a IA");
    },
    onError: (e: any) => toast.error(e?.message || "Erro ao alternar modo humano"),
  });
}

export function useConversationTakeover(conversationId: string | null) {
  return useQuery({
    queryKey: ["conversation-takeover", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, human_takeover, human_taken_at, human_taken_by, human_takeover_reason")
        .eq("id", conversationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
