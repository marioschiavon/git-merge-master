import { useState, useMemo, useEffect } from "react";
import Papa from "papaparse";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useImportLeads, type LeadInput } from "@/hooks/usePipedrive";
import { useCadences } from "@/hooks/useCadences";
import { useCreateLeadList } from "@/hooks/useLeadLists";
import { Download } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FIELD_ALIASES: Record<keyof LeadInput, string[]> = {
  name: ["name", "nome", "full name", "lead", "contato"],
  email: ["email", "e-mail", "mail"],
  phone: ["phone", "telefone", "celular", "tel", "mobile"],
  whatsapp: ["whatsapp", "whats", "zap", "wpp"],
  company_name: ["company", "company_name", "empresa", "organização", "organizacao"],
  title: ["title", "cargo", "job_title", "job"],
  website: ["website", "site", "url", "web"],
  instagram_url: ["instagram", "instagram_url", "ig"],
  linkedin_url: ["linkedin", "linkedin_url", "linkedin_pessoa"],
  linkedin_company_url: ["linkedin_empresa", "linkedin_company", "linkedin_company_url"],
  facebook_url: ["facebook", "facebook_url", "fb"],
  address: ["address", "endereço", "endereco"],
  status: ["status"],
  source: ["source", "origem"],
};

function normalize(s: string) {
  return s.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function mapRow(row: Record<string, string>): LeadInput | null {
  const out: any = {};
  const keys = Object.keys(row);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const k = keys.find((k) => aliases.includes(normalize(k)));
    if (k && row[k]) out[field] = String(row[k]).trim();
  }
  if (!out.name) return null;
  return out as LeadInput;
}

export function LeadImportDialog({ open, onOpenChange }: Props) {
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [listName, setListName] = useState("");
  const [cadenceId, setCadenceId] = useState<string>("");
  const importLeads = useImportLeads();
  const createList = useCreateLeadList();
  const { data: cadences = [] } = useCadences();

  // Default list name to file name (minus extension) when file changes
  useEffect(() => {
    if (fileName && !listName) {
      setListName(fileName.replace(/\.[^.]+$/, "").trim() || `Importação ${new Date().toLocaleDateString("pt-BR")}`);
    }
  }, [fileName]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => {
    const valid: LeadInput[] = [];
    let skipped = 0;
    let companyOnly = 0;
    for (const r of rows) {
      const m = mapRow(r);
      if (m) {
        valid.push(m);
        if (!m.name || !String(m.name).trim()) companyOnly++;
      } else {
        skipped++;
      }
    }
    return { valid, skipped, companyOnly };
  }, [rows]);

  const handleFile = (file: File) => {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setRows(results.data);
      },
      error: (err) => {
        toast({ title: "Erro ao ler CSV", description: err.message, variant: "destructive" });
      },
    });
  };

  const downloadTemplate = () => {
    const csv = "name,email,phone,company_name,title,website,address\nJoão Silva,joao@empresa.com,11999999999,Empresa LTDA,CEO,https://empresa.com,Rua Exemplo 123";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (parsed.valid.length === 0) return;
    const name = listName.trim() || `Importação ${new Date().toLocaleString("pt-BR")}`;
    let lead_list_id: string | null = null;
    try {
      const list = await createList.mutateAsync({
        name,
        source: "csv",
        file_name: fileName || null,
        default_cadence_id: cadenceId || null,
      });
      lead_list_id = list.id;
    } catch (e: any) {
      toast({ title: "Falha ao criar lista", description: e?.message || String(e), variant: "destructive" });
      return;
    }
    await importLeads.mutateAsync({ leads: parsed.valid, lead_list_id });
    setRows([]); setFileName(""); setListName(""); setCadenceId("");
    onOpenChange(false);
  };

  const reset = (o: boolean) => {
    if (!o) { setRows([]); setFileName(""); setListName(""); setCadenceId(""); }
    onOpenChange(o);
  };

  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const preview = rows.slice(0, 5);
  const busy = importLeads.isPending || createList.isPending;

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar leads via CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              O CSV deve ter uma linha de cabeçalho. Colunas aceitas: name, email, phone, company_name, title, website, address.
            </p>
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="mr-2 h-4 w-4" /> Modelo
            </Button>
          </div>

          <div>
            <Label htmlFor="csv-file">Arquivo CSV</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {fileName && <p className="mt-1 text-xs text-muted-foreground">{fileName}</p>}
          </div>

          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="list-name">Nome da lista</Label>
                  <Input
                    id="list-name"
                    value={listName}
                    onChange={(e) => setListName(e.target.value)}
                    placeholder="Ex: Pet shops SP — out/2024"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">Usado para agrupar e acompanhar este lote.</p>
                </div>
                <div>
                  <Label htmlFor="cadence">Cadência (opcional)</Label>
                  <Select value={cadenceId || "none"} onValueChange={(v) => setCadenceId(v === "none" ? "" : v)}>
                    <SelectTrigger id="cadence"><SelectValue placeholder="Nenhuma" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma (usar configuração padrão)</SelectItem>
                      {cadences.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">Referência da lista. A inscrição segue a cadência padrão da empresa.</p>
                </div>
              </div>

              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <div><strong>{parsed.valid.length}</strong> leads válidos
                {parsed.companyOnly > 0 && <> · <span className="text-amber-700">{parsed.companyOnly} sem nome (modo empresa)</span></>}
                {parsed.skipped > 0 && <> · <span className="text-destructive">{parsed.skipped} ignorados (sem dados de contato)</span></>}</div>
                <p className="text-xs text-muted-foreground">
                  Após importar, o enriquecimento e a geração da 1ª mensagem rodam em background. As mensagens aparecem em Aprovações agrupadas por esta lista.
                </p>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((h) => <TableHead key={h}>{h}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((r, i) => (
                      <TableRow key={i}>
                        {headers.map((h) => <TableCell key={h} className="max-w-[180px] truncate">{r[h]}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)}>Cancelar</Button>
          <Button
            onClick={handleImport}
            disabled={parsed.valid.length === 0 || busy}
          >
            {busy ? "Importando..." : `Importar ${parsed.valid.length} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
