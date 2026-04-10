import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

type Cadence = Tables<"cadences">;
type CadenceStep = Tables<"cadence_steps">;
type CadenceEnrollment = Tables<"cadence_enrollments">;

export function useCadences() {
  const { companyId } = useAuth();
  return useQuery({
    queryKey: ["cadences", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("cadences")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Cadence[];
    },
    enabled: !!companyId,
  });
}

export function useCadence(id: string | null) {
  return useQuery({
    queryKey: ["cadence", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("cadences")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Cadence | null;
    },
    enabled: !!id,
  });
}

export function useCadenceSteps(cadenceId: string | null) {
  return useQuery({
    queryKey: ["cadence_steps", cadenceId],
    queryFn: async () => {
      if (!cadenceId) return [];
      const { data, error } = await supabase
        .from("cadence_steps")
        .select("*")
        .eq("cadence_id", cadenceId)
        .order("step_order", { ascending: true });
      if (error) throw error;
      return data as CadenceStep[];
    },
    enabled: !!cadenceId,
  });
}

export function useCadenceEnrollments(cadenceId: string | null) {
  return useQuery({
    queryKey: ["cadence_enrollments", cadenceId],
    queryFn: async () => {
      if (!cadenceId) return [];
      const { data, error } = await supabase
        .from("cadence_enrollments")
        .select("*, leads(name, email, company_name, status)")
        .eq("cadence_id", cadenceId)
        .order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!cadenceId,
  });
}

export function useCreateCadence() {
  const qc = useQueryClient();
  const { companyId, user } = useAuth();
  return useMutation({
    mutationFn: async (values: { name: string; description?: string; type: string }) => {
      if (!companyId || !user) throw new Error("Sem empresa vinculada");
      const { data, error } = await supabase
        .from("cadences")
        .insert({
          company_id: companyId,
          name: values.name,
          description: values.description || null,
          type: values.type as any,
          created_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cadences"] });
      toast.success("Cadência criada com sucesso!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpdateCadence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: { id: string; name?: string; description?: string; type?: string; status?: string }) => {
      const { error } = await supabase
        .from("cadences")
        .update(values as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cadences"] });
      qc.invalidateQueries({ queryKey: ["cadence"] });
      toast.success("Cadência atualizada!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteCadence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cadences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cadences"] });
      toast.success("Cadência excluída!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useUpsertStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (step: TablesInsert<"cadence_steps">) => {
      const { data, error } = await supabase
        .from("cadence_steps")
        .upsert(step)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["cadence_steps", vars.cadence_id] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useDeleteStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, cadenceId }: { id: string; cadenceId: string }) => {
      const { error } = await supabase.from("cadence_steps").delete().eq("id", id);
      if (error) throw error;
      return cadenceId;
    },
    onSuccess: (cadenceId) => {
      qc.invalidateQueries({ queryKey: ["cadence_steps", cadenceId] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useEnrollLeads() {
  const qc = useQueryClient();
  const { companyId } = useAuth();
  return useMutation({
    mutationFn: async ({ cadenceId, leadIds }: { cadenceId: string; leadIds: string[] }) => {
      if (!companyId) throw new Error("Sem empresa vinculada");

      // Get first step delay
      const { data: steps } = await supabase
        .from("cadence_steps")
        .select("delay_days")
        .eq("cadence_id", cadenceId)
        .order("step_order", { ascending: true })
        .limit(1);

      const firstDelay = steps?.[0]?.delay_days ?? 0;
      const nextExec = new Date();
      nextExec.setDate(nextExec.getDate() + firstDelay);

      const rows = leadIds.map((lead_id) => ({
        cadence_id: cadenceId,
        lead_id,
        company_id: companyId,
        next_execution_at: nextExec.toISOString(),
      }));
      const { error } = await supabase.from("cadence_enrollments").upsert(rows, { onConflict: "cadence_id,lead_id" });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["cadence_enrollments", vars.cadenceId] });
      toast.success("Leads associados à cadência!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useExecutionLogs(enrollmentId: string | null) {
  return useQuery({
    queryKey: ["execution_logs", enrollmentId],
    queryFn: async () => {
      if (!enrollmentId) return [];
      const { data, error } = await supabase
        .from("execution_logs")
        .select("*")
        .eq("enrollment_id", enrollmentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!enrollmentId,
  });
}

export function useResetEnrollment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { error } = await supabase
        .from("cadence_enrollments")
        .update({
          status: "active" as any,
          current_step: 1,
          next_execution_at: new Date().toISOString(),
          completed_at: null,
          last_executed_at: null,
        })
        .eq("id", enrollmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cadence_enrollments"] });
      toast.success("Enrollment resetado! Clique 'Executar Agora' para re-testar.");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useExecuteCadenceNow() {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("cadence-executor");
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(`Executado! ${data?.processed || 0} enrollment(s) processados.`);
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useGenerateCadenceSteps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cadenceId: string) => {
      const steps = [
        { cadence_id: cadenceId, step_order: 1, channel: "email" as const, template: "Primeiro contato por email. Apresente brevemente a solução e proponha uma conversa.", delay_days: 0, subject: "Apresentação" },
        { cadence_id: cadenceId, step_order: 2, channel: "email" as const, template: "Follow-up do primeiro email. Reforce o valor e pergunte se faz sentido conversar.", delay_days: 3, subject: "Follow-up" },
        { cadence_id: cadenceId, step_order: 3, channel: "whatsapp" as const, template: "Mensagem curta e informal no WhatsApp. Mencione que enviou email e pergunte se viu.", delay_days: 5 },
        { cadence_id: cadenceId, step_order: 4, channel: "email" as const, template: "Último email. Use urgência sutil, ofereça horários específicos para reunião.", delay_days: 7, subject: "Última tentativa" },
        { cadence_id: cadenceId, step_order: 5, channel: "linkedin" as const, template: "Conexão no LinkedIn. Mensagem profissional mencionando os contatos anteriores.", delay_days: 10 },
      ];

      // Delete existing steps first
      await supabase.from("cadence_steps").delete().eq("cadence_id", cadenceId);

      const { error } = await supabase.from("cadence_steps").insert(steps);
      if (error) throw error;
    },
    onSuccess: (_, cadenceId) => {
      qc.invalidateQueries({ queryKey: ["cadence_steps", cadenceId] });
      toast.success("5 steps multi-canal gerados com sucesso!");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
