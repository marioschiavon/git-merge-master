import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const MUNICIPIA_URL = "https://municipia.lovable.app/";

export function useMunicipiaEnabled() {
  const { companyId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["municipia-integration", companyId],
    enabled: !!companyId,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await supabase
        .from("municipia_integrations")
        .select("enabled, last_import_at, last_import_count")
        .eq("company_id", companyId!)
        .maybeSingle();
      return data ?? null;
    },
  });

  // Realtime: quando o master admin habilita/desabilita a integração, o menu
  // e a página refletem a mudança na hora, sem precisar recarregar.
  useEffect(() => {
    if (!companyId) return;
    // Nome único por montagem: evita reaproveitar um canal já inscrito
    // (React StrictMode monta o efeito duas vezes).
    const channel = supabase.channel(
      `municipia-integration-${companyId}-${Math.random().toString(36).slice(2)}`,
    );
    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "municipia_integrations",
          filter: `company_id=eq.${companyId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["municipia-integration", companyId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, qc]);


  return query;
}

export async function fetchMunicipiaSession(): Promise<{ token: string; company_id: string } | null> {
  const { data, error } = await supabase.functions.invoke("municipia-session");
  if (error || !data?.token) return null;
  return data as { token: string; company_id: string };
}
