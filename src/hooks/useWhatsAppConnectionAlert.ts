import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface WhatsAppConnectionAlert {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  status: string;
  /** Suspeita (não confirmação) de bloqueio do número pelo WhatsApp. */
  possiblyBlocked: boolean;
}

/**
 * Conexões de WhatsApp que precisam de atenção (caíram e não foram arquivadas).
 * Usado para o aviso fixo no topo do app.
 */
export function useWhatsAppConnectionAlert() {
  const { companyId } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-connection-alert", companyId],
    enabled: !!companyId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<WhatsAppConnectionAlert[]> => {
      const { data, error } = await supabase
        .from("hook7_instances")
        .select("id, display_name, phone_number, status, refusal_count")
        .eq("company_id", companyId!)
        .is("archived_at", null)
        .in("status", ["disconnected", "banned", "error"]);
      if (error) throw error;
      return (data || []).map((i) => ({
        id: i.id,
        display_name: i.display_name,
        phone_number: i.phone_number,
        status: i.status,
        possiblyBlocked: (i.refusal_count ?? 0) >= 3,
      }));
    },
  });
}
