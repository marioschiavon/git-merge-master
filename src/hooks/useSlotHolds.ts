import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type SlotHold = {
  id: string;
  company_id: string;
  lead_id: string;
  conversation_id: string | null;
  slot_datetime: string;
  cal_booking_uid: string | null;
  status: string;
  expires_at: string;
  preferred_channel: string | null;
  created_at: string;
};

export function useSlotHolds(leadId: string | null | undefined) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["slot_holds", leadId],
    queryFn: async () => {
      if (!leadId || !companyId) return [] as SlotHold[];
      const { data, error } = await supabase
        .from("slot_holds" as any)
        .select("*")
        .eq("lead_id", leadId)
        .eq("company_id", companyId)
        .order("slot_datetime", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as SlotHold[];
    },
    enabled: !!leadId && !!companyId,
    refetchInterval: 30000,
  });
}

export function formatSlotBRT(iso: string) {
  const BRT_OFFSET = 3 * 3600000;
  const d = new Date(new Date(iso).getTime() - BRT_OFFSET);
  return (
    d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) +
    " às " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}
