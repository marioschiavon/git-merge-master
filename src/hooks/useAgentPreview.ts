import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AgentDecisionPreview {
  action: "send" | "wait" | "stop" | "handoff_human";
  channel?: "whatsapp" | "email" | null;
  hook?: string | null;
  subject?: string | null;
  message?: string | null;
  rationale: string;
  stop_reason?: string | null;
  scheduled_for?: string | null;
}

async function fetchPreview(enrollmentId: string): Promise<AgentDecisionPreview | null> {
  const { data, error } = await supabase.functions.invoke("cadence-agent-decide", {
    body: { enrollment_id: enrollmentId, dry_run: true },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.decision as AgentDecisionPreview) || null;
}

export function useAgentNextPreview(enrollmentId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["agent_next_preview", enrollmentId],
    enabled: !!enrollmentId && enabled,
    staleTime: 1000 * 60 * 5,
    queryFn: () => fetchPreview(enrollmentId!),
  });
}

export function useRegenerateAgentPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      const decision = await fetchPreview(enrollmentId);
      qc.setQueryData(["agent_next_preview", enrollmentId], decision);
      return decision;
    },
    onSuccess: () => toast.success("Prévia regenerada"),
    onError: (e: any) => toast.error(`Falha ao gerar prévia: ${e.message}`),
  });
}
