import { useState, useMemo } from "react";
import Papa from "papaparse";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useImportLeads, type LeadInput } from "@/hooks/usePipedrive";
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
  company_name: ["company", "company_name", "empresa", "organização", "organizacao"],
  title: ["title", "cargo", "job_title", "job"],
  website: ["website", "site", "url", "web"],
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
  const importLeads = useImportLeads();

  const parsed = useMemo(() => {
    const valid: LeadInput[] = [];
    let skipped = 0;
    for (const r of rows) {
      const m = mapRow(r);
      if (m) valid.push(m);
      else skipped++;
    }
    return { valid, skipped };
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
    await importLeads.mutateAsync(parsed.valid);
    setRows([]);
    setFileName("");
    onOpenChange(false);
  };

  const reset = (o: boolean) => {
    if (!o) { setRows([]); setFileName(""); }
    onOpenChange(o);
  };

  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const preview = rows.slice(0, 5);

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
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <strong>{parsed.valid.length}</strong> leads válidos
                {parsed.skipped > 0 && <> · <span className="text-destructive">{parsed.skipped} ignorados (sem nome)</span></>}
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
            disabled={parsed.valid.length === 0 || importLeads.isPending}
          >
            {importLeads.isPending ? "Importando..." : `Importar ${parsed.valid.length} leads`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
