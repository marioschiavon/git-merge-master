import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StepPreview {
  step_order: number;
  step_id: string;
  channel: string;
  delay_days: number;
  smart_customization: boolean;
  subject: string | null;
  message: string;
  template_original: string;
  is_saved?: boolean;
}

export function usePreviewCadenceMessages() {
  return useMutation({
    mutationFn: async ({ cadenceId, leadId, forceRegenerate }: { cadenceId: string; leadId: string; forceRegenerate?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("preview-cadence-messages", {
        body: { cadence_id: cadenceId, lead_id: leadId, force_regenerate: forceRegenerate || false },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { previews: StepPreview[]; lead: any };
    },
  });
}

export function useFirstStepPreview(cadenceId: string | null, leadId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["first_step_preview", cadenceId, leadId],
    enabled: !!cadenceId && !!leadId && enabled,
    staleTime: 1000 * 60 * 60, // 1h
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("preview-cadence-messages", {
        body: { cadence_id: cadenceId, lead_id: leadId, only_first_step: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const previews = (data?.previews || []) as StepPreview[];
      return previews[0] || null;
    },
  });
}
