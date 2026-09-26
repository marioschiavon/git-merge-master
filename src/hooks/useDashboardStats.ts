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

      // Contagens no servidor (evita o limite de 1000 linhas por consulta)
      const statuses = ["new", "enrolled", "contacted", "qualified", "unqualified", "converted", "discarded"];
      const sevenDaysAgo = subDays(new Date(), 7).toISOString();
      const base = () => supabase.from("leads").select("id", { count: "exact", head: true }).eq("company_id", companyId);
      const [totalRes, newRes, ...statusRes] = await Promise.all([
        base(),
        base().gte("created_at", sevenDaysAgo),
        ...statuses.map((s) => base().eq("status", s as any)),
      ]);
      if (totalRes.error) throw totalRes.error;

      const total = totalRes.count || 0;
      const new7d = newRes.count || 0;
      const byStatus: Record<string, number> = {};
      statuses.forEach((s, i) => { byStatus[s] = statusRes[i].count || 0; });

      // Conversão: leads que avançaram (qualificados + convertidos) sobre os já abordados
      const advanced = byStatus.qualified + byStatus.converted;
      const approached = total - byStatus.new;
      const conversionRate = approached > 0 ? Math.round((advanced / approached) * 1000) / 10 : 0;

      return { total, new7d, byStatus, conversionRate };
    },
    enabled: !!companyId,
  });

  const weeklyLeadsQuery = useQuery({
    queryKey: ["dashboard-weekly-leads", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const eightWeeksAgo = subDays(new Date(), 56).toISOString();
      
      const data: { created_at: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await supabase
          .from("leads")
          .select("created_at")
          .eq("company_id", companyId)
          .gte("created_at", eightWeeksAgo)
          .range(from, from + 999);
        if (error) throw error;
        data.push(...(page || []));
        if (!page || page.length < 1000) break;
      }

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
            .in("status", ["active", "paused"]);
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
