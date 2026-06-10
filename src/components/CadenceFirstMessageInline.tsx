import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, RefreshCw, Mail, MessageSquare, Linkedin, Check, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { useFirstStepPreview } from "@/hooks/usePreviewCadenceMessages";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const channelIcons: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  whatsapp: <MessageSquare className="h-3.5 w-3.5" />,
  linkedin: <Linkedin className="h-3.5 w-3.5" />,
};

interface Props {
  cadenceId: string;
  leadId: string;
  onEdit: () => void;
}

export function CadenceFirstMessageInline({ cadenceId, leadId, onEdit }: Props) {
  const qc = useQueryClient();
  const { data: step, isLoading, isError, refetch } = useFirstStepPreview(cadenceId, leadId);
  const [expanded, setExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("preview-cadence-messages", {
        body: { cadence_id: cadenceId, lead_id: leadId, only_first_step: true, force_regenerate: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const newStep = (data?.previews || [])[0] || null;
      qc.setQueryData(["first_step_preview", cadenceId, leadId], newStep);
      toast.success("Mensagem regenerada");
    } catch (e: any) {
      toast.error(e.message || "Erro ao regenerar");
    } finally {
      setRegenerating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Gerando 1ª mensagem...
      </div>
    );
  }

  if (isError || !step) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Sem preview disponível.</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const message = step.message || "";
  const preview = message.length > 180 ? message.slice(0, 180) + "…" : message;

  return (
    <div className="mt-2 rounded-md border bg-muted/30 p-2.5 text-xs space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="flex items-center gap-1 text-muted-foreground">
          {channelIcons[step.channel] || channelIcons.email}
          <span className="capitalize">{step.channel}</span>
        </span>
        {step.is_saved && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1 border-green-300 text-green-700">
            <Check className="h-2.5 w-2.5" /> Salva
          </Badge>
        )}
        {step.smart_customization && (
          <Badge className="h-5 px-1.5 text-[10px] gap-1 bg-purple-100 text-purple-800 hover:bg-purple-100">
            <Sparkles className="h-2.5 w-2.5" /> IA
          </Badge>
        )}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={handleRegenerate} disabled={regenerating} title="Regenerar">
            <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={onEdit} title="Editar e ver todas as steps">
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {step.channel === "email" && step.subject && (
        <div className="text-foreground">
          <span className="text-muted-foreground">Assunto: </span>
          <span className="font-medium">{step.subject}</span>
        </div>
      )}
      <div className="text-foreground whitespace-pre-wrap leading-relaxed">
        {expanded ? message : preview}
      </div>
      {message.length > 180 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          {expanded ? <><ChevronUp className="h-3 w-3" /> Recolher</> : <><ChevronDown className="h-3 w-3" /> Ver completa</>}
        </button>
      )}
    </div>
  );
}
