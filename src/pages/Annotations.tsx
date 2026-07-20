import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NotebookPen, Trash2, FileJson, FileSpreadsheet, Search } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAnnotations, useDeleteAnnotation, type AnnotationRow, type AnnotationFilters } from "@/hooks/useAnnotations";

const sourceLabel: Record<string, string> = {
  approval_request: "Aprovação",
  cadence_agent_decision: "Decisão do agente",
};

const actionLabel: Record<string, string> = {
  approved: "Aprovado",
  edited: "Editado",
  rejected: "Rejeitado",
  none: "—",
};

const actionColor: Record<string, string> = {
  approved: "bg-green-100 text-green-800",
  edited: "bg-blue-100 text-blue-800",
  rejected: "bg-red-100 text-red-800",
  none: "bg-muted text-muted-foreground",
};

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: AnnotationRow[]) {
  const headers = ["created_at", "source_kind", "lead_name", "human_action", "note", "final_content"];
  const escape = (v: any) => {
    const s = (v ?? "").toString().replace(/"/g, '""');
    return `"${s}"`;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.created_at,
      r.source_kind,
      r.leads?.name || r.leads?.company_name || "",
      r.human_action || "",
      r.note,
      r.final_content || "",
    ].map(escape).join(","));
  }
  return lines.join("\n");
}

export default function AnnotationsPage() {
  const [filters, setFilters] = useState<AnnotationFilters>({ source_kind: "all" });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AnnotationRow | null>(null);
  const { data: rows = [], isLoading } = useAnnotations({ ...filters, search });
  const del = useDeleteAnnotation();

  const exportName = useMemo(() => `anotacoes-${format(new Date(), "yyyyMMdd-HHmm")}`, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <NotebookPen className="h-6 w-6" />
            Anotações
          </h1>
          <p className="text-sm text-muted-foreground">
            A IA lê as anotações mais recentes deste lead/empresa antes de gerar próximas mensagens — use para corrigir tom, ganchos e o que evitar. Correções (rejeitada / editada) têm prioridade.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={!rows.length}
            onClick={() => download(`${exportName}.csv`, toCsv(rows), "text/csv")}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" disabled={!rows.length}
            onClick={() => download(`${exportName}.json`, JSON.stringify(rows, null, 2), "application/json")}>
            <FileJson className="h-4 w-4 mr-1.5" /> JSON
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 grid gap-3 md:grid-cols-[1fr_220px_180px_180px]">
          <div>
            <Label className="text-xs">Buscar no texto</Label>
            <div className="relative mt-1">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Palavra-chave..." className="pl-8" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Fonte</Label>
            <Select value={filters.source_kind || "all"}
              onValueChange={(v: any) => setFilters((f) => ({ ...f, source_kind: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="approval_request">Aprovação</SelectItem>
                <SelectItem value="cadence_agent_decision">Decisão do agente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" className="mt-1"
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" className="mt-1"
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value ? new Date(e.target.value + "T23:59:59").toISOString() : null }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">{rows.length} anotação(ões)</CardTitle>
        </CardHeader>
        <ScrollArea className="h-[calc(100vh-340px)]">
          <div className="divide-y">
            {isLoading && <p className="p-4 text-sm text-muted-foreground">Carregando...</p>}
            {!isLoading && rows.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma anotação ainda. Anote em /approvals ou no drawer do lead.
              </p>
            )}
            {rows.map((r) => (
              <button key={r.id} onClick={() => setSelected(r)}
                className="w-full text-left p-3 hover:bg-muted/50 transition">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium truncate">
                    {r.leads?.name || r.leads?.company_name || "Sem lead"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(r.created_at), { locale: ptBR, addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">{sourceLabel[r.source_kind]}</Badge>
                  {r.human_action && (
                    <Badge className={`text-[10px] ${actionColor[r.human_action]}`} variant="secondary">
                      {actionLabel[r.human_action]}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{r.note}</p>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <NotebookPen className="h-5 w-5" />
                  Anotação
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{sourceLabel[selected.source_kind]}</Badge>
                  {selected.human_action && (
                    <Badge className={actionColor[selected.human_action]}>
                      {actionLabel[selected.human_action]}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(selected.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </span>
                </div>

                {selected.leads && (
                  <div className="rounded border p-3">
                    <Label className="text-xs">Lead</Label>
                    <p className="font-medium">{selected.leads.name || "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {selected.leads.company_name} {selected.leads.email ? `· ${selected.leads.email}` : ""}
                    </p>
                  </div>
                )}

                <div className="rounded border p-3 bg-amber-50 border-amber-200">
                  <Label className="text-xs text-amber-900">Nota</Label>
                  <p className="mt-1 whitespace-pre-wrap text-amber-950">{selected.note}</p>
                </div>

                {selected.final_content && (
                  <div className="rounded border p-3">
                    <Label className="text-xs">Conteúdo final</Label>
                    <pre className="mt-1 whitespace-pre-wrap text-xs font-mono">{selected.final_content}</pre>
                  </div>
                )}

                <details className="rounded border p-3">
                  <summary className="cursor-pointer text-xs font-medium">Snapshot do contexto (JSON)</summary>
                  <pre className="mt-2 text-[10px] overflow-x-auto bg-muted p-2 rounded">
                    {JSON.stringify(selected.context_snapshot, null, 2)}
                  </pre>
                </details>

                <div className="flex justify-end pt-2">
                  <Button variant="destructive" size="sm"
                    onClick={() => { del.mutate(selected.id); setSelected(null); }}>
                    <Trash2 className="h-4 w-4 mr-1.5" /> Excluir anotação
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
