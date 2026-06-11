import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useToggleSimulation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ cadenceId, enabled }: { cadenceId: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("cadences")
        .update({ simulation_mode: enabled } as any)
        .eq("id", cadenceId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cadences"] });
      qc.invalidateQueries({ queryKey: ["cadence"] });
      toast.success("Modo simulação atualizado");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useRunNextStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      // Force immediate execution by clearing next_execution_at and last_executed_at
      await supabase
        .from("cadence_enrollments")
        .update({ next_execution_at: new Date(Date.now() - 60000).toISOString() })
        .eq("id", enrollmentId);
      const { data, error } = await supabase.functions.invoke("cadence-agent-decide", {
        body: { enrollment_id: enrollmentId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["agent_decisions_cadence"] });
      qc.invalidateQueries({ queryKey: ["cadence_enrollments"] });
      const a = data?.decision?.action || data?.action;
      toast.success(`Passo executado: ${a || "ok"}`);
    },
    onError: (e: any) => toast.error(`Falha ao executar passo: ${e.message}`),
  });
}

export function useSimulateReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ enrollmentId, replyText, channel }: { enrollmentId: string; replyText: string; channel?: string }) => {
      const { data, error } = await supabase.functions.invoke("cadence-simulate-reply", {
        body: { enrollment_id: enrollmentId, reply_text: replyText, channel },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["agent_decisions_cadence"] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["messages"] });
      qc.invalidateQueries({ queryKey: ["lead-messages"] });
      const parts = [`Resposta simulada${data?.intent ? ` (intent: ${data.intent})` : ""}`];
      if (data?.reply_text) parts.push("IA respondeu na conversa");
      toast.success(parts.join(" — "));
    },
    onError: (e: any) => toast.error(`Falha: ${e.message}`),
  });
}
