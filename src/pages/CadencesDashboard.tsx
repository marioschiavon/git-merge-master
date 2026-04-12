import { useState } from "react";
import { useCadences, useCadenceSteps, useResetEnrollment, useExecuteCadenceNow } from "@/hooks/useCadences";
import {
  useCadenceDashboardEnrollments,
  useCadenceDashboardLogs,
  useStepProgressCounts,
} from "@/hooks/useCadenceDashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Mail,
  MessageSquare,
  Linkedin,
  Layers,
  ChevronDown,
  Activity,
  RotateCcw,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const channelIcon: Record<string, React.ReactNode> = {
  email: <Mail className="h-4 w-4" />,
  whatsapp: <MessageSquare className="h-4 w-4" />,
  linkedin: <Linkedin className="h-4 w-4" />,
  multi_channel: <Layers className="h-4 w-4" />,
};

const statusColor: Record<string, string> = {
  active: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  replied: "bg-purple-100 text-purple-800",
  bounced: "bg-destructive/20 text-destructive",
  paused: "bg-muted text-muted-foreground",
};

const fmt = (d: string | null) =>
  d ? format(new Date(d), "dd/MM/yy HH:mm", { locale: ptBR }) : "—";

export default function CadencesDashboard() {
  const { data: cadences, isLoading: loadingCadences } = useCadences();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const cadenceId = selectedId || cadences?.[0]?.id || null;

  const resetEnrollment = useResetEnrollment();
  const executeCadence = useExecuteCadenceNow();

  const { data: steps } = useCadenceSteps(cadenceId);
  const { data: enrollments } = useCadenceDashboardEnrollments(cadenceId);
  const { data: logs } = useCadenceDashboardLogs(cadenceId);
  const { data: stepCounts } = useStepProgressCounts(cadenceId);

  const totalEnrolled = enrollments?.length || 0;

  const filteredEnrollments =
    statusFilter === "all"
      ? enrollments
      : enrollments?.filter((e) => e.status === statusFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">
            Acompanhamento de Cadências
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={cadenceId || ""}
            onValueChange={(v) => setSelectedId(v)}
          >
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Selecione uma cadência" />
            </SelectTrigger>
            <SelectContent>
              {cadences?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {cadenceId && (
            <Button
              size="sm"
              onClick={() => executeCadence.mutate()}
              disabled={executeCadence.isPending}
            >
              <Play className="h-4 w-4 mr-1" />
              {executeCadence.isPending ? "Executando..." : "Executar Agora"}
            </Button>
          )}
        </div>
      </div>

      {!cadenceId && (
        <p className="text-muted-foreground">Nenhuma cadência encontrada.</p>
      )}

      {cadenceId && (
        <Tabs defaultValue="timeline">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="leads">Leads ({totalEnrolled})</TabsTrigger>
            <TabsTrigger value="logs">Log de Mensagens</TabsTrigger>
          </TabsList>

          {/* TIMELINE */}
          <TabsContent value="timeline" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Steps da Cadência</CardTitle>
              </CardHeader>
              <CardContent>
                {!steps?.length ? (
                  <p className="text-muted-foreground">
                    Nenhum step configurado.
                  </p>
                ) : (
                  <div className="relative flex flex-col gap-0">
                    {steps.map((step, idx) => {
                      const passed = stepCounts?.[step.step_order] || 0;
                      const pct =
                        totalEnrolled > 0
                          ? Math.round((passed / totalEnrolled) * 100)
                          : 0;
                      const isLast = idx === steps.length - 1;

                      return (
                        <div key={step.id} className="flex gap-4">
                          {/* Vertical line + dot */}
                          <div className="flex flex-col items-center">
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 ${
                                passed > 0
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-muted bg-muted text-muted-foreground"
                              }`}
                            >
                              {channelIcon[step.channel] || (
                                <Mail className="h-4 w-4" />
                              )}
                            </div>
                            {!isLast && (
                              <div className="w-px flex-1 bg-border" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="pb-8">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">
                                Step {step.step_order}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {step.channel}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                +{step.delay_days}d
                              </span>
                            </div>
                            {step.subject && (
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {step.subject}
                              </p>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                              <Progress value={pct} className="h-2 w-40" />
                              <span className="text-xs text-muted-foreground">
                                {passed}/{totalEnrolled} leads ({pct}%)
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* LEADS */}
          <TabsContent value="leads" className="mt-4">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-lg">Status por Lead</CardTitle>
                <Select
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="completed">Concluído</SelectItem>
                    <SelectItem value="replied">Respondeu</SelectItem>
                    <SelectItem value="bounced">Bounce</SelectItem>
                    <SelectItem value="paused">Pausado</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Step Atual</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Próx. Execução</TableHead>
                      <TableHead>Última Execução</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!filteredEnrollments?.length ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="text-center text-muted-foreground"
                        >
                          Nenhum lead encontrado.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredEnrollments.map((e: any) => (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">
                            {e.leads?.name || "—"}
                          </TableCell>
                          <TableCell>{e.leads?.email || "—"}</TableCell>
                          <TableCell>Step {e.current_step}</TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                statusColor[e.status] || ""
                              }`}
                            >
                              {e.status}
                            </span>
                          </TableCell>
                          <TableCell>{fmt(e.next_execution_at)}</TableCell>
                          <TableCell>{fmt(e.last_executed_at)}</TableCell>
                          <TableCell>
                            {(
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => resetEnrollment.mutate(e.id)}
                                disabled={resetEnrollment.isPending}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" />
                                Re-testar
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* LOGS */}
          <TabsContent value="logs" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Log de Mensagens</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {!logs?.length ? (
                  <p className="text-muted-foreground">
                    Nenhuma mensagem enviada ainda.
                  </p>
                ) : (
                  logs.map((log: any) => (
                    <Collapsible key={log.id}>
                      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border p-3 text-left hover:bg-muted/50">
                        <div className="flex items-center gap-3">
                          {channelIcon[log.channel] || (
                            <Mail className="h-4 w-4" />
                          )}
                          <div>
                            <span className="font-medium text-foreground">
                              {log.leads?.name || "Lead"}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              Step{" "}
                              {log.cadence_steps?.step_order || "?"}
                              {" · "}
                              {log.channel}
                              {" · "}
                              {log.action}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {fmt(log.created_at)}
                          </span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="rounded-b-md border border-t-0 bg-muted/30 p-4">
                        <p className="whitespace-pre-wrap text-sm text-foreground">
                          {log.message_content || "Sem conteúdo"}
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
