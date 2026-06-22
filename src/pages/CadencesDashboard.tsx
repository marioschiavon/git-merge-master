import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCadences, useExecuteCadenceNow, useCadenceSteps } from "@/hooks/useCadences";
import { useCadenceLeadProgress } from "@/hooks/useCadenceLeadProgress";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  Activity,
  Play,
  Mail,
  MessageSquare,
  Linkedin,
  Search,
  ChevronRight,
  ChevronDown,
  Users,
  CheckCircle2,
  Reply,
  XCircle,
  PauseCircle,
} from "lucide-react";
import { LeadProgressDrawer } from "@/components/cadence/LeadProgressDrawer";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const channelIcon: Record<string, JSX.Element> = {
  email: <Mail className="h-3.5 w-3.5" />,
  whatsapp: <MessageSquare className="h-3.5 w-3.5" />,
  linkedin: <Linkedin className="h-3.5 w-3.5" />,
};

const intentColor: Record<string, string> = {
  interesse: "bg-green-100 text-green-800 border-green-200",
  agendar: "bg-blue-100 text-blue-800 border-blue-200",
  objecao: "bg-amber-100 text-amber-800 border-amber-200",
  duvida: "bg-purple-100 text-purple-800 border-purple-200",
  rejeicao: "bg-red-100 text-red-800 border-red-200",
  nao_interessado: "bg-red-100 text-red-800 border-red-200",
};

const statusBadge: Record<string, { label: string; cls: string }> = {
  active: { label: "Ativo", cls: "bg-blue-100 text-blue-800 border-blue-200" },
  completed: { label: "Concluído", cls: "bg-green-100 text-green-800 border-green-200" },
  replied: { label: "Respondeu", cls: "bg-purple-100 text-purple-800 border-purple-200" },
  bounced: { label: "Bounce", cls: "bg-red-100 text-red-800 border-red-200" },
  paused: { label: "Pausado", cls: "bg-muted text-muted-foreground border-border" },
};

const initials = (name?: string | null) =>
  (name || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const fmtRel = (d: string | null) =>
  d ? formatDistanceToNow(new Date(d), { locale: ptBR, addSuffix: true }) : "—";

export default function CadencesDashboard() {
  const { data: cadences } = useCadences();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [intentFilter, setIntentFilter] = useState<string>("all");
  const [stepFilter, setStepFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [drawerRow, setDrawerRow] = useState<any | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const cadenceIds = useMemo(() => (cadences || []).map((c) => c.id), [cadences]);
  const { data: enrollmentCounts } = useQuery({
    queryKey: ["cadence_enrollment_counts", cadenceIds],
    queryFn: async () => {
      if (!cadenceIds.length) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from("cadence_enrollments")
        .select("cadence_id")
        .in("cadence_id", cadenceIds);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        counts[r.cadence_id] = (counts[r.cadence_id] || 0) + 1;
      });
      return counts;
    },
    enabled: cadenceIds.length > 0,
  });

  // Auto-select first cadence with enrollments (fallback to first)
  useEffect(() => {
    if (selectedId || !cadences?.length) return;
    const firstWithLeads = cadences.find((c) => (enrollmentCounts?.[c.id] || 0) > 0);
    setSelectedId((firstWithLeads || cadences[0]).id);
  }, [cadences, enrollmentCounts, selectedId]);

  const cadenceId = selectedId || null;
  const executeCadence = useExecuteCadenceNow();
  const { data: steps } = useCadenceSteps(cadenceId);
  const { data: rows, isLoading } = useCadenceLeadProgress(cadenceId);
  const selectedHasNoEnrollments = !!cadenceId && (enrollmentCounts?.[cadenceId] ?? 0) === 0;

  const stats = useMemo(() => {
    const r = rows || [];
    return {
      total: r.length,
      active: r.filter((x) => x.enrollment.status === "active").length,
      replied: r.filter((x) => x.enrollment.status === "replied").length,
      completed: r.filter((x) => x.enrollment.status === "completed").length,
      bounced: r.filter((x) => x.enrollment.status === "bounced").length,
      paused: r.filter((x) => x.enrollment.status === "paused").length,
    };
  }, [rows]);

  const intentOptions = useMemo(() => {
    const set = new Set<string>();
    (rows || []).forEach((r) => r.lastIntent?.category && set.add(r.lastIntent.category));
    return Array.from(set);
  }, [rows]);

  const filtered = useMemo(() => {
    return (rows || []).filter((r) => {
      if (statusFilter !== "all" && r.enrollment.status !== statusFilter) return false;
      if (intentFilter !== "all" && r.lastIntent?.category !== intentFilter) return false;
      if (stepFilter !== "all" && String(r.enrollment.current_step) !== stepFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [r.lead?.name, r.lead?.email, r.lead?.company_name].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, intentFilter, stepFilter, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Acompanhamento</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={cadenceId || ""} onValueChange={(v) => setSelectedId(v)}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Selecione uma cadência" />
            </SelectTrigger>
            <SelectContent>
              {cadences?.map((c) => {
                const n = enrollmentCounts?.[c.id] ?? 0;
                return (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({n})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {cadenceId && (
            <Button size="sm" onClick={() => executeCadence.mutate()} disabled={executeCadence.isPending}>
              <Play className="h-4 w-4 mr-1" />
              {executeCadence.isPending ? "Executando..." : "Executar Agora"}
            </Button>
          )}
        </div>
      </div>

      {!cadenceId && <p className="text-muted-foreground">Nenhuma cadência encontrada.</p>}

      {cadenceId && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Kpi icon={<Users className="h-4 w-4" />} label="Total" value={stats.total} />
            <Kpi icon={<Activity className="h-4 w-4 text-blue-600" />} label="Ativos" value={stats.active} />
            <Kpi icon={<Reply className="h-4 w-4 text-purple-600" />} label="Responderam" value={stats.replied} />
            <Kpi icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} label="Concluídos" value={stats.completed} />
            <Kpi icon={<XCircle className="h-4 w-4 text-red-600" />} label="Bounces" value={stats.bounced} />
          </div>

          {/* Steps overview */}
          <Collapsible open={showSteps} onOpenChange={setShowSteps}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1">
                {showSteps ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Ver steps da cadência ({steps?.length || 0})
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Card>
                <CardContent className="flex flex-wrap gap-2 p-4">
                  {steps?.map((s) => (
                    <div key={s.id} className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs">
                      <span className="font-medium">Step {s.step_order}</span>
                      {channelIcon[s.channel]}
                      <span className="text-muted-foreground">+{s.delay_days}d</span>
                      {s.subject && <span className="text-muted-foreground">· {s.subject}</span>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, email, empresa..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                <SelectItem value="active">Ativo</SelectItem>
                <SelectItem value="replied">Respondeu</SelectItem>
                <SelectItem value="completed">Concluído</SelectItem>
                <SelectItem value="bounced">Bounce</SelectItem>
                <SelectItem value="paused">Pausado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={intentFilter} onValueChange={setIntentFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas intents</SelectItem>
                {intentOptions.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={stepFilter} onValueChange={setStepFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos steps</SelectItem>
                {steps?.map((s) => (
                  <SelectItem key={s.id} value={String(s.step_order)}>
                    Step {s.step_order} — {s.channel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Intent</TableHead>
                    <TableHead>Última mensagem</TableHead>
                    <TableHead>Próxima execução</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && !filtered.length && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        {selectedHasNoEnrollments
                          ? "Esta cadência ainda não tem leads matriculados. Vá em Leads → Adicionar à cadência."
                          : "Nenhum lead encontrado com os filtros atuais."}
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((r) => {
                    const sb = statusBadge[r.enrollment.status] || { label: r.enrollment.status, cls: "" };
                    const pct = r.totalSteps > 0 ? Math.round(((r.enrollment.current_step - 1) / r.totalSteps) * 100) : 0;
                    return (
                      <TableRow
                        key={r.enrollment.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setDrawerRow(r)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                                {initials(r.lead?.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate">{r.lead?.name || "—"}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {r.lead?.title ? `${r.lead.title} · ` : ""}
                                {r.lead?.company_name || r.lead?.email || ""}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 min-w-[120px]">
                            <div className="flex items-center gap-1.5 text-sm">
                              <span className="font-medium">
                                {r.enrollment.current_step}/{r.totalSteps || "?"}
                              </span>
                              {r.nextStep && channelIcon[r.nextStep.channel]}
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-xs border", sb.cls)}>
                            {sb.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {r.lastIntent?.category ? (
                            <Badge
                              variant="outline"
                              className={cn("text-xs border", intentColor[r.lastIntent.category] || "")}
                            >
                              {r.lastIntent.category}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          {r.lastMessage ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="text-xs">
                                  <div className="flex items-center gap-1 text-muted-foreground">
                                    <span>{r.lastMessage.direction === "inbound" ? "Lead" : "Você"}</span>
                                    <span>·</span>
                                    <span>{fmtRel(r.lastMessage.sent_at)}</span>
                                    {r.lastMessage.metadata?.simulated && (
                                      <Badge variant="outline" className="text-[10px] py-0 bg-amber-50 text-amber-800 border-amber-200">
                                        🧪
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="truncate text-foreground">{r.lastMessage.content}</div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-md whitespace-pre-wrap">
                                {r.lastMessage.content}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sem mensagens</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs">
                            {r.nextStep && channelIcon[r.nextStep.channel]}
                            <span className="text-muted-foreground">
                              {r.enrollment.next_execution_at
                                ? format(new Date(r.enrollment.next_execution_at), "dd/MM HH:mm", { locale: ptBR })
                                : "—"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <LeadProgressDrawer
        open={!!drawerRow}
        onOpenChange={(o) => !o && setDrawerRow(null)}
        row={drawerRow}
        cadenceId={cadenceId}
      />
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-md bg-muted p-2">{icon}</div>
        <div>
          <div className="text-2xl font-bold text-foreground leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
