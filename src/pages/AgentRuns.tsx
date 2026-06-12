import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { RefreshCw, Bot, MessageSquare, GitCompare } from "lucide-react";

type Run = {
  id: string;
  lead_id: string | null;
  conversation_id: string | null;
  trigger: string;
  mode: string;
  status: string;
  steps: unknown;
  final_output: {
    decision?: string;
    rationale?: string;
    message?: string;
    channel?: string;
    offered_slots?: string[];
  } | null;
  error: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Msg = {
  id: string;
  direction: string;
  content: string;
  channel: string | null;
  sent_at: string;
  metadata: Record<string, unknown> | null;
};


type LeadLite = { id: string; name: string | null; company_name: string | null };

export default function AgentRuns() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Run | null>(null);
  const [compare, setCompare] = useState<{
    lastInbound: Msg | null;
    legacyOutbound: Msg | null;
    lead: LeadLite | null;
  } | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

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

  // Load comparison data when a run is selected
  useEffect(() => {
    if (!selected) {
      setCompare(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setCompareLoading(true);
      try {
        const [{ data: lead }, { data: lastInbound }] = await Promise.all([
          selected.lead_id
            ? supabase
                .from("leads")
                .select("id, name, company_name")
                .eq("id", selected.lead_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          selected.conversation_id
            ? supabase
                .from("messages")
                .select("id, direction, content, channel, created_at, metadata")
                .eq("conversation_id", selected.conversation_id)
                .eq("direction", "inbound")
                .lte("created_at", selected.created_at)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        // Legacy outbound = the next outbound after this run was created (pipeline antigo respondendo a essa inbound)
        let legacyOutbound: Msg | null = null;
        if (selected.conversation_id) {
          const { data: outs } = await supabase
            .from("messages")
            .select("id, direction, content, channel, created_at, metadata")
            .eq("conversation_id", selected.conversation_id)
            .eq("direction", "outbound")
            .gte("created_at", selected.created_at)
            .order("created_at", { ascending: true })
            .limit(1);
          legacyOutbound = (outs?.[0] ?? null) as Msg | null;
        }

        if (!cancelled) {
          setCompare({
            lastInbound: (lastInbound ?? null) as Msg | null,
            legacyOutbound,
            lead: (lead ?? null) as LeadLite | null,
          });
        }
      } finally {
        if (!cancelled) setCompareLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const statusColor = (s: string) =>
    s === "succeeded" ? "default" : s === "failed" ? "destructive" : "secondary";

  const decisionBadge = (d?: string) => {
    if (!d) return null;
    const map: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      send_message: "default",
      offer_slots: "default",
      book_slot: "default",
      schedule_followup: "secondary",
      silence: "outline",
      escalate_to_human: "destructive",
      mark_referral: "secondary",
    };
    return <Badge variant={map[d] ?? "outline"}>{d}</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot className="h-6 w-6" /> Runs do Agente SDR
          </h1>
          <p className="text-sm text-muted-foreground">
            Shadow mode: o agente unificado decide em paralelo ao pipeline atual.
            Compare lado-a-lado para validar antes do cutover.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimas execuções</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[700px]">
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={statusColor(r.status)}>{r.status}</Badge>
                        <Badge variant="outline">{r.mode}</Badge>
                        <Badge variant="outline">{r.trigger}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </div>
                    <div className="text-sm font-medium truncate flex items-center gap-1">
                      {decisionBadge(r.final_output?.decision)}
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {r.final_output?.rationale ?? r.error ?? ""}
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

        <div className="space-y-4">
          {!selected && (
            <Card>
              <CardContent className="py-12">
                <p className="text-sm text-muted-foreground text-center">
                  Selecione uma execução à esquerda para ver o comparativo.
                </p>
              </CardContent>
            </Card>
          )}

          {selected && (
            <>
              {/* Comparison panel */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <GitCompare className="h-4 w-4" />
                    Comparativo: Pipeline atual vs Agente
                  </CardTitle>
                  {compare?.lead && (
                    <p className="text-xs text-muted-foreground">
                      Lead: {compare.lead.name ?? "?"} · {compare.lead.company_name ?? "?"}
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  {compareLoading && <Skeleton className="h-32 w-full" />}
                  {!compareLoading && (
                    <>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <MessageSquare className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-medium text-muted-foreground">
                            Mensagem do lead (gatilho)
                          </span>
                        </div>
                        <div className="bg-muted/50 border-l-2 border-muted-foreground/30 p-3 rounded text-sm">
                          {compare?.lastInbound?.content ?? (
                            <span className="text-muted-foreground italic">— sem inbound vinculado —</span>
                          )}
                        </div>
                      </div>

                      <Separator />

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline" className="text-xs">Pipeline atual (enviado)</Badge>
                          </div>
                          <div className="bg-card border p-3 rounded text-sm min-h-[100px]">
                            {compare?.legacyOutbound?.content ?? (
                              <span className="text-muted-foreground italic">
                                — nenhuma resposta enviada ainda —
                              </span>
                            )}
                          </div>
                          {compare?.legacyOutbound?.metadata && (
                            <details className="mt-1">
                              <summary className="text-xs text-muted-foreground cursor-pointer">
                                metadata
                              </summary>
                              <pre className="text-[10px] bg-muted p-2 rounded overflow-x-auto mt-1">
                                {JSON.stringify(compare.legacyOutbound.metadata, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant="default" className="text-xs">Agente (proposta)</Badge>
                            {decisionBadge(selected.final_output?.decision)}
                          </div>
                          <div className="bg-primary/5 border border-primary/20 p-3 rounded text-sm min-h-[100px]">
                            {selected.final_output?.message ?? (
                              <span className="text-muted-foreground italic">
                                — sem mensagem (decision: {selected.final_output?.decision ?? "?"}) —
                              </span>
                            )}
                          </div>
                          {selected.final_output?.offered_slots && selected.final_output.offered_slots.length > 0 && (
                            <div className="mt-2 text-xs">
                              <span className="text-muted-foreground">Slots propostos: </span>
                              {selected.final_output.offered_slots.map((s) => (
                                <Badge key={s} variant="outline" className="ml-1 text-[10px]">
                                  {new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {selected.final_output?.rationale && (
                        <>
                          <Separator />
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">
                              Raciocínio do agente
                            </span>
                            <p className="text-sm mt-1">{selected.final_output.rationale}</p>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Raw details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Detalhes técnicos</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {selected.model} · {selected.total_tokens ?? 0} tokens · {selected.latency_ms ?? 0}ms
                  </p>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Decisão final (raw)</p>
                        <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">
                          {JSON.stringify(selected.final_output, null, 2)}
                        </pre>
                      </div>
                      {selected.error && (
                        <div>
                          <p className="text-xs text-destructive mb-1">Erro</p>
                          <pre className="bg-destructive/10 p-3 rounded text-xs overflow-x-auto">
                            {selected.error}
                          </pre>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Steps (tools chamadas)</p>
                        <pre className="bg-muted p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(selected.steps, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
