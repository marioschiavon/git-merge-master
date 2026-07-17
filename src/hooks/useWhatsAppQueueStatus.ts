import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WhatsAppQueueStatus {
  pending: number;
  sending: number;
  sentLastHour: number;
  failedLastDay: number;
  nextScheduledFor: string | null;
}

export function useWhatsAppQueueStatus() {
  return useQuery<WhatsAppQueueStatus>({
    queryKey: ["whatsapp-queue-status"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

      const [pendingRes, sendingRes, sentRes, failedRes, nextRes] = await Promise.all([
        supabase.from("whatsapp_send_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("whatsapp_send_queue").select("id", { count: "exact", head: true }).eq("status", "sending"),
        supabase.from("whatsapp_send_queue").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", hourAgo),
        supabase.from("whatsapp_send_queue").select("id", { count: "exact", head: true }).eq("status", "failed").gte("updated_at", dayAgo),
        supabase.from("whatsapp_send_queue").select("scheduled_for").eq("status", "pending").order("scheduled_for", { ascending: true }).limit(1).maybeSingle(),
      ]);

      return {
        pending: pendingRes.count ?? 0,
        sending: sendingRes.count ?? 0,
        sentLastHour: sentRes.count ?? 0,
        failedLastDay: failedRes.count ?? 0,
        nextScheduledFor: nextRes.data?.scheduled_for ?? null,
      };
    },
  });
}
