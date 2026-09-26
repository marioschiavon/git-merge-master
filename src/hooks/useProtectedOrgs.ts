import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type ProtectedReason = "cliente" | "em_negociacao" | "nao_contatar" | "outro";

export const PROTECTED_REASON_LABELS: Record<ProtectedReason, string> = {
  cliente: "Cliente",
  em_negociacao: "Em negociação",
  nao_contatar: "Pediu para não contatar",
  outro: "Outro",
};

export interface ProtectedOrg {
  id: string;
  kind: "municipio" | "empresa";
  label: string;
  city: string | null;
  state: string | null;
  domain: string | null;
  reason: ProtectedReason;
  note: string | null;
  source: "manual" | "auto";
  created_at: string;
}

// Tabela nova: tipagem gerada pode ainda não conhecer, então usamos um cliente solto.
const db = supabase as any;

export function useProtectedOrgs() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["protected-orgs", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await db
        .from("protected_organizations")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProtectedOrg[];
    },
  });
}

/** Mapa lead_id → organização protegida (para o selo "Protegido"). */
export function useProtectedLeadMap() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["protected-lead-ids", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await db.rpc("protected_lead_ids", { _company_id: companyId });
      const map = new Map<string, { label: string; reason: ProtectedReason }>();
      for (const r of (data ?? []) as any[]) map.set(r.lead_id, { label: r.label, reason: r.reason });
      return map;
    },
  });
}

export interface ProtectedOrgInput {
  kind: "municipio" | "empresa";
  label: string;
  city?: string | null;
  state?: string | null;
  domain?: string | null;
  reason: ProtectedReason;
  note?: string | null;
  lead_id?: string | null;
}

export function useSaveProtectedOrg() {
  const { companyId, user } = useAuth() as any;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProtectedOrgInput & { id?: string }) => {
      const { id, ...rest } = input;
      if (id) {
        const { error } = await db.from("protected_organizations").update(rest).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("protected_organizations")
          .insert({ ...rest, company_id: companyId, created_by: user?.id ?? null, source: "manual" });
        if (error) {
          if (error.code === "23505") throw new Error("Essa organização já está na lista.");
          throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["protected-orgs"] });
      qc.invalidateQueries({ queryKey: ["protected-lead-ids"] });
    },
  });
}

export function useDeleteProtectedOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("protected_organizations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["protected-orgs"] });
      qc.invalidateQueries({ queryKey: ["protected-lead-ids"] });
    },
  });
}

/** Monta a entrada de proteção a partir de um lead. */
export function protectedInputFromLead(lead: {
  id: string; city?: string | null; state?: string | null; company_name?: string | null;
  website?: string | null; email?: string | null; source?: string | null;
}): ProtectedOrgInput | null {
  const isMuni = !!lead.city && !!lead.state &&
    (lead.source === "municipia" || /^(prefeitura|c[aâ]mara)/i.test(lead.company_name ?? ""));
  if (isMuni) {
    return { kind: "municipio", label: `${lead.city} / ${lead.state!.toUpperCase()}`, city: lead.city, state: lead.state, reason: "cliente", lead_id: lead.id };
  }
  let domain: string | null = null;
  if (lead.website) domain = lead.website;
  else if (lead.email?.includes("@")) {
    const d = lead.email.split("@")[1].toLowerCase();
    if (!/^(gmail|hotmail|outlook|yahoo|live|icloud|bol|uol|terra|ig|msn)\./.test(d)) domain = d;
  }
  const label = lead.company_name || domain;
  if (!label) return null;
  return { kind: "empresa", label, domain, reason: "cliente", lead_id: lead.id };
}
