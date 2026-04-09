import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { subDays, startOfWeek, format } from "date-fns";

export function useDashboardStats() {
  const { companyId } = useAuth();

  const leadsQuery = useQuery({
    queryKey: ["dashboard-leads", companyId],
    queryFn: async () => {
      if (!companyId) return { total: 0, new7d: 0, byStatus: {} as Record<string, number>, conversionRate: 0 };
      
      const { data: allLeads, error } = await supabase
        .from("leads")
        .select("status, created_at")
        .eq("company_id", companyId);
      if (error) throw error;

      const total = allLeads?.length || 0;
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();
      const new7d = allLeads?.filter(l => l.created_at >= sevenDaysAgo).length || 0;
      
      const byStatus: Record<string, number> = {};
      allLeads?.forEach(l => {
        byStatus[l.status] = (byStatus[l.status] || 0) + 1;
      });

      const converted = byStatus["converted"] || 0;
      const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

      return { total, new7d, byStatus, conversionRate };
    },
    enabled: !!companyId,
  });

  const weeklyLeadsQuery = useQuery({
    queryKey: ["dashboard-weekly-leads", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const eightWeeksAgo = subDays(new Date(), 56).toISOString();
      
      const { data, error } = await supabase
        .from("leads")
        .select("created_at")
        .eq("company_id", companyId)
        .gte("created_at", eightWeeksAgo);
      if (error) throw error;

      const weeks: Record<string, number> = {};
      for (let i = 7; i >= 0; i--) {
        const weekStart = startOfWeek(subDays(new Date(), i * 7), { weekStartsOn: 1 });
        const key = format(weekStart, "dd/MM");
        weeks[key] = 0;
      }

      data?.forEach(lead => {
        const weekStart = startOfWeek(new Date(lead.created_at), { weekStartsOn: 1 });
        const key = format(weekStart, "dd/MM");
        if (key in weeks) weeks[key]++;
      });

      return Object.entries(weeks).map(([week, count]) => ({ week, leads: count }));
    },
    enabled: !!companyId,
  });

  const cadencesQuery = useQuery({
    queryKey: ["dashboard-cadences", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("cadences")
        .select("id, name, type, status")
        .eq("company_id", companyId)
        .eq("status", "active");
      if (error) throw error;

      const cadencesWithCount = await Promise.all(
        (data || []).map(async (c) => {
          const { count } = await supabase
            .from("cadence_enrollments")
            .select("*", { count: "exact", head: true })
            .eq("cadence_id", c.id)
            .eq("status", "active");
          return { ...c, enrolledCount: count || 0 };
        })
      );
      return cadencesWithCount;
    },
    enabled: !!companyId,
  });

  const activitiesQuery = useQuery({
    queryKey: ["dashboard-activities", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("lead_activities")
        .select("id, type, description, created_at, lead_id")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!companyId,
  });

  const integrationQuery = useQuery({
    queryKey: ["dashboard-integration", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("integrations")
        .select("status, last_synced_at, provider")
        .eq("company_id", companyId)
        .eq("provider", "pipedrive")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });

  return {
    leads: leadsQuery.data,
    weeklyLeads: weeklyLeadsQuery.data,
    activeCadences: cadencesQuery.data,
    recentActivities: activitiesQuery.data,
    integration: integrationQuery.data,
    isLoading: leadsQuery.isLoading || weeklyLeadsQuery.isLoading || cadencesQuery.isLoading,
  };
}
