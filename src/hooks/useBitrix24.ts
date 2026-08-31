import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

export type BitrixEntity = "deal" | "contact";

export interface BitrixFieldTarget {
  entity: BitrixEntity;
  field: string;
}

export interface Bitrix24Config {
  user_id?: string | null;
  category_id?: string | null;
  stage_created?: string | null;
  stage_handoff?: string | null;
  source_id?: string | null;
  /** Formato antigo (string) é lido como campo de Negócio. */
  field_map?: Record<string, string | BitrixFieldTarget>;
}

export interface BitrixFieldDef {
  code: string;
  label: string;
  type: string;
  required?: boolean;
}

export interface Bitrix24Discovery {
  portal: string;
  category_id: string;
  categories: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string }>;
  deal: BitrixFieldDef[];
  contact: BitrixFieldDef[];
}

/** Normaliza o de/para salvo, aceitando o formato antigo. */
export function normalizeFieldMap(
  raw: Record<string, string | BitrixFieldTarget> | null | undefined,
): Record<string, BitrixFieldTarget> {
  const out: Record<string, BitrixFieldTarget> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!value) continue;
    if (typeof value === "string") out[key] = { entity: "deal", field: value };
    else if (value.field) {
      out[key] = { entity: value.entity === "contact" ? "contact" : "deal", field: value.field };
    }
  }
  return out;
}

/** Campos do Leaderei disponíveis no de/para (existem na tabela leads). */
export const BITRIX_LEAD_FIELDS: Array<{ key: string; label: string; entity: BitrixEntity }> = [
  { key: "name", label: "Nome", entity: "contact" },
  { key: "email", label: "E-mail", entity: "contact" },
  { key: "phone", label: "Telefone", entity: "contact" },
  { key: "whatsapp", label: "WhatsApp", entity: "contact" },
  { key: "title", label: "Cargo", entity: "contact" },
  { key: "company_name", label: "Empresa", entity: "deal" },
  { key: "website", label: "Site", entity: "deal" },
  { key: "address", label: "Endereço", entity: "deal" },
  { key: "source", label: "Origem", entity: "deal" },
  { key: "status", label: "Status", entity: "deal" },
  { key: "score", label: "Score", entity: "deal" },
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
