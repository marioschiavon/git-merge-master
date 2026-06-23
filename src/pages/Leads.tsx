import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLeads, useSyncLeads, useIntegration, useDeleteLead } from "@/hooks/usePipedrive";
import { useLeadLists } from "@/hooks/useLeadLists";
import { LeadDetail } from "@/components/LeadDetail";
import { LeadFormDialog } from "@/components/LeadFormDialog";
import { LeadImportDialog } from "@/components/LeadImportDialog";
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
import { RefreshCw, Target, Search, Plus, Upload, Trash2, Pencil, X } from "lucide-react";

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

const enrichmentLabels: Record<string, { label: string; cls: string }> = {
  pending: { label: "Enriquecendo…", cls: "bg-amber-100 text-amber-800" },
  processing: { label: "Enriquecendo…", cls: "bg-amber-100 text-amber-800" },
  completed: { label: "Enriquecido", cls: "bg-emerald-100 text-emerald-800" },
  failed: { label: "Falhou", cls: "bg-red-100 text-red-800" },
};


export default function Leads() {
  const [params, setParams] = useSearchParams();
  const listId = params.get("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<any>(null);

  const { data: allLeads = [], isLoading } = useLeads({ status: statusFilter, search });
  const { data: lists = [] } = useLeadLists();
  const activeList = useMemo(() => lists.find((l) => l.id === listId), [lists, listId]);
  const leads = useMemo(
    () => (listId ? allLeads.filter((l: any) => l.lead_list_id === listId) : allLeads),
    [allLeads, listId],
  );
  const syncMutation = useSyncLeads();
  const { data: integration } = useIntegration("pipedrive");
  const isConnected = integration?.status === "active";
  const deleteLead = useDeleteLead();

  const clearListFilter = () => {
    const p = new URLSearchParams(params);
    p.delete("list");
    setParams(p, { replace: true });
  };

  const actionButtons = (
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => setImportOpen(true)}>
        <Upload className="mr-2 h-4 w-4" /> Importar CSV
      </Button>
      <Button onClick={() => setCreateOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Novo Lead
      </Button>
      {isConnected && (
        <Button
          variant="outline"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Sincronizando..." : "Sincronizar"}
        </Button>
      )}
    </div>
  );

  if (!isConnected && leads.length === 0 && !search && statusFilter === "all") {
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
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, email ou empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="new">Novo</SelectItem>
            <SelectItem value="contacted">Contatado</SelectItem>
            <SelectItem value="qualified">Qualificado</SelectItem>
            <SelectItem value="unqualified">Desqualificado</SelectItem>
            <SelectItem value="converted">Convertido</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                 <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : leads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Nenhum lead encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                leads.map((lead: any) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedLead(lead)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{lead.name}</span>
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
                        {lead.enrichment_status && enrichmentLabels[lead.enrichment_status] && (
                          <Badge variant="secondary" className={`${enrichmentLabels[lead.enrichment_status].cls} text-[10px] px-1.5 py-0`}>
                            {enrichmentLabels[lead.enrichment_status].label}
                          </Badge>
                        )}
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
                      <Badge className={statusColors[lead.status] || ""} variant="secondary">
                        {statusLabels[lead.status] || lead.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{lead.source || "—"}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-primary"
                          title="Editar lead"
                          onClick={() => setEditingLead(lead)}
                        >
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
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => deleteLead.mutate(lead.id)}
                              >
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

      <LeadDetail
        lead={selectedLead}
        open={!!selectedLead}
        onOpenChange={(open) => !open && setSelectedLead(null)}
      />
      <LeadFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <LeadFormDialog
        open={!!editingLead}
        onOpenChange={(open) => !open && setEditingLead(null)}
        lead={editingLead}
      />
      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

