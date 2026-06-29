import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type BookingStatus = "pending" | "confirmed" | "rescheduled" | "cancelled" | "no_show" | "completed";

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Pendente",
  confirmed: "Confirmada",
  rescheduled: "Remarcada",
  cancelled: "Cancelada",
  no_show: "No-show",
  completed: "Concluída",
};

export function useBookings(filters: { status?: BookingStatus; lead_id?: string } = {}) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["bookings", companyId, filters],
    queryFn: async () => {
      if (!companyId) return [];
      let q = supabase.from("bookings" as any).select("*, leads(id, name, email, company_name)").eq("company_id", companyId).order("scheduled_at", { ascending: false }).limit(200);
      if (filters.status) q = q.eq("status", filters.status);
      if (filters.lead_id) q = q.eq("lead_id", filters.lead_id);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });
}

export function useCalcomEventTypes() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["calcom_event_types", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase.from("calcom_event_types" as any).select("*").eq("company_id", companyId).order("title");
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });
}

export function useSyncEventTypes() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("sem company");
      const { data, error } = await supabase.functions.invoke("calcom-event-types", { body: { company_id: companyId } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["calcom_event_types"] });
      toast.success(`${data?.count || 0} tipos de evento sincronizados`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateEventType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { id: string; active?: boolean; default_for_intent?: string | null }) => {
      const { id, ...rest } = patch;
      const { error } = await supabase.from("calcom_event_types" as any).update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calcom_event_types"] }),
  });
}

export function useCalcomWebhookLog(limit = 50) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["calcom_webhook_log", companyId, limit],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase.from("calcom_webhook_log" as any).select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });
}

export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { booking_uid: string; reason?: string }) => {
      const { data, error } = await supabase.functions.invoke("calcom-booking-cancel", { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bookings"] }); toast.success("Reunião cancelada"); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useRescheduleBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { booking_uid: string; start: string; reason?: string }) => {
      const { data, error } = await supabase.functions.invoke("calcom-booking-reschedule", { body: params });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["bookings"] }); toast.success("Reunião remarcada"); },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useCompanyCalcomSettings() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["company_calcom_settings", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase.from("companies").select("id, calcom_team_id, calcom_round_robin_enabled, calcom_default_event_type_id").eq("id", companyId).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });
}

export function useUpdateCompanyCalcomSettings() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (patch: { calcom_team_id?: number | null; calcom_round_robin_enabled?: boolean; calcom_default_event_type_id?: number | null }) => {
      if (!companyId) throw new Error("sem company");
      const { error } = await supabase.from("companies").update(patch).eq("id", companyId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["company_calcom_settings"] }); toast.success("Configuração salva"); },
    onError: (e: any) => toast.error(e.message),
  });
}
