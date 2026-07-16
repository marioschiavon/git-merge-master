import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLeads, useSyncLeads, useIntegration, useDeleteLead } from "@/hooks/usePipedrive";
import { useLeadLists } from "@/hooks/useLeadLists";
import { useLeadInsightsBatch } from "@/hooks/useLeadInsights";
import { useEnrichMore } from "@/hooks/useScoring";
import { useCadences } from "@/hooks/useCadences";
import { useBulkLeadActions } from "@/hooks/useBulkLeadActions";
import { computeReadiness } from "@/lib/lead-readiness";
import { LeadDetail } from "@/components/LeadDetail";
import { LeadFormDialog } from "@/components/LeadFormDialog";
import { LeadImportDialog } from "@/components/LeadImportDialog";
import { ChannelBadges } from "@/components/lead/ChannelBadges";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefreshCw, Target, Search, Plus, Upload, Trash2, Pencil, X, Sparkles, Send, XCircle } from "lucide-react";

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-yellow-100 text-yellow-800",
  qualified: "bg-green-100 text-green-800",
  unqualified: "bg-red-100 text-red-800",
  converted: "bg-purple-100 text-purple-800",
};

const statusLabels: Record<string, string> = {
  new: "Novo",
  contacted: "Contatado",
  qualified: "Qualificado",
  unqualified: "Desqualificado",
  converted: "Convertido",
};

export default function Leads() {
  const [params, setParams] = useSearchParams();
  const listId = params.get("list");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [minScore, setMinScore] = useState<number>(0);
  const [onlyEnriched, setOnlyEnriched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [chosenCadence, setChosenCadence] = useState<string>("");

  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<any>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const leadsFilters = useMemo(
    () => ({ status: statusFilter, search: debouncedSearch }),
    [statusFilter, debouncedSearch],
  );
  const { data: allLeads = [], isLoading } = useLeads(leadsFilters);
  const { data: lists = [] } = useLeadLists();
  const { data: cadences = [] } = useCadences();
  const activeList = useMemo(() => lists.find((l) => l.id === listId), [lists, listId]);
  const leads = useMemo(() => {
    let arr: any[] = listId ? allLeads.filter((l: any) => l.lead_list_id === listId) : allLeads;
    if (onlyEnriched) arr = arr.filter((l: any) => l.enrichment_status === "completed");
    if (minScore > 0) arr = arr.filter((l: any) => (l.score ?? 0) >= minScore);
    return arr;
  }, [allLeads, listId, minScore, onlyEnriched]);
  const leadIds = useMemo(() => leads.map((l: any) => l.id), [leads]);
  const { data: insightsMap = {} } = useLeadInsightsBatch(leadIds);
  const syncMutation = useSyncLeads();
  const { data: integration } = useIntegration("pipedrive");
  const isConnected = integration?.status === "active";
  const deleteLead = useDeleteLead();
  const bulk = useBulkLeadActions();

  const clearListFilter = () => {
    const p = new URLSearchParams(params);
    p.delete("list");
    setParams(p, { replace: true });
  };

  const enrichMore = useEnrichMore();
  const heldCount = useMemo(
    () => leads.filter((l: any) => l.enrichment_status === "not_queued").length,
    [leads],
  );

  const allChecked = leads.length > 0 && leads.every((l: any) => selectedIds.has(l.id));
  const someChecked = selectedIds.size > 0;

  const toggleAll = () => {
    if (allChecked) setSelectedIds(new Set());
    else setSelectedIds(new Set(leads.map((l: any) => l.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const activeCadences = useMemo(
    () => (cadences || []).filter((c: any) => c.status === "active" || c.status === "draft"),
    [cadences],
  );

  const handleEnroll = async () => {
    if (!chosenCadence) return;
    await bulk.mutateAsync({ lead_ids: Array.from(selectedIds), action: "enroll", cadence_id: chosenCadence });
    setSelectedIds(new Set());
    setEnrollOpen(false);
    setChosenCadence("");
  };
  const handleDiscard = async () => {
    await bulk.mutateAsync({ lead_ids: Array.from(selectedIds), action: "discard" });
    setSelectedIds(new Set());
  };

  const actionButtons = (
    <div className="flex gap-2 flex-wrap">
      {heldCount > 0 && (
        <Button
          variant="outline"
          onClick={() => {
            const raw = prompt(`Existem ${heldCount} lead(s) em espera. Quantos enriquecer agora?`, String(Math.min(50, heldCount)));
            if (!raw) return;
            const n = Math.max(1, Number(raw) || 0);
            if (!n) return;
            enrichMore.mutate({ limit: n, lead_list_id: listId || null });
          }}
          disabled={enrichMore.isPending}
          title="Libera leads marcados como 'em espera' para o enriquecimento automático"
        >
          <Sparkles className={`mr-2 h-4 w-4 ${enrichMore.isPending ? "animate-pulse" : ""}`} />
          Enriquecer mais ({heldCount})
        </Button>
      )}
      <Button variant="outline" onClick={() => setImportOpen(true)}>
        <Upload className="mr-2 h-4 w-4" /> Importar CSV
      </Button>
      <Button onClick={() => setCreateOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Novo Lead
      </Button>
      {isConnected && (
        <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Sincronizando..." : "Sincronizar"}
        </Button>
      )}
    </div>
  );

  if (!isConnected && leads.length === 0 && !search && statusFilter === "all" && minScore === 0 && !onlyEnriched) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
            <p className="text-muted-foreground">Gerencie seus leads</p>
          </div>
          {actionButtons}
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-medium">Nenhum lead ainda</h3>
            <p className="mt-1 text-sm text-muted-foreground text-center max-w-md">
              Cadastre um lead manualmente, importe uma lista via CSV ou conecte seu Pipedrive em Configurações → Integrações.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" /> Importar CSV
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Novo Lead
              </Button>
            </div>
          </CardContent>
        </Card>
        <LeadFormDialog open={createOpen} onOpenChange={setCreateOpen} />
        <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
          <p className="text-muted-foreground">{leads.length} leads encontrados</p>
        </div>
        {actionButtons}
      </div>

      {activeList && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Filtrando pela lista:</span>
          <Badge variant="secondary" className="gap-1">
            {activeList.name}
            <button onClick={clearListFilter} className="ml-1 rounded hover:bg-muted-foreground/20" aria-label="Remover filtro">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email ou empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="new">Novo</SelectItem>
            <SelectItem value="contacted">Contatado</SelectItem>
            <SelectItem value="qualified">Qualificado</SelectItem>
            <SelectItem value="unqualified">Desqualificado</SelectItem>
            <SelectItem value="converted">Convertido</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 min-w-[220px]">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Score ≥</span>
          <Slider
            value={[minScore]}
            min={0} max={100} step={5}
            onValueChange={(v) => setMinScore(v[0])}
            className="w-32"
          />
          <span className="text-sm font-medium w-8 text-right">{minScore}</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyEnriched} onCheckedChange={(v) => setOnlyEnriched(!!v)} />
          Só enriquecidos
        </label>
      </div>

      {/* Bulk action bar */}
      {someChecked && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-primary/5 px-4 py-2 text-sm">
          <span className="font-medium">{selectedIds.size} selecionado(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>
              <X className="mr-1 h-3 w-3" /> Limpar
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <XCircle className="mr-1 h-3 w-3" /> Descartar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Descartar {selectedIds.size} lead(s)?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Eles serão marcados como <strong>Desqualificados</strong> e ficarão fora das cadências. Você pode reverter depois editando manualmente cada lead.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDiscard}>Descartar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button size="sm" onClick={() => setEnrollOpen(true)}>
              <Send className="mr-1 h-3 w-3" /> Enviar para cadência
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allChecked} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Carregando...</TableCell>
                </TableRow>
              ) : leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Nenhum lead encontrado.</TableCell>
                </TableRow>
              ) : (
                leads.map((lead: any) => (
                  <TableRow key={lead.id} className="cursor-pointer" onClick={() => setSelectedLead(lead)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(lead.id)}
                        onCheckedChange={() => toggleOne(lead.id)}
                        aria-label="Selecionar lead"
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{lead.name}</span>
                        <ChannelBadges lead={lead} />
                        {lead.lead_kind === "company" && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[10px] px-1.5 py-0" title="Canal corporativo: sem nome de pessoa identificada">
                            🏢 Empresa
                          </Badge>
                        )}
                        {lead.pipeline_mode === "agent" && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0" title="Respostas inbound vão pelo Agente SDR (live)">
                            🤖 Agente
                          </Badge>
                        )}
                        {(() => {
                          const r = computeReadiness(lead, insightsMap[lead.id]);
                          return r ? (
                            <Badge variant="secondary" className={`${r.cls} text-[10px] px-1.5 py-0`} title={r.tooltip}>
                              {r.label}
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>{lead.email || "—"}</TableCell>
                    <TableCell>{lead.company_name || "—"}</TableCell>
                    <TableCell>
                      {lead.website ? (
                        <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate max-w-[150px] inline-block" onClick={(e) => e.stopPropagation()}>
                          {lead.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {lead.score != null ? (
                        <Badge variant="secondary" className={
                          lead.score >= 70 ? "bg-green-100 text-green-800" :
                          lead.score >= 40 ? "bg-yellow-100 text-yellow-800" :
                          "bg-red-100 text-red-800"
                        }>
                          {lead.score}
                        </Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[lead.status] || ""} variant="secondary">
                        {statusLabels[lead.status] || lead.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{lead.source || "—"}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary" title="Editar lead" onClick={() => setEditingLead(lead)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" title="Excluir lead">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Isso removerá <strong>{lead.name}</strong>, suas inscrições em cadências, conversas, mensagens e histórico. Esta ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteLead.mutate(lead.id)}>
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Enroll Dialog */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar {selectedIds.size} lead(s) para cadência</DialogTitle>
            <DialogDescription>
              Os leads serão inscritos com <strong>status ativo</strong> e a primeira mensagem será gerada pela IA. Leads que já estejam nessa cadência serão ignorados.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Select value={chosenCadence} onValueChange={setChosenCadence}>
              <SelectTrigger><SelectValue placeholder="Escolha a cadência" /></SelectTrigger>
              <SelectContent>
                {activeCadences.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">Nenhuma cadência disponível. Crie uma em Cadências.</div>
                ) : (
                  activeCadences.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} <span className="text-xs text-muted-foreground">({c.type} · {c.status})</span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {(() => {
              const cad = activeCadences.find((c: any) => c.id === chosenCadence);
              if (!cad) return null;
              const type = cad.type;
              const selectedLeads = leads.filter((l: any) => selectedIds.has(l.id));
              const missing = selectedLeads.filter((l: any) => {
                if (type === "whatsapp") return !(l.whatsapp || l.phone);
                if (type === "email") return !l.email;
                return !(l.email || l.whatsapp || l.phone);
              });
              if (missing.length === 0) return null;
              const label = type === "whatsapp" ? "WhatsApp" : type === "email" ? "e-mail" : "canal";
              return (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  ⚠️ {missing.length} lead(s) sem {label} serão pulados: {missing.slice(0, 3).map((l: any) => l.name).join(", ")}{missing.length > 3 ? `, +${missing.length - 3}` : ""}.
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollOpen(false)}>Cancelar</Button>
            <Button onClick={handleEnroll} disabled={!chosenCadence || bulk.isPending}>
              {bulk.isPending ? "Enviando..." : "Confirmar envio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LeadDetail lead={selectedLead} open={!!selectedLead} onOpenChange={(open) => !open && setSelectedLead(null)} />
      <LeadFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <LeadFormDialog open={!!editingLead} onOpenChange={(open) => !open && setEditingLead(null)} lead={editingLead} />
      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
