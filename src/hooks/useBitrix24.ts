import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

export interface Bitrix24Config {
  user_id?: string | null;
  category_id?: string | null;
  stage_created?: string | null;
  stage_handoff?: string | null;
  source_id?: string | null;
  field_map?: Record<string, string>;
}

export interface Bitrix24Discovery {
  portal: string;
  category_id: string;
  categories: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
  fields: Array<{ code: string; label: string; type: string }>;
}

/** Campos do Leaderei disponíveis no de/para (existem na tabela leads). */
export const BITRIX_LEAD_FIELDS: Array<{ key: string; label: string }> = [
  { key: "name", label: "Nome" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Telefone" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "title", label: "Cargo" },
  { key: "company_name", label: "Empresa" },
  { key: "website", label: "Site" },
  { key: "address", label: "Endereço" },
  { key: "source", label: "Origem" },
  { key: "status", label: "Status" },
  { key: "score", label: "Score" },
];

export function useBitrix24Integration() {
  const { companyId } = useAuth();

  return useQuery({
    queryKey: ["integration", "bitrix24", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data, error } = await supabase
        .from("integrations")
        .select("*")
        .eq("company_id", companyId)
        .eq("provider", "bitrix24")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!companyId,
  });
}

export function useConnectBitrix24() {
  const queryClient = useQueryClient();
  const { companyId } = useAuth();

  return useMutation({
    mutationFn: async (webhookUrl: string) => {
      const { data, error } = await supabase.functions.invoke("bitrix24-connect", {
        body: { webhook_url: webhookUrl, company_id: companyId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { ok: true; portal: string; user_name: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["integration", "bitrix24"] });
      toast({
        title: "Bitrix24 conectado!",
        description: `${data.portal} — ${data.user_name}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao conectar", description: error.message, variant: "destructive" });
    },
  });
}

export function useDisconnectBitrix24() {
  const queryClient = useQueryClient();
  const { companyId } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("Empresa não identificada");
      const { error } = await supabase
        .from("integrations")
        .delete()
        .eq("company_id", companyId)
        .eq("provider", "bitrix24");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration", "bitrix24"] });
      toast({ title: "Bitrix24 desconectado" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao desconectar", description: error.message, variant: "destructive" });
    },
  });
}

export function useBitrix24Discover(categoryId: string | null, enabled: boolean) {
  const { companyId } = useAuth();

  return useQuery({
    queryKey: ["bitrix24-discover", companyId, categoryId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bitrix24-discover", {
        body: { company_id: companyId, category_id: categoryId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as Bitrix24Discovery;
    },
    enabled: !!companyId && enabled,
    staleTime: 60_000,
  });
}

export function useSaveBitrix24Config() {
  const queryClient = useQueryClient();
  const { companyId } = useAuth();

  return useMutation({
    mutationFn: async (config: Bitrix24Config) => {
      if (!companyId) throw new Error("Empresa não identificada");
      const { error } = await supabase
        .from("integrations")
        .update({ config: config as never })
        .eq("company_id", companyId)
        .eq("provider", "bitrix24");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration", "bitrix24"] });
      toast({ title: "Mapeamento salvo" });
    },
    onError: (error: Error) => {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    },
  });
}

export function useBitrix24Queue() {
  const { companyId } = useAuth();

  return useQuery({
    queryKey: ["bitrix24-queue", companyId],
    queryFn: async () => {
      if (!companyId) return { pending: 0, failed: 0, lastError: null as string | null };
      const { data, error } = await supabase
        .from("bitrix_sync_queue")
        .select("status, last_error, updated_at")
        .eq("company_id", companyId)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = data ?? [];
      return {
        pending: rows.filter((r) => r.status === "pending" || r.status === "running").length,
        failed: rows.filter((r) => r.status === "failed").length,
        lastError: rows.find((r) => r.last_error)?.last_error ?? null,
      };
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
  });
}
