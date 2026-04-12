import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Sparkles, RefreshCw, Mail, MessageSquare, Linkedin } from "lucide-react";
import { usePreviewCadenceMessages, StepPreview } from "@/hooks/usePreviewCadenceMessages";

const channelIcons: Record<string, React.ReactNode> = {
  email: <Mail className="h-4 w-4" />,
  whatsapp: <MessageSquare className="h-4 w-4" />,
  linkedin: <Linkedin className="h-4 w-4" />,
};

const channelLabels: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  multi_channel: "Multi-canal",
};

interface LeadMessagePreviewProps {
  cadenceId: string;
  leadId: string;
  leadName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadMessagePreview({ cadenceId, leadId, leadName, open, onOpenChange }: LeadMessagePreviewProps) {
  const preview = usePreviewCadenceMessages();
  const [editedPreviews, setEditedPreviews] = useState<StepPreview[]>([]);

  useEffect(() => {
    if (open && cadenceId && leadId) {
      preview.mutate({ cadenceId, leadId }, {
        onSuccess: (data) => setEditedPreviews(data.previews),
      });
    }
  }, [open, cadenceId, leadId]);

  const updatePreview = (index: number, field: "message" | "subject", value: string) => {
    setEditedPreviews((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const regenerateStep = (stepOrder: number) => {
    preview.mutate({ cadenceId, leadId }, {
      onSuccess: (data) => {
        const newStep = data.previews.find((p) => p.step_order === stepOrder);
        if (newStep) {
          setEditedPreviews((prev) =>
            prev.map((p) => (p.step_order === stepOrder ? newStep : p))
          );
        }
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview de Mensagens — {leadName}</DialogTitle>
        </DialogHeader>

        {preview.isPending && editedPreviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Gerando mensagens personalizadas com IA...</p>
          </div>
        ) : preview.isError ? (
          <div className="text-center py-8">
            <p className="text-sm text-destructive mb-2">Erro ao gerar preview</p>
            <Button variant="outline" size="sm" onClick={() => preview.mutate({ cadenceId, leadId }, { onSuccess: (d) => setEditedPreviews(d.previews) })}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            {editedPreviews.map((step, idx) => (
              <Card key={step.step_id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {channelIcons[step.channel] || channelIcons.email}
                      <span className="text-sm font-medium">
                        Step {step.step_order} — {channelLabels[step.channel] || step.channel}
                      </span>
                      {step.delay_days > 0 && (
                        <Badge variant="outline" className="text-xs">+{step.delay_days}d</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {step.smart_customization && (
                        <Badge className="bg-purple-100 text-purple-800 text-xs gap-1">
                          <Sparkles className="h-3 w-3" />
                          Customizado com IA
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => regenerateStep(step.step_order)}
                        disabled={preview.isPending}
                      >
                        <RefreshCw className={`h-3 w-3 ${preview.isPending ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  </div>

                  {step.channel === "email" && (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Assunto</label>
                      <Input
                        value={step.subject || ""}
                        onChange={(e) => updatePreview(idx, "subject", e.target.value)}
                        placeholder="Assunto do email"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Mensagem</label>
                    <Textarea
                      value={step.message}
                      onChange={(e) => updatePreview(idx, "message", e.target.value)}
                      rows={4}
                    />
                  </div>

                  {step.smart_customization && step.template_original && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer hover:text-foreground">Ver template original</summary>
                      <pre className="mt-1 p-2 bg-muted rounded text-xs whitespace-pre-wrap">{step.template_original}</pre>
                    </details>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
