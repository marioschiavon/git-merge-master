import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export interface BusinessHours {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
  days: number[]; // 0=Dom .. 6=Sáb
}

export interface CompanySettings {
  id: string;
  name: string;
  timezone: string;
  business_hours: BusinessHours;
}

export function useCompanySettings() {
  const { companyId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["company-settings", companyId],
    enabled: !!companyId,
    queryFn: async (): Promise<CompanySettings | null> => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name, timezone, business_hours")
        .eq("id", companyId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        timezone: data.timezone ?? "America/Sao_Paulo",
        business_hours: (data.business_hours as unknown as BusinessHours) ?? {
          start: "09:00",
          end: "18:00",
          days: [1, 2, 3, 4, 5],
        },
      };
    },
  });

  const update = useMutation({
    mutationFn: async (patch: Partial<Pick<CompanySettings, "name" | "timezone" | "business_hours">>) => {
      if (!companyId) throw new Error("Sem empresa");
      const { data, error } = await supabase
        .from("companies")
        .update(patch as any)
        .eq("id", companyId)
        .select("id, name, timezone, business_hours")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Você não tem permissão para alterar as configurações da empresa");
      return {
        id: data.id,
        name: data.name,
        timezone: data.timezone ?? "America/Sao_Paulo",
        business_hours: (data.business_hours as unknown as BusinessHours) ?? {
          start: "09:00",
          end: "18:00",
          days: [1, 2, 3, 4, 5],
        },
      } satisfies CompanySettings;
    },
    onSuccess: (data) => {
      toast.success("Configurações da empresa salvas");
      qc.setQueryData(["company-settings", companyId], data);
      qc.invalidateQueries({ queryKey: ["company-settings", companyId] });
      qc.invalidateQueries({ queryKey: ["company-name", companyId] });
    },
    onError: (e: any) => toast.error(e.message || "Falha ao salvar"),
  });

  return { ...query, update };
}
