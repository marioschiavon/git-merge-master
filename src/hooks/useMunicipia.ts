import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const MUNICIPIA_URL = "https://municipia.lovable.app/";

export function useMunicipiaEnabled() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["municipia-integration", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await supabase
        .from("municipia_integrations")
        .select("enabled, last_import_at, last_import_count")
        .eq("company_id", companyId!)
        .maybeSingle();
      return data ?? null;
    },
  });
}

export async function fetchMunicipiaSession(): Promise<{ token: string; company_id: string } | null> {
  const { data, error } = await supabase.functions.invoke("municipia-session");
  if (error || !data?.token) return null;
  return data as { token: string; company_id: string };
}
