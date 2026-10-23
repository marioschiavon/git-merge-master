import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

export type PipedriveEntity = "deal" | "person";
export interface PipedriveFieldTarget { entity: PipedriveEntity; field: string }

export interface PipedrivePushConfig {
  push_enabled?: boolean;
  pipeline_id?: string | null;
  stage_created?: string | null;
  stage_replied?: string | null;
  stage_meeting?: string | null;
  stage_handoff?: string | null;
  owner_id?: string | null;
  field_map?: Record<string, PipedriveFieldTarget>;
}

export interface PipedriveFieldDef { code: string; label: string; type: string }
export interface PipedriveDiscovery {
  pipelines: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string; pipeline_id: string; order: number }>;
  users: Array<{ id: string; name: string }>;
  person: PipedriveFieldDef[];
  deal: PipedriveFieldDef[];
}

export const PIPEDRIVE_LEAD_FIELDS: Array<{ key: string; label: string; entity: PipedriveEntity }> = [
  { key: "title", label: "Cargo", entity: "person" },
  { key: "linkedin_url", label: "LinkedIn", entity: "person" },
  { key: "city", label: "Cidade", entity: "person" },
  { key: "company_name", label: "Empresa", entity: "deal" },
  { key: "website", label: "Site", entity: "deal" },
  { key: "address", label: "Endereço", entity: "deal" },
  { key: "source", label: "Origem", entity: "deal" },
  { key: "score", label: "Score", entity: "deal" },
];

export function useDiscoverPipedrive(enabled: boolean) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["pipedrive-discover", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("pipedrive-discover", { body: { company_id: companyId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as PipedriveDiscovery;
    },
    enabled: !!companyId && enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSavePipedrivePushConfig() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async (config: PipedrivePushConfig) => {
      if (!companyId) throw new Error("Empresa não identificada");
      const { error } = await supabase.from("integrations").update({ config: config as never })
        .eq("company_id", companyId).eq("provider", "pipedrive");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integration", "pipedrive"] });
      toast({ title: "Configuração do envio salva" });
    },
    onError: (e: Error) => toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });
}

export function usePipedriveQueue(enabled: boolean) {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["pipedrive-queue", companyId],
    queryFn: async () => {
      const [{ data, error }, { count }] = await Promise.all([
        supabase.from("pipedrive_sync_queue").select("status, last_error, updated_at")
          .eq("company_id", companyId!).order("updated_at", { ascending: false }).limit(200),
        supabase.from("pipedrive_deals").select("id", { count: "exact", head: true }).eq("company_id", companyId!),
      ]);
      if (error) throw error;
      const rows = data ?? [];
      return {
        deals: count ?? 0,
        pending: rows.filter((r) => r.status === "pending" || r.status === "running").length,
        failed: rows.filter((r) => r.status === "failed").length,
        lastError: rows.find((r) => r.status === "failed" || r.status === "skipped")?.last_error ?? null,
      };
    },
    enabled: !!companyId && enabled,
    refetchInterval: 30_000,
  });
}

export function useRetryPipedriveFailed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("retry_pipedrive_failed");
      if (error) throw error;
      return data as number;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["pipedrive-queue"] });
      toast({ title: "Reenvio agendado", description: `${n} item(ns) voltaram para a fila.` });
    },
    onError: (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });
}
