import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { useLeadLists, useDeleteLeadList, useArchiveLeadList } from "@/hooks/useLeadLists";
import { LeadImportDialog } from "@/components/LeadImportDialog";
import { ListChecks, Upload, Trash2, ExternalLink, Rocket, Archive, ArchiveRestore } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function LeadLists() {
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const { data: lists = [], isLoading } = useLeadLists({ archived: showArchived });
  const del = useDeleteLeadList();
  const archive = useArchiveLeadList();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <ListChecks className="h-6 w-6" />
            Listas de leads
          </h1>
          <p className="text-muted-foreground">
            Acompanhe lotes importados: enriquecimento, aprovações pendentes e envios.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowArchived(v => !v)}>
            {showArchived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}
            {showArchived ? "Ver ativas" : "Ver arquivadas"}
          </Button>
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Importar CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lista</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-center">Leads</TableHead>
                <TableHead className="text-center">Enriquecidos</TableHead>
                <TableHead className="text-center">Em enriquecimento</TableHead>
                <TableHead className="text-center">Aprovações pendentes</TableHead>
                <TableHead>Criada</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : lists.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  Nenhuma lista importada ainda. Clique em <strong>Importar CSV</strong>.
                </TableCell></TableRow>
              ) : (
                lists.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => navigate(`/leads?list=${l.id}`)}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{l.name}</span>
                        {l.failed > 0 && (
                          <Badge variant="secondary" className="bg-red-100 text-red-800 text-[10px]">
                            {l.failed} falha{l.failed > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      {l.file_name && <p className="text-[11px] text-muted-foreground mt-0.5">{l.file_name}</p>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] uppercase">{l.source}</Badge></TableCell>
                    <TableCell className="text-center">{l.total}</TableCell>
                    <TableCell className="text-center">
                      <span className="text-emerald-700 font-medium">{l.enriched}</span>
                      <span className="text-muted-foreground">/{l.total}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      {l.enriching > 0 ? (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800">{l.enriching}</Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-center">
                      {l.pending_approval > 0 ? (
                        <Button variant="link" size="sm" className="h-auto p-0 text-amber-700" onClick={(e) => { e.stopPropagation(); navigate(`/approvals?batch=${l.id}`); }}>
                          {l.pending_approval} <ExternalLink className="ml-1 h-3 w-3" />
                        </Button>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(l.created_at), { locale: ptBR, addSuffix: true })}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Lançar campanha"
                          onClick={() => navigate(`/leads/lists/${l.id}/launch`)}
                        >
                          <Rocket className="h-4 w-4 text-primary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={showArchived ? "Desarquivar" : "Arquivar"}
                          onClick={() => archive.mutate({ id: l.id, archive: !showArchived })}
                        >
                          {showArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir lista?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Os leads importados <strong>não</strong> serão removidos — apenas o agrupamento da lista <strong>{l.name}</strong> será excluído.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => del.mutate(l.id)}
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

      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
