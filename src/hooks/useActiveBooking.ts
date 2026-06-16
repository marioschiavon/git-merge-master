import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ActiveBooking = {
  calcom_booking_uid: string;
  scheduled_at: string;
  attendees: any;
  status: string;
};

export function useActiveBooking(conversationId: string | null) {
  return useQuery({
    queryKey: ["human-active-booking", conversationId],
    queryFn: async (): Promise<ActiveBooking | null> => {
      if (!conversationId) return null;
      const { data, error } = await supabase.functions.invoke("human-active-booking", {
        body: { conversation_id: conversationId },
      });
      if (error) throw new Error(error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as any)?.booking || null;
    },
    enabled: !!conversationId,
    staleTime: 30_000,
  });
}
