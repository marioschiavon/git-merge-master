import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCadence, useCadenceSteps, useCadenceEnrollments, useUpsertStep, useDeleteStep, useEnrollLeads, useExecuteCadenceNow, useGenerateCadenceSteps, useResumeEnrollment } from "@/hooks/useCadences";
import { useLeads } from "@/hooks/usePipedrive";
import { CadenceStepCard } from "@/components/CadenceStepCard";
import { LeadMessagePreview } from "@/components/LeadMessagePreview";
import { CadenceFirstMessageInline } from "@/components/CadenceFirstMessageInline";
import { Plus, Users, ListOrdered, Wand2, Play, Loader2, RotateCcw, Sparkles, Brain } from "lucide-react";
import { AgenticPolicyForm } from "@/components/AgenticPolicyForm";
import { useAllAgentDecisions } from "@/hooks/useAgenticCadence";

const enrollmentStatusLabels: Record<string, string> = {
  active: "Ativo",
  completed: "Concluído",
  replied: "Respondeu",
  bounced: "Bounce",
  paused: "Pausado",
};

const channelIcons: Record<string, string> = {
  email: "📧",
  whatsapp: "📱",
  linkedin: "💼",
  multi_channel: "🔀",
};

interface CadenceDetailProps {
  cadenceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CadenceDetail({ cadenceId, open, onOpenChange }: CadenceDetailProps) {
  const { data: cadence } = useCadence(cadenceId);
  const { data: steps = [] } = useCadenceSteps(cadenceId);
  const { data: enrollments = [] } = useCadenceEnrollments(cadenceId);
  const upsertStep = useUpsertStep();
  const deleteStep = useDeleteStep();
  const enrollLeads = useEnrollLeads();
  const executeCadence = useExecuteCadenceNow();
  const generateSteps = useGenerateCadenceSteps();
  const resumeEnrollment = useResumeEnrollment();
  const { data: allLeads = [] } = useLeads({ status: "all", search: "" });
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [previewLead, setPreviewLead] = useState<{ id: string; name: string } | null>(null);

  if (!cadence) return null;

  const handleAddStep = () => {
    if (!cadenceId) return;
    const nextOrder = steps.length > 0 ? Math.max(...steps.map((s: any) => s.step_order)) + 1 : 1;
    upsertStep.mutate({
      cadence_id: cadenceId,
      step_order: nextOrder,
      channel: "email",
      template: "",
      delay_days: nextOrder === 1 ? 0 : 2,
    });
  };

  const handleEnroll = () => {
    if (!cadenceId || selectedLeadIds.length === 0) return;
    enrollLeads.mutate({ cadenceId, leadIds: selectedLeadIds });
    setSelectedLeadIds([]);
    setEnrollDialogOpen(false);
  };

  const enrolledLeadIds = new Set(enrollments.map((e: any) => e.lead_id));
  const availableLeads = allLeads.filter((l: any) => !enrolledLeadIds.has(l.id));

  const isAgentic = (cadence as any).mode === "agentic";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {cadence.name}
            {isAgentic && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Sparkles className="h-3 w-3" />IA
              </Badge>
            )}
          </SheetTitle>
          {cadence.description && (
            <p className="text-sm text-muted-foreground">{cadence.description}</p>
          )}
        </SheetHeader>

        <Tabs defaultValue={isAgentic ? "policy" : "steps"} className="mt-6">
          <TabsList className={`grid w-full ${isAgentic ? "grid-cols-3" : "grid-cols-2"}`}>
            {isAgentic ? (
              <TabsTrigger value="policy">
                <Sparkles className="mr-2 h-4 w-4" />Política
              </TabsTrigger>
            ) : (
              <TabsTrigger value="steps">
                <ListOrdered className="mr-2 h-4 w-4" />Steps ({steps.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="leads">
              <Users className="mr-2 h-4 w-4" />Leads ({enrollments.length})
            </TabsTrigger>
            {isAgentic && (
              <TabsTrigger value="decisions">
                <Brain className="mr-2 h-4 w-4" />Decisões
              </TabsTrigger>
            )}
          </TabsList>

          {isAgentic && cadenceId && (
            <TabsContent value="policy" className="mt-4">
              <AgenticPolicyForm cadenceId={cadenceId} />
            </TabsContent>
          )}

          {isAgentic && cadenceId && (
            <TabsContent value="decisions" className="mt-4">
              <AgentDecisionsList cadenceId={cadenceId} />
            </TabsContent>
          )}

          {!isAgentic && (
          <TabsContent value="steps" className="space-y-4 mt-4">
            {steps.length === 0 && (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground">Nenhum step configurado.</p>
                <Button
                  variant="default"
                  onClick={() => cadenceId && generateSteps.mutate(cadenceId)}
                  disabled={generateSteps.isPending}
                >
                  {generateSteps.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-4 w-4" />
                  )}
                  Gerar Cadência Multi-canal com IA
                </Button>
              </div>
            )}

            {steps.map((step: any) => (
              <div key={step.id} className="relative">
                <span className="absolute -left-2 top-2 text-xs">{channelIcons[step.channel] || "📧"}</span>
                <CadenceStepCard
                  step={step}
                  cadenceId={cadenceId!}
                  onUpsert={(s) => upsertStep.mutate(s)}
                  onDelete={(p) => deleteStep.mutate(p)}
                />
              </div>
            ))}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleAddStep}>
                <Plus className="mr-2 h-4 w-4" />Adicionar Step
              </Button>
              {steps.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => cadenceId && generateSteps.mutate(cadenceId)}
                  disabled={generateSteps.isPending}
                  title="Substituir steps por cadência multi-canal gerada com IA"
                >
                  {generateSteps.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
          </TabsContent>
          )}



          <TabsContent value="leads" className="space-y-4 mt-4">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEnrollDialogOpen(!enrollDialogOpen)}>
                <Plus className="mr-2 h-4 w-4" />Associar Leads
              </Button>
              {enrollments.length > 0 && (
                <Button
                  variant="default"
                  onClick={() => executeCadence.mutate()}
                  disabled={executeCadence.isPending}
                >
                  {executeCadence.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Executar Agora
                </Button>
              )}
            </div>

            {enrollDialogOpen && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <p className="text-sm font-medium">Selecione leads para associar:</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {availableLeads.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum lead disponível.</p>
                    ) : (
                      availableLeads.map((lead: any) => (
                        <label key={lead.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted p-1 rounded">
                          <input
                            type="checkbox"
                            checked={selectedLeadIds.includes(lead.id)}
                            onChange={(e) => {
                              setSelectedLeadIds((prev) =>
                                e.target.checked ? [...prev, lead.id] : prev.filter((id) => id !== lead.id)
                              );
                            }}
                          />
                          {lead.name} {lead.email && `(${lead.email})`}
                        </label>
                      ))
                    )}
                  </div>
                  <Button size="sm" onClick={handleEnroll} disabled={selectedLeadIds.length === 0 || enrollLeads.isPending}>
                    Associar {selectedLeadIds.length} lead(s)
                  </Button>
                </CardContent>
              </Card>
            )}

            {enrollments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhum lead associado a esta cadência.</p>
            ) : (
              <div className="space-y-2">
                {enrollments.map((e: any) => (
                  <Card key={e.id}>
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            className="text-sm font-medium text-left hover:underline hover:text-primary cursor-pointer"
                            onClick={() => setPreviewLead({ id: e.lead_id, name: e.leads?.name || "Lead" })}
                          >
                            {e.leads?.name || "Lead"}
                          </button>
                          <p className="text-xs text-muted-foreground truncate">{e.leads?.email || ""}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                          {e.meeting_scheduled && (
                            <Badge className="bg-green-100 text-green-800 text-xs">📅 Reunião</Badge>
                          )}
                          {e.status === "paused" && (e as any).paused_reason === "lead_replied" && (
                            <Badge className="bg-amber-100 text-amber-800 text-xs">💬 Lead respondeu</Badge>
                          )}
                          <Badge variant="outline" className="text-xs">Step {e.current_step}</Badge>
                          <Badge variant="secondary" className="text-xs">
                            {enrollmentStatusLabels[e.status] || e.status}
                          </Badge>
                          {e.status === "paused" && (e as any).paused_reason === "lead_replied" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => resumeEnrollment.mutate(e.id)}
                              disabled={resumeEnrollment.isPending}
                            >
                              <RotateCcw className="mr-1 h-3 w-3" />
                              Retomar
                            </Button>
                          )}
                          {e.next_execution_at && e.status === "active" && (
                            <span className="text-[10px] text-muted-foreground">
                              Próx: {new Date(e.next_execution_at).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </div>
                      </div>
                      {cadenceId && steps.length > 0 && (
                        <CadenceFirstMessageInline
                          cadenceId={cadenceId}
                          leadId={e.lead_id}
                          onEdit={() => setPreviewLead({ id: e.lead_id, name: e.leads?.name || "Lead" })}
                        />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>

      {previewLead && cadenceId && (
        <LeadMessagePreview
          cadenceId={cadenceId}
          leadId={previewLead.id}
          leadName={previewLead.name}
          open={!!previewLead}
          onOpenChange={(open) => !open && setPreviewLead(null)}
        />
      )}
    </Sheet>
  );
}
