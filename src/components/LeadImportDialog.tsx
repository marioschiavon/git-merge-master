import { useState, useMemo, useEffect } from "react";
import Papa from "papaparse";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useImportLeads, type LeadInput } from "@/hooks/usePipedrive";
import { useCadences } from "@/hooks/useCadences";
import { useCreateLeadList } from "@/hooks/useLeadLists";
import { Download, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Campos suportados. Os que casam com colunas da tabela `leads` são gravados
// diretamente; os demais vão para pipedrive_data.csv_import.
type FieldKey =
  | "ignore" | "extra"
  | "first_name" | "last_name" | "name"
  | "email" | "secondary_email" | "personal_email"
  | "phone" | "mobile_phone" | "corporate_phone" | "whatsapp"
  | "title" | "seniority" | "department"
  | "company_name" | "industry" | "employee_count" | "website"
  | "linkedin_url" | "linkedin_company_url" | "instagram_url" | "facebook_url"
  | "address" | "city" | "state" | "country"
  | "tags" | "status" | "source";

const FIELD_LABELS: Record<FieldKey, string> = {
  ignore: "— Ignorar —",
  extra: "Outro (enrichment)",
  first_name: "Primeiro nome",
  last_name: "Sobrenome",
  name: "Nome completo",
  email: "Email",
  secondary_email: "Email secundário",
  personal_email: "Email pessoal",
  phone: "Telefone",
  mobile_phone: "Telefone celular",
  corporate_phone: "Telefone corporativo",
  whatsapp: "WhatsApp",
  title: "Cargo",
  seniority: "Senioridade",
  department: "Departamento",
  company_name: "Empresa",
  industry: "Indústria",
  employee_count: "Nº de funcionários",
  website: "Site",
  linkedin_url: "LinkedIn (pessoa)",
  linkedin_company_url: "LinkedIn (empresa)",
  instagram_url: "Instagram",
  facebook_url: "Facebook",
  address: "Endereço",
  city: "Cidade",
  state: "Estado",
  country: "País",
  tags: "Tags",
  status: "Status",
  source: "Origem",
};

// Colunas reais no `leads` — o resto vira `extra`.
const NATIVE_FIELDS: ReadonlySet<FieldKey> = new Set([
  "name", "email", "phone", "whatsapp", "company_name", "title", "website",
  "instagram_url", "linkedin_url", "linkedin_company_url", "facebook_url",
  "address", "status", "source",
]);

// Ordem importa: mais específico primeiro.
const AUTO_SUGGEST: [RegExp, FieldKey][] = [
  [/linkedin.*(company|empresa|organiza)/i, "linkedin_company_url"],
  [/linkedin/i, "linkedin_url"],
  [/instagram|^ig$/i, "instagram_url"],
  [/facebook|^fb$/i, "facebook_url"],
  [/whats|zap|wpp/i, "whatsapp"],
  [/(mail|email).*(secund|2)/i, "secondary_email"],
  [/(mail|email).*(pessoal|personal)/i, "personal_email"],
  [/e[-_ ]?mail|email/i, "email"],
  [/(mobile|celular)/i, "mobile_phone"],
  [/(corporat|comercial|escrit)/i, "corporate_phone"],
  [/(phone|telefone|^tel$)/i, "phone"],
  [/first.*name|primeiro.*nome|^nome$/i, "first_name"],
  [/last.*name|sobrenome|surname/i, "last_name"],
  [/(full.?name|nome.*completo|nome|name|contato|lead)/i, "name"],
  [/(job.?title|cargo|title|posi[cç][aã]o|role)/i, "title"],
  [/senior/i, "seniority"],
  [/(depart|setor|area|área)/i, "department"],
  [/(company|empresa|organiza)/i, "company_name"],
  [/(indust|segment|nicho|vertical)/i, "industry"],
  [/(employ|funcion|colabor|headcount|size)/i, "employee_count"],
  [/(website|site|url|web|dom[ií]nio)/i, "website"],
  [/(cidade|city)/i, "city"],
  [/(estado|state|uf|prov[ií]nc)/i, "state"],
  [/(pa[ií]s|country)/i, "country"],
  [/(endere[cç]o|address|rua|logradouro)/i, "address"],
  [/tags?|etiquet/i, "tags"],
  [/status|situa[cç][aã]o/i, "status"],
  [/(source|origem|canal)/i, "source"],
];

function normalize(s: string) {
  return String(s || "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function autoSuggest(header: string): FieldKey {
  const n = normalize(header);
  for (const [rx, key] of AUTO_SUGGEST) if (rx.test(n)) return key;
  return "ignore";
}

// Renomeia headers vazios/duplicados, retornando a lista final + avisos.
function normalizeHeaders(raw: string[]): { headers: string[]; renamed: string[] } {
  const seen = new Map<string, number>();
  const renamed: string[] = [];
  const out = raw.map((h, i) => {
    let name = String(h ?? "").trim();
    if (!name) {
      const g = `Coluna ${i + 1}`;
      renamed.push(`(vazio) → ${g}`);
      name = g;
    }
    const key = name.toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) {
      const g = `${name} (${n})`;
      renamed.push(`${name} → ${g}`);
      return g;
    }
    return name;
  });
  return { headers: out, renamed };
}

type Step = 1 | 2 | 3;

export function LeadImportDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [renamedHeaders, setRenamedHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [encodingWarning, setEncodingWarning] = useState(false);
  const [mapping, setMapping] = useState<Record<string, FieldKey>>({});
  const [listName, setListName] = useState("");
  const [cadenceId, setCadenceId] = useState<string>("");
  const [enrichLimit, setEnrichLimit] = useState<string>("");
  const [result, setResult] = useState<{ received: number; created: number; skipped: number; errors: { row: number; message: string }[] } | null>(null);

  const importLeads = useImportLeads();
  const createList = useCreateLeadList();
  const { data: cadences = [] } = useCadences();

  useEffect(() => {
    if (fileName && !listName) {
      setListName(fileName.replace(/\.[^.]+$/, "").trim() || `Importação ${new Date().toLocaleDateString("pt-BR")}`);
    }
  }, [fileName]); // eslint-disable-line react-hooks/exhaustive-deps

  const parseFile = (file: File, encoding: string) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      delimitersToGuess: [",", ";", "\t", "|"],
      encoding,
      complete: (results) => {
        const rows = (results.data as string[][]).filter((r) => r && r.some((c) => String(c || "").trim() !== ""));
        if (rows.length === 0) {
          toast({ title: "CSV vazio", description: "Nenhuma linha detectada.", variant: "destructive" });
          return;
        }
        const { headers, renamed } = normalizeHeaders(rows[0]);
        const body = rows.slice(1);
        const preview = body.slice(0, 30).map((r) => r.join("|")).join("|");
        const hasBadEncoding = /\uFFFD/.test(preview);
        if (hasBadEncoding && encoding === "UTF-8") {
          // Retry com latin1
          parseFile(file, "ISO-8859-1");
          return;
        }
        setRawHeaders(headers);
        setDataRows(body);
        setRenamedHeaders(renamed);
        setEncodingWarning(hasBadEncoding);
        setMapping(Object.fromEntries(headers.map((h) => [h, autoSuggest(h)])));
        setStep(2);
      },
      error: (err) => {
        toast({ title: "Erro ao ler CSV", description: err.message, variant: "destructive" });
      },
    });
  };

  const handleFile = (file: File) => {
    setFileName(file.name);
    parseFile(file, "UTF-8");
  };

  const downloadTemplate = () => {
    const csv = "first_name,last_name,email,phone,whatsapp,company_name,title,website,linkedin_url,tags\nJoão,Silva,joao@empresa.com,11999999999,11999999999,Empresa LTDA,CEO,https://empresa.com,https://linkedin.com/in/joao,vip;quente";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Mapeamento reverso: campo → índice da coluna no CSV
  const fieldToCol = useMemo(() => {
    const m = new Map<FieldKey, number[]>();
    rawHeaders.forEach((h, i) => {
      const f = mapping[h];
      if (!f || f === "ignore") return;
      const arr = m.get(f) || [];
      arr.push(i);
      m.set(f, arr);
    });
    return m;
  }, [rawHeaders, mapping]);

  const mappingValid = useMemo(() => {
    const hasName = fieldToCol.has("name") || (fieldToCol.has("first_name") || fieldToCol.has("last_name"));
    const hasContact = fieldToCol.has("email") || fieldToCol.has("phone") || fieldToCol.has("whatsapp") || fieldToCol.has("mobile_phone") || fieldToCol.has("corporate_phone");
    return { hasName, hasContact, ok: hasName && hasContact };
  }, [fieldToCol]);

  const buildLeads = (): LeadInput[] => {
    const get = (row: string[], f: FieldKey): string => {
      const idxs = fieldToCol.get(f);
      if (!idxs) return "";
      for (const i of idxs) {
        const v = String(row[i] ?? "").trim();
        if (v) return v;
      }
      return "";
    };
    const leads: LeadInput[] = [];
    for (const row of dataRows) {
      const first = get(row, "first_name");
      const last = get(row, "last_name");
      const nameField = get(row, "name");
      const name = nameField || [first, last].filter(Boolean).join(" ").trim();

      const lead: LeadInput = {
        name: name || null,
        email: get(row, "email") || null,
        phone: get(row, "phone") || get(row, "mobile_phone") || get(row, "corporate_phone") || null,
        whatsapp: get(row, "whatsapp") || null,
        company_name: get(row, "company_name") || null,
        title: get(row, "title") || null,
        website: get(row, "website") || null,
        instagram_url: get(row, "instagram_url") || null,
        linkedin_url: get(row, "linkedin_url") || null,
        linkedin_company_url: get(row, "linkedin_company_url") || null,
        facebook_url: get(row, "facebook_url") || null,
        address: get(row, "address") || null,
        status: (get(row, "status") as any) || undefined,
        source: get(row, "source") || null,
      };

      const extra: Record<string, string> = {};
      const addExtra = (k: string, v: string) => { if (v) extra[k] = v; };
      // Todos os campos não-nativos vão para extra
      addExtra("first_name", first);
      addExtra("last_name", last);
      addExtra("secondary_email", get(row, "secondary_email"));
      addExtra("personal_email", get(row, "personal_email"));
      addExtra("mobile_phone", get(row, "mobile_phone"));
      addExtra("corporate_phone", get(row, "corporate_phone"));
      addExtra("seniority", get(row, "seniority"));
      addExtra("department", get(row, "department"));
      addExtra("industry", get(row, "industry"));
      addExtra("employee_count", get(row, "employee_count"));
      addExtra("city", get(row, "city"));
      addExtra("state", get(row, "state"));
      addExtra("country", get(row, "country"));
      const tags = get(row, "tags");
      if (tags) {
        const parts = tags.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        if (parts.length) extra.tags = parts.join(",");
      }
      // Colunas mapeadas como "extra" — usam o header original como chave
      rawHeaders.forEach((h, i) => {
        if (mapping[h] === "extra") {
          const v = String(row[i] ?? "").trim();
          if (v) extra[h] = v;
        }
      });

      if (Object.keys(extra).length) lead.extra = extra;
      leads.push(lead);
    }
    return leads;
  };

  const stats = useMemo(() => {
    if (step !== 3) return null;
    const total = dataRows.length;
    let withName = 0, withEmail = 0, withPhone = 0;
    const nameIdx = (fieldToCol.get("name") || [])[0];
    const firstIdx = (fieldToCol.get("first_name") || [])[0];
    const lastIdx = (fieldToCol.get("last_name") || [])[0];
    const emailIdx = (fieldToCol.get("email") || [])[0];
    const phoneIdxs = [
      ...(fieldToCol.get("phone") || []),
      ...(fieldToCol.get("whatsapp") || []),
      ...(fieldToCol.get("mobile_phone") || []),
      ...(fieldToCol.get("corporate_phone") || []),
    ];
    for (const r of dataRows) {
      const hasName =
        (nameIdx !== undefined && String(r[nameIdx] || "").trim()) ||
        (firstIdx !== undefined && String(r[firstIdx] || "").trim()) ||
        (lastIdx !== undefined && String(r[lastIdx] || "").trim());
      if (hasName) withName++;
      if (emailIdx !== undefined && String(r[emailIdx] || "").trim()) withEmail++;
      if (phoneIdxs.some((i) => String(r[i] || "").trim())) withPhone++;
    }
    const extraCount = rawHeaders.filter((h) => mapping[h] === "extra").length;
    return { total, withName, withEmail, withPhone, extraCount };
  }, [step, dataRows, fieldToCol, rawHeaders, mapping]);

  const handleImport = async () => {
    const leads = buildLeads();
    if (leads.length === 0) return;
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
    const cap = enrichLimit === "" ? null : Math.max(0, Number(enrichLimit) || 0);
    const res = await importLeads.mutateAsync({ leads, lead_list_id, enrich_limit: cap });
    setResult(res);
  };

  const resetAll = () => {
    setStep(1);
    setFileName("");
    setRawHeaders([]);
    setRenamedHeaders([]);
    setDataRows([]);
    setEncodingWarning(false);
    setMapping({});
    setListName("");
    setCadenceId("");
    setResult(null);
  };

  const onOpen = (o: boolean) => {
    if (!o) resetAll();
    onOpenChange(o);
  };

  const preview = dataRows.slice(0, 5);
  const busy = importLeads.isPending || createList.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Importar leads via CSV{" "}
            <span className="text-sm font-normal text-muted-foreground">
              — Passo {step} de 3
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* STEP 1: Upload */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Envie um arquivo <code>.csv</code>. Delimitador e codificação são detectados automaticamente.
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
          </div>
        )}

        {/* STEP 2: Mapeamento */}
        {step === 2 && (
          <div className="space-y-4">
            {(renamedHeaders.length > 0 || encodingWarning) && (
              <Alert variant="default" className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/30">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle>Avisos ao ler o arquivo</AlertTitle>
                <AlertDescription className="text-xs space-y-1">
                  {encodingWarning && <div>Codificação parece incorreta — caracteres substituídos por “�”.</div>}
                  {renamedHeaders.length > 0 && (
                    <div>Colunas renomeadas: {renamedHeaders.join(" · ")}</div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="rounded-md border overflow-x-auto max-h-[380px]">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead className="w-[40%]">Coluna no CSV</TableHead>
                    <TableHead>Mapear para</TableHead>
                    <TableHead>Exemplo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawHeaders.map((h, i) => (
                    <TableRow key={h + i}>
                      <TableCell className="font-medium">{h}</TableCell>
                      <TableCell>
                        <Select
                          value={mapping[h] || "ignore"}
                          onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v as FieldKey }))}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent className="max-h-[300px]">
                            {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => (
                              <SelectItem key={k} value={k}>
                                {FIELD_LABELS[k]}
                                {k !== "ignore" && k !== "extra" && !NATIVE_FIELDS.has(k) && (
                                  <span className="ml-1 text-[10px] text-muted-foreground">(enrichment)</span>
                                )}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {preview.map((r) => r[i]).filter(Boolean).slice(0, 2).join(" · ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {!mappingValid.ok && (
              <Alert variant="destructive">
                <AlertTitle>Mapeamento incompleto</AlertTitle>
                <AlertDescription className="text-xs">
                  É necessário mapear um <strong>nome</strong> (ou primeiro + sobrenome) e pelo menos um contato:{" "}
                  <strong>email</strong>, <strong>telefone</strong> ou <strong>WhatsApp</strong>.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* STEP 3: Revisão */}
        {step === 3 && (
          <div className="space-y-4">
            {!result && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Linhas" value={stats?.total ?? 0} />
                  <StatCard label="Com nome" value={stats?.withName ?? 0} />
                  <StatCard label="Com email" value={stats?.withEmail ?? 0} />
                  <StatCard label="Com telefone" value={stats?.withPhone ?? 0} />
                </div>
                {stats && stats.extraCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {stats.extraCount} coluna(s) marcada(s) como <em>Outro</em> serão salvas em{" "}
                    <code>pipedrive_data.csv_import</code>.
                  </p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="list-name">Nome da lista</Label>
                    <Input id="list-name" value={listName} onChange={(e) => setListName(e.target.value)} />
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
                  </div>
                </div>
              </>
            )}

            {result && (
              <Alert>
                <AlertTitle>Resultado</AlertTitle>
                <AlertDescription className="text-sm space-y-2">
                  <div>
                    <strong>{result.created}</strong> criados · <strong>{result.skipped}</strong> ignorados ·{" "}
                    <strong>{result.errors.length}</strong> erros (de {result.received} recebidos)
                  </div>
                  {result.errors.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer">Ver erros</summary>
                      <ul className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
                        {result.errors.map((e, i) => (
                          <li key={i}>Linha ~{e.row}: {e.message}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && !result && (
            <Button variant="outline" onClick={() => setStep((s) => (s - 1) as Step)} disabled={busy}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpen(false)}>
            {result ? "Fechar" : "Cancelar"}
          </Button>
          {step === 2 && (
            <Button onClick={() => setStep(3)} disabled={!mappingValid.ok}>
              Continuar <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
          {step === 3 && !result && (
            <Button onClick={handleImport} disabled={busy || (stats?.total ?? 0) === 0}>
              {busy ? "Importando..." : `Importar ${stats?.total ?? 0} leads`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
