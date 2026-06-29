import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Play, X, AlertTriangle } from "lucide-react";
import {
  useIntentRules, useUpdateIntentRule, useIntentLog, useActionQueue,
  useCancelAction, useRunActionNow, CATEGORY_LABELS, ACTION_LABELS,
} from "@/hooks/useIntents";

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

function RuleCard({ rule }: { rule: any }) {
  const update = useUpdateIntentRule();
  const [actions, setActions] = useState<string[]>(
    (rule.actions || []).map((a: any) => a.type)
  );
  const [autoExec, setAutoExec] = useState<boolean>(rule.auto_execute);
  const [enabled, setEnabled] = useState<boolean>(rule.enabled);
  const [threshold, setThreshold] = useState<number>(Number(rule.requires_confidence_above) || 0.7);

  const dirty =
    JSON.stringify(actions.sort()) !== JSON.stringify((rule.actions || []).map((a: any) => a.type).sort()) ||
    autoExec !== rule.auto_execute ||
    enabled !== rule.enabled ||
    threshold !== Number(rule.requires_confidence_above);

  const toggleAction = (a: string) =>
    setActions((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);

  const save = () => {
    const existingParams: Record<string, any> = {};
    (rule.actions || []).forEach((a: any) => { existingParams[a.type] = a.params; });
    update.mutate({
      id: rule.id,
      actions: actions.map((t) => ({ type: t, ...(existingParams[t] ? { params: existingParams[t] } : {}) })),
      auto_execute: autoExec,
      enabled,
      requires_confidence_above: threshold,
    });
  };

  return (
    <Card className={!enabled ? "opacity-60" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{CATEGORY_LABELS[rule.category as keyof typeof CATEGORY_LABELS] || rule.category}</CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor={`en-${rule.id}`} className="text-xs">Ativa</Label>
            <Switch id={`en-${rule.id}`} checked={enabled} onCheckedChange={setEnabled} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Ações disparadas</Label>
          <div className="grid grid-cols-2 gap-2">
            {ALL_ACTIONS.map((a) => (
              <label key={a} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox checked={actions.includes(a)} onCheckedChange={() => toggleAction(a)} />
                <span>{ACTION_LABELS[a]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <Switch id={`auto-${rule.id}`} checked={autoExec} onCheckedChange={setAutoExec} />
            <Label htmlFor={`auto-${rule.id}`} className="text-sm">Executar automaticamente</Label>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Confiança mínima</Label>
            <Input
              type="number" step="0.05" min="0" max="1"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </div>
        </div>

        {!autoExec && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 p-2 rounded">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            <span>Modo sugerido: ações ficam pendentes e exigem aprovação humana antes de executar.</span>
          </div>
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RulesTab() {
  const { data: rules = [], isLoading } = useIntentRules();
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!rules.length) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhuma regra configurada.</CardContent></Card>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rules.map((r: any) => <RuleCard key={r.id} rule={r} />)}
    </div>
  );
}

const confidenceColor = (c: number) =>
  c >= 0.8 ? "bg-green-100 text-green-800" : c >= 0.5 ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800";

function LogsTab() {
  const { data: logs = [], isLoading } = useIntentLog(100);
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!logs.length) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Nenhuma classificação registrada ainda.</CardContent></Card>;
  return (
    <div className="space-y-2">
      {logs.map((l: any) => (
        <Card key={l.id}>
          <CardContent className="p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{CATEGORY_LABELS[l.category as keyof typeof CATEGORY_LABELS] || l.category}</Badge>
                {l.sub_intent && <Badge variant="secondary" className="text-xs">{l.sub_intent}</Badge>}
                <Badge className={`text-xs ${confidenceColor(Number(l.confidence))}`}>{(Number(l.confidence) * 100).toFixed(0)}%</Badge>
                {l.sentiment && <Badge variant="outline" className="text-xs">{l.sentiment}</Badge>}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {new Date(l.created_at).toLocaleString("pt-BR")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{l.leads?.name} · {l.leads?.company_name}</p>
            <p className="text-sm">"{l.message_excerpt}"</p>
            {l.raw_response?.reasoning && (
              <p className="text-xs text-muted-foreground italic">→ {l.raw_response.reasoning}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const statusColor: Record<string, string> = {
  pending: "bg-blue-100 text-blue-800",
  done: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
  skipped: "bg-gray-100 text-gray-800",
};

function QueueTab() {
  const { data: queue = [], isLoading } = useActionQueue();
  const cancel = useCancelAction();
  const runNow = useRunActionNow();
  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!queue.length) return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Fila vazia.</CardContent></Card>;
  return (
    <div className="space-y-2">
      {queue.map((a: any) => (
        <Card key={a.id}>
          <CardContent className="p-3 flex items-center justify-between gap-2">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{ACTION_LABELS[a.action_type] || a.action_type}</Badge>
                <Badge className={`text-xs ${statusColor[a.status] || ""}`}>{a.status}</Badge>
                <span className="text-xs text-muted-foreground">
                  agendada: {new Date(a.scheduled_for).toLocaleString("pt-BR")}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {a.leads?.name} · {a.leads?.company_name} {a.triggered_by ? `· trigger: ${a.triggered_by}` : ""}
              </p>
              {a.error && <p className="text-xs text-red-600">erro: {a.error}</p>}
            </div>
            {a.status === "pending" && (
              <div className="flex gap-1">
                <Button size="icon" variant="outline" onClick={() => runNow.mutate(a.id)} disabled={runNow.isPending} title="Executar agora">
                  <Play className="h-3 w-3" />
                </Button>
                <Button size="icon" variant="outline" onClick={() => cancel.mutate(a.id)} disabled={cancel.isPending} title="Cancelar">
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function Intents() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Intents & Ações</h1>
        <p className="text-muted-foreground">Configure como a IA classifica respostas e quais ações dispara.</p>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Regras</TabsTrigger>
          <TabsTrigger value="logs">Logs de classificação</TabsTrigger>
          <TabsTrigger value="queue">Fila de ações</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4"><RulesTab /></TabsContent>
        <TabsContent value="logs" className="mt-4"><LogsTab /></TabsContent>
        <TabsContent value="queue" className="mt-4"><QueueTab /></TabsContent>
      </Tabs>
    </div>
  );
}
