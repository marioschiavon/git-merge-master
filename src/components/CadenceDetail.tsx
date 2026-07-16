import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCadence, useCadenceSteps, useCadenceEnrollments, useUpsertStep, useDeleteStep, useEnrollLeads, useExecuteCadenceNow, useGenerateCadenceSteps, useResumeEnrollment, useUpdateCadence } from "@/hooks/useCadences";
import { useLeads } from "@/hooks/usePipedrive";
import { CadenceStepCard } from "@/components/CadenceStepCard";
import { LeadMessagePreview } from "@/components/LeadMessagePreview";
import { CadenceFirstMessageInline } from "@/components/CadenceFirstMessageInline";
import { Plus, Users, ListOrdered, Wand2, Play, Loader2, RotateCcw, Sparkles, Brain, FlaskConical, Send, RefreshCw, ChevronDown, ChevronUp, Mail, MessageSquare, Eye } from "lucide-react";
import { AgenticPolicyForm } from "@/components/AgenticPolicyForm";
import { useAllAgentDecisions } from "@/hooks/useAgenticCadence";
import { useToggleSimulation, useRunNextStep, useSimulateReply } from "@/hooks/useSimulateCadence";
import { useAgentNextPreview, useRegenerateAgentPreview } from "@/hooks/useAgentPreview";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ChannelBadges } from "@/components/lead/ChannelBadges";
import { Label } from "@/components/ui/label";

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
  const updateCadence = useUpdateCadence();
  const { data: allLeads = [] } = useLeads({ status: "all", search: "" });
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [previewLead, setPreviewLead] = useState<{ id: string; name: string } | null>(null);
  const toggleSimulation = useToggleSimulation();

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
  const cadenceType = (cadence as any).type as string | undefined;
  const leadHasChannel = (l: any) => {
    if (cadenceType === "whatsapp") return !!(l.whatsapp || l.phone);
    if (cadenceType === "email") return !!l.email;
    return !!(l.email || l.whatsapp || l.phone);
  };
  const availableLeads = allLeads.filter((l: any) => !enrolledLeadIds.has(l.id) && leadHasChannel(l));
  const filteredOutCount = allLeads.filter((l: any) => !enrolledLeadIds.has(l.id) && !leadHasChannel(l)).length;

  const isAgentic = (cadence as any).mode === "agentic";
  const isSimulation = !!(cadence as any).simulation_mode;
  const isReferral = (cadence as any).kind === "referral";

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
            {isSimulation && (
              <Badge className="bg-amber-100 text-amber-800 text-xs gap-1">
                <FlaskConical className="h-3 w-3" />Simulação
              </Badge>
            )}
            {isReferral && (
              <Badge className="bg-purple-100 text-purple-800 text-xs">
                Indicações
              </Badge>
            )}
          </SheetTitle>
          {cadence.description && (
            <p className="text-sm text-muted-foreground">{cadence.description}</p>
          )}
        </SheetHeader>

        {isAgentic && cadenceId && (
          <div className={`mt-4 rounded-md border p-3 flex items-center justify-between gap-3 ${isSimulation ? "border-amber-300 bg-amber-50" : "border-border bg-muted/30"}`}>
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-2">
                <FlaskConical className="h-4 w-4" />
                Modo simulação (dry-run)
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isSimulation
                  ? "Ligado: a IA gera decisões e mensagens, mas NADA é enviado. Use os botões em cada lead para avançar passos e simular respostas."
                  : "Desligado: a IA envia mensagens reais nos canais configurados."}
              </p>
            </div>
            <Switch
              checked={isSimulation}
              onCheckedChange={(v) => toggleSimulation.mutate({ cadenceId, enabled: v })}
              disabled={toggleSimulation.isPending}
            />
          </div>
        )}

        {cadenceId && (
          <div className="mt-3 rounded-md border p-3 flex items-center justify-between gap-3 border-border bg-muted/30">
            <div className="flex-1">
              <div className="text-sm font-medium">Cadência de indicações (referral)</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quando ligado, esta cadência é usada automaticamente para leads criados por indicação.
                Você pode usar <code>{"{{referrer_name}}"}</code> e <code>{"{{referral_context}}"}</code> nos templates.
              </p>
            </div>
            <Switch
              checked={isReferral}
              onCheckedChange={(v) => updateCadence.mutate({ id: cadenceId, kind: v ? "referral" : "outbound" })}
              disabled={updateCadence.isPending}
            />
          </div>
        )}

        {cadenceId && cadence && (
          <div className="mt-3 rounded-md border p-3 flex items-start justify-between gap-3 border-amber-200 bg-amber-50/50">
            <div className="flex-1">
              <div className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-600" />
                Modo full-auto (1ª mensagem)
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quando ligado, a 1ª mensagem gerada pela IA é auto-aprovada e segue para o envio sem revisão humana, respeitando o limite diário.
              </p>
              {(cadence as any).auto_approve_first_message && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <Label className="text-xs">Limite diário:</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    className="h-7 w-24"
                    defaultValue={(cadence as any).auto_approve_max_per_day ?? 50}
                    onBlur={(e) => updateCadence.mutate({ id: cadenceId, auto_approve_max_per_day: Number(e.target.value || 50) } as any)}
                  />
                  <span className="text-muted-foreground">leads/dia</span>
                </div>
              )}
            </div>
            <Switch
              checked={!!(cadence as any).auto_approve_first_message}
              onCheckedChange={(v) => updateCadence.mutate({ id: cadenceId, auto_approve_first_message: v } as any)}
              disabled={updateCadence.isPending}
            />
          </div>
        )}





        <Tabs defaultValue={isAgentic ? "policy" : "steps"} className="mt-6">
          <TabsList className={`grid w-full ${isAgentic ? "grid-cols-4" : "grid-cols-3"}`}>
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
            <TabsTrigger value="settings">
              <RotateCcw className="mr-2 h-4 w-4" />Config
            </TabsTrigger>
          </TabsList>

          {cadenceId && (
            <TabsContent value="settings" className="mt-4">
              <ReengageSettings cadence={cadence} onSave={(v) => updateCadence.mutate({ id: cadenceId, ...v })} saving={updateCadence.isPending} />
            </TabsContent>
          )}

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
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Selecione leads para associar:</p>
                    {filteredOutCount > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        {filteredOutCount} lead(s) ocultos por não terem {cadenceType === "whatsapp" ? "WhatsApp" : cadenceType === "email" ? "e-mail" : "canal"}
                      </span>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {availableLeads.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhum lead disponível com {cadenceType === "whatsapp" ? "WhatsApp" : cadenceType === "email" ? "e-mail" : "canal válido"}.</p>
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
                          <span>{lead.name}</span>
                          <ChannelBadges lead={lead} />
                          {lead.email && <span className="text-xs text-muted-foreground">({lead.email})</span>}
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
                      {cadenceId && steps.length > 0 && !isAgentic && (
                        <CadenceFirstMessageInline
                          cadenceId={cadenceId}
                          leadId={e.lead_id}
                          onEdit={() => setPreviewLead({ id: e.lead_id, name: e.leads?.name || "Lead" })}
                        />
                      )}
                      {isAgentic && (
                        <AgenticSimulationControls
                          enrollmentId={e.id}
                          simulationEnabled={isSimulation}
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

const actionLabels: Record<string, { label: string; cls: string }> = {
  send: { label: "Enviou", cls: "bg-blue-100 text-blue-800" },
  wait: { label: "Aguardar", cls: "bg-gray-100 text-gray-700" },
  stop: { label: "Encerrou", cls: "bg-red-100 text-red-800" },
  handoff_human: { label: "Handoff", cls: "bg-amber-100 text-amber-800" },
};

function AgentDecisionsList({ cadenceId }: { cadenceId: string }) {
  const { data: decisions = [], isLoading } = useAllAgentDecisions(cadenceId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (decisions.length === 0)
    return <p className="text-sm text-muted-foreground text-center py-4">A IA ainda não tomou nenhuma decisão para esta cadência.</p>;
  return (
    <div className="space-y-2">
      {decisions.map((d: any) => {
        const meta = actionLabels[d.action] || { label: d.action, cls: "bg-muted" };
        return (
          <Card key={d.id}>
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{d.lead_name}</span>
                  <Badge className={`text-xs ${meta.cls}`} variant="secondary">{meta.label}</Badge>
                  {d.channel && <Badge variant="outline" className="text-xs">{d.channel}</Badge>}
                  {d.hook && <Badge variant="outline" className="text-xs">{d.hook}</Badge>}
                  <Badge variant="outline" className="text-xs">tentativa {d.attempt_number}</Badge>
                  {d.simulated && (
                    <Badge className="bg-amber-100 text-amber-800 text-xs gap-1">
                      <FlaskConical className="h-3 w-3" />Simulação
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(d.decided_at).toLocaleString("pt-BR")}
                </span>
              </div>
              {d.rationale && <p className="text-xs text-muted-foreground italic">"{d.rationale}"</p>}
              {d.message_body && (
                <div className="text-xs bg-muted/50 rounded p-2 mt-1 whitespace-pre-wrap">
                  {d.message_subject && <div className="font-medium mb-1">{d.message_subject}</div>}
                  {d.message_body}
                </div>
              )}
              {d.stop_reason && (
                <p className="text-xs"><span className="font-medium">Motivo:</span> {d.stop_reason}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

interface EditableDraft {
  action: "send" | "wait" | "stop" | "handoff_human";
  channel?: string | null;
  hook?: string | null;
  subject: string;
  message: string;
  rationale: string;
  originalMessage: string;
  originalSubject: string;
}

function AgentNextPreview({
  enrollmentId,
  draft,
  onDraftChange,
}: {
  enrollmentId: string;
  draft: EditableDraft | null;
  onDraftChange: (d: EditableDraft | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { data, isLoading, isError, refetch } = useAgentNextPreview(enrollmentId, open);
  const regen = useRegenerateAgentPreview();

  // Sync incoming AI decision into editable draft when a new preview arrives.
  useEffect(() => {
    if (data && (!draft || draft.originalMessage !== (data.message || ""))) {
      onDraftChange({
        action: data.action,
        channel: data.channel ?? null,
        hook: data.hook ?? null,
        subject: data.subject ?? "",
        message: data.message ?? "",
        rationale: data.rationale,
        originalMessage: data.message ?? "",
        originalSubject: data.subject ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const channel = draft?.channel ?? data?.channel;
  const channelIcon = channel === "whatsapp"
    ? <MessageSquare className="h-3 w-3" />
    : <Mail className="h-3 w-3" />;

  const isEdited = !!draft && (
    draft.message !== draft.originalMessage ||
    draft.subject !== draft.originalSubject
  );

  const restoreOriginal = () => {
    if (!draft) return;
    onDraftChange({ ...draft, message: draft.originalMessage, subject: draft.originalSubject });
  };

  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-2 space-y-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-foreground w-full"
      >
        <Eye className="h-3 w-3" />
        Prévia da próxima abordagem (IA) — editável
        {isEdited && (
          <Badge variant="outline" className="h-4 px-1.5 text-[9px] bg-blue-50 text-blue-700 border-blue-200">
            editado
          </Badge>
        )}
        {open ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>
      {open && (
        <>
          {isLoading || regen.isPending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Gerando prévia...
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-destructive">Falha ao gerar prévia.</span>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => refetch()}>
                Tentar de novo
              </Button>
            </div>
          ) : draft ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1">
                  {channelIcon}
                  <span className="capitalize">{channel || "—"}</span>
                </Badge>
                {draft.hook && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{draft.hook}</Badge>
                )}
                <Badge className="h-5 px-1.5 text-[10px] gap-1 bg-purple-100 text-purple-800 hover:bg-purple-100">
                  <Sparkles className="h-2.5 w-2.5" /> {draft.action}
                </Badge>
                {isEdited && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px] ml-auto"
                    onClick={restoreOriginal}
                    title="Restaurar texto original da IA"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" /> Restaurar
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className={`h-6 px-1.5 ${isEdited ? "" : "ml-auto"}`}
                  onClick={() => {
                    onDraftChange(null);
                    regen.mutate(enrollmentId);
                  }}
                  disabled={regen.isPending}
                  title="Regenerar prévia (descarta edições)"
                >
                  <RefreshCw className={`h-3 w-3 ${regen.isPending ? "animate-spin" : ""}`} />
                </Button>
              </div>
              {draft.action === "send" ? (
                <>
                  {channel === "email" && (
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Assunto</label>
                      <Input
                        value={draft.subject}
                        onChange={(e) => onDraftChange({ ...draft, subject: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground">Mensagem</label>
                    <Textarea
                      value={draft.message}
                      onChange={(e) => onDraftChange({ ...draft, message: e.target.value })}
                      rows={expanded || draft.message.length > 220 ? 8 : 5}
                      className="text-xs leading-relaxed"
                    />
                    {draft.message.length > 220 && (
                      <button
                        onClick={() => setExpanded((v) => !v)}
                        className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        {expanded ? <><ChevronUp className="h-3 w-3" /> Recolher</> : <><ChevronDown className="h-3 w-3" /> Expandir</>}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Motivo:</span> {draft.rationale}
                </div>
              )}
              <p className="text-[10px] text-muted-foreground italic">
                Este texto será exatamente o enviado ao clicar em "Executar próximo passo".
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sem prévia disponível.</p>
          )}
        </>
      )}
    </div>
  );
}

function AgenticSimulationControls({
  enrollmentId,
  simulationEnabled,
}: { enrollmentId: string; simulationEnabled: boolean }) {
  const runNext = useRunNextStep();
  const simulateReply = useSimulateReply();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [lastAiReply, setLastAiReply] = useState<{ text: string; intent?: string } | null>(null);
  const [draft, setDraft] = useState<EditableDraft | null>(null);

  const handleRun = () => {
    const override = draft && draft.action === "send"
      ? {
          action: draft.action,
          channel: draft.channel ?? undefined,
          hook: draft.hook ?? undefined,
          subject: draft.subject || undefined,
          message: draft.message,
          rationale: draft.rationale,
          edited_by_human:
            draft.message !== draft.originalMessage ||
            draft.subject !== draft.originalSubject,
          original_message: draft.originalMessage,
        }
      : undefined;
    runNext.mutate(
      { enrollmentId, override },
      {
        onSuccess: () => {
          setDraft(null);
          qc.invalidateQueries({ queryKey: ["agent_next_preview", enrollmentId] });
        },
      },
    );
  };

  return (
    <div className="space-y-2 border-t border-dashed pt-2 mt-1">
      <AgentNextPreview
        enrollmentId={enrollmentId}
        draft={draft}
        onDraftChange={setDraft}
      />
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="default"
          onClick={handleRun}
          disabled={runNext.isPending}
          className="h-7 text-xs"
        >
          {runNext.isPending ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Play className="mr-1 h-3 w-3" />
          )}
          Executar próximo passo
        </Button>
      </div>
      {simulationEnabled && (
        <div className="space-y-1.5">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder='Simular resposta do lead (ex: "não tenho interesse", "podemos marcar?", "remover")'
            rows={2}
            className="text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!reply.trim() || simulateReply.isPending}
            onClick={() => {
              simulateReply.mutate(
                { enrollmentId, replyText: reply.trim() },
                {
                  onSuccess: (data: any) => {
                    setReply("");
                    if (data?.reply_text) setLastAiReply({ text: data.reply_text, intent: data.intent });
                    qc.invalidateQueries({ queryKey: ["agent_next_preview", enrollmentId] });
                  },
                },
              );
            }}
            className="h-7 text-xs"
          >
            {simulateReply.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Send className="mr-1 h-3 w-3" />
            )}
            Simular resposta
          </Button>
        </div>
      )}
      {lastAiReply && (
        <div className="rounded border border-amber-200 bg-amber-50/60 p-2 space-y-1">
          <div className="flex items-center gap-1 text-[10px] text-amber-800">
            <Sparkles className="h-3 w-3" />
            <span className="font-medium">IA respondeu (simulado)</span>
            {lastAiReply.intent && <Badge variant="outline" className="text-[10px] h-4">{lastAiReply.intent}</Badge>}
          </div>
          <p className="text-xs whitespace-pre-wrap text-foreground/90">{lastAiReply.text}</p>
        </div>
      )}
    </div>
  );
}

function ReengageSettings({ cadence, onSave, saving }: { cadence: any; onSave: (v: { reengage_enabled: boolean; reengage_after_days: number; reengage_max_attempts: number }) => void; saving: boolean }) {
  const [enabled, setEnabled] = useState<boolean>(cadence?.reengage_enabled ?? true);
  const [days, setDays] = useState<number>(cadence?.reengage_after_days ?? 2);
  const [maxAttempts, setMaxAttempts] = useState<number>(cadence?.reengage_max_attempts ?? 3);

  useEffect(() => {
    setEnabled(cadence?.reengage_enabled ?? true);
    setDays(cadence?.reengage_after_days ?? 2);
    setMaxAttempts(cadence?.reengage_max_attempts ?? 3);
  }, [cadence?.id, cadence?.reengage_enabled, cadence?.reengage_after_days, cadence?.reengage_max_attempts]);

  const dirty =
    enabled !== (cadence?.reengage_enabled ?? true) ||
    days !== (cadence?.reengage_after_days ?? 2) ||
    maxAttempts !== (cadence?.reengage_max_attempts ?? 3);

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Reengajamento de leads silenciosos</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Se o lead respondeu e depois parou de responder, o sistema retoma a cadência automaticamente.
            Reuniões agendadas e agendamentos em andamento pausam o reengajamento.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} id="reengage-settings-toggle" />
          <Label htmlFor="reengage-settings-toggle" className="cursor-pointer text-sm">
            Reengajar leads silenciosos
          </Label>
        </div>

        {enabled && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Dias de silêncio antes de reengajar</Label>
              <Input
                type="number"
                min={1}
                max={14}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Máximo de tentativas</Label>
              <Input
                type="number"
                min={1}
                max={99}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
              />
            </div>
          </div>
        )}

        <Button
          size="sm"
          onClick={() => onSave({ reengage_enabled: enabled, reengage_after_days: days, reengage_max_attempts: maxAttempts })}
          disabled={!dirty || saving}
        >
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
          Salvar configurações
        </Button>
      </div>
    </div>
  );
}



