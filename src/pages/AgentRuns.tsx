import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw, Bot } from "lucide-react";

type Run = {
  id: string;
  lead_id: string | null;
  trigger: string;
  mode: string;
  status: string;
  steps: unknown;
  final_output: { decision?: string; rationale?: string; message?: string } | null;
  error: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

export default function AgentRuns() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Run | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sdr_agent_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setRuns((data ?? []) as Run[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const statusColor = (s: string) =>
    s === "succeeded" ? "default" : s === "failed" ? "destructive" : "secondary";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot className="h-6 w-6" /> Runs do Agente SDR
          </h1>
          <p className="text-sm text-muted-foreground">
            Execuções do agente unificado (shadow mode). Cada run mostra o raciocínio, tools chamadas e decisão final.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimas execuções</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[600px]">
              {loading && (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              )}
              {!loading && runs.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma execução ainda. O agente roda em shadow mode quando chega mensagem inbound.
                </p>
              )}
              <div className="divide-y">
                {runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className={`w-full text-left p-3 hover:bg-muted/50 transition-colors ${
                      selected?.id === r.id ? "bg-muted" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusColor(r.status)}>{r.status}</Badge>
                        <Badge variant="outline">{r.mode}</Badge>
                        <Badge variant="outline">{r.trigger}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </div>
                    <div className="text-sm font-medium truncate">
                      {r.final_output?.decision ?? r.error ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.final_output?.rationale ?? ""}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.total_tokens ?? 0} tokens · {r.latency_ms ?? 0}ms
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detalhes</CardTitle>
          </CardHeader>
          <CardContent>
            {!selected && (
              <p className="text-sm text-muted-foreground">Selecione uma execução à esquerda.</p>
            )}
            {selected && (
              <ScrollArea className="h-[560px]">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Decisão final</p>
                    <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                      {JSON.stringify(selected.final_output, null, 2)}
                    </pre>
                  </div>
                  {selected.error && (
                    <div>
                      <p className="text-xs text-destructive">Erro</p>
                      <pre className="bg-destructive/10 p-3 rounded text-xs overflow-x-auto">
                        {selected.error}
                      </pre>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Steps</p>
                    <pre className="bg-muted p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(selected.steps, null, 2)}
                    </pre>
                  </div>
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
