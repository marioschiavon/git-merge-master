import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCadence, useCadenceSteps, useCadenceEnrollments, useUpsertStep, useDeleteStep, useEnrollLeads } from "@/hooks/useCadences";
import { useLeads } from "@/hooks/usePipedrive";
import { CadenceStepCard } from "@/components/CadenceStepCard";
import { Plus, Users, ListOrdered } from "lucide-react";

const enrollmentStatusLabels: Record<string, string> = {
  active: "Ativo",
  completed: "Concluído",
  replied: "Respondeu",
  bounced: "Bounce",
  paused: "Pausado",
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
  const { data: allLeads = [] } = useLeads({ status: "all", search: "" });
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{cadence.name}</SheetTitle>
          {cadence.description && (
            <p className="text-sm text-muted-foreground">{cadence.description}</p>
          )}
        </SheetHeader>

        <Tabs defaultValue="steps" className="mt-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="steps">
              <ListOrdered className="mr-2 h-4 w-4" />Steps ({steps.length})
            </TabsTrigger>
            <TabsTrigger value="leads">
              <Users className="mr-2 h-4 w-4" />Leads ({enrollments.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="steps" className="space-y-4 mt-4">
            {steps.map((step: any, idx: number) => {
              const Icon = channelIcons[step.channel] || Mail;
              return (
                <Card key={step.id}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">#{step.step_order}</Badge>
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{channelLabels[step.channel]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {step.delay_days === 0 ? "Imediato" : `+${step.delay_days} dia(s)`}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteStep.mutate({ id: step.id, cadenceId: cadenceId! })}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Canal</Label>
                        <Select
                          value={step.channel}
                          onValueChange={(v) =>
                            upsertStep.mutate({ ...step, channel: v })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="email">E-mail</SelectItem>
                            <SelectItem value="whatsapp">WhatsApp</SelectItem>
                            <SelectItem value="linkedin">LinkedIn</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Delay (dias)</Label>
                        <Input
                          type="number"
                          min={0}
                          className="h-8 text-xs"
                          value={step.delay_days}
                          onChange={(e) =>
                            upsertStep.mutate({ ...step, delay_days: parseInt(e.target.value) || 0 })
                          }
                        />
                      </div>
                    </div>
                    {step.channel === "email" && (
                      <div className="space-y-1">
                        <Label className="text-xs">Assunto</Label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="Assunto do e-mail..."
                          value={step.subject || ""}
                          onBlur={(e) =>
                            upsertStep.mutate({ ...step, subject: e.target.value })
                          }
                          defaultValue={step.subject || ""}
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">Template da mensagem</Label>
                      <Textarea
                        className="text-xs min-h-[60px]"
                        placeholder="Olá {{nome}}, ..."
                        defaultValue={step.template}
                        onBlur={(e) =>
                          upsertStep.mutate({ ...step, template: e.target.value })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <Button variant="outline" className="w-full" onClick={handleAddStep}>
              <Plus className="mr-2 h-4 w-4" />Adicionar Step
            </Button>
          </TabsContent>

          <TabsContent value="leads" className="space-y-4 mt-4">
            <Button variant="outline" onClick={() => setEnrollDialogOpen(!enrollDialogOpen)}>
              <Plus className="mr-2 h-4 w-4" />Associar Leads
            </Button>

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
                    <CardContent className="p-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{e.leads?.name || "Lead"}</p>
                        <p className="text-xs text-muted-foreground">{e.leads?.email || ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">Step {e.current_step}</Badge>
                        <Badge variant="secondary" className="text-xs">
                          {enrollmentStatusLabels[e.status] || e.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
