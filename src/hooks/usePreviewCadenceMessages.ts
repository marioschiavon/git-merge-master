import { useMutation } from "@tanstack/react-query";
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
