import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type LeadBooking = {
  id: string;
  calcom_booking_uid: string | null;
  status: string;
  scheduled_at: string | null;
  end_at: string | null;
  meeting_url: string | null;
  title: string | null;
  timezone: string | null;
  updated_at: string;
  created_at: string;
};

export function useLeadBooking(leadId: string | null | undefined) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["lead_booking", leadId],
    queryFn: async () => {
      if (!leadId || !companyId) return null;
      const { data, error } = await supabase
        .from("bookings" as any)
        .select("id, calcom_booking_uid, status, scheduled_at, end_at, meeting_url, title, timezone, updated_at, created_at")
        .eq("lead_id", leadId)
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      const rows = (data || []) as unknown as LeadBooking[];
      if (rows.length === 0) return null;
      // Prefer most recent active (confirmed/pending). Otherwise show most recent overall.
      const active = rows.find((r) => r.status === "confirmed" || r.status === "pending");
      return active || rows[0];
    },
    enabled: !!leadId && !!companyId,
    refetchInterval: 30000,
  });
}

export { formatBRTShort as formatBookingBRT } from "@/lib/datetime";
