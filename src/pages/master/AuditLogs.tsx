import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Activity, AlertTriangle, RefreshCw, ShieldAlert, Users } from "lucide-react";
import { formatBRTShort } from "@/lib/datetime";

type Severity = "info" | "warn" | "error" | "critical";

interface AuditRow {
  id: string;
  created_at: string;
  company_id: string | null;
  user_id: string | null;
  user_email: string | null;
  event_type: string;
  severity: Severity;
  entity_type: string | null;
  entity_id: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
}

interface CompanyOpt {
  id: string;
  name: string;
}

const PERIODS: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
];

const SEVERITY_STYLES: Record<Severity, string> = {
  info: "bg-blue-100 text-blue-800 border-blue-200",
  warn: "bg-amber-100 text-amber-800 border-amber-200",
  error: "bg-red-100 text-red-800 border-red-200",
  critical: "bg-red-600 text-white border-red-700",
};

const PAGE_SIZE = 50;

export default function AuditLogs() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<CompanyOpt[]>([]);
  const [periodHours, setPeriodHours] = useState(24);
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  useEffect(() => {
    supabase
      .from("companies")
      .select("id, name")
      .order("name", { ascending: true })
      .then(({ data }) => setCompanies(data ?? []));
  }, []);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - periodHours * 3600 * 1000).toISOString();
    let q = supabase
      .from("audit_logs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(0, (page + 1) * PAGE_SIZE - 1);

    if (companyFilter !== "all") q = q.eq("company_id", companyFilter);
    if (errorsOnly) q = q.in("severity", ["error", "critical"]);
    else if (severityFilter !== "all") q = q.eq("severity", severityFilter);
    if (search.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or(`user_email.ilike.${s},message.ilike.${s},event_type.ilike.${s},entity_id.ilike.${s}`);
    }
    const { data } = await q;
    setRows((data ?? []) as AuditRow[]);
    setLoading(false);
  };

  useEffect(() => {
    setPage(0);
  }, [periodHours, companyFilter, severityFilter, errorsOnly, search]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodHours, companyFilter, severityFilter, errorsOnly, search, page]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, periodHours, companyFilter, severityFilter, errorsOnly, search, page]);

  const stats = useMemo(() => {
    const last24 = rows.filter((r) => new Date(r.created_at).getTime() > Date.now() - 24 * 3600 * 1000);
    return {
      total: last24.length,
      errors: last24.filter((r) => r.severity === "error" || r.severity === "critical").length,
      warns: last24.filter((r) => r.severity === "warn").length,
      companies: new Set(last24.map((r) => r.company_id).filter(Boolean)).size,
    };
  }, [rows]);

  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name ?? id.slice(0, 8) : "—");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Logs de Auditoria</h1>
          <p className="text-muted-foreground">Ações de usuários, eventos do sistema e erros</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="auto-refresh" className="text-sm text-muted-foreground">Auto-refresh 30s</Label>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Eventos (24h)</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Erros (24h)</CardTitle>
            <ShieldAlert className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{stats.errors}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Warnings (24h)</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{stats.warns}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Empresas ativas (24h)</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{stats.companies}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <Button
                  key={p.hours}
                  size="sm"
                  variant={periodHours === p.hours ? "default" : "outline"}
                  onClick={() => setPeriodHours(p.hours)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Empresa" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as empresas</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={severityFilter} onValueChange={setSeverityFilter} disabled={errorsOnly}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Severidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch id="errors-only" checked={errorsOnly} onCheckedChange={setErrorsOnly} />
              <Label htmlFor="errors-only" className="text-sm">Só erros</Label>
            </div>
            <Input
              placeholder="Buscar (email, evento, mensagem, entidade)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[240px] max-w-[420px]"
            />
          </div>

          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[160px]">Quando</TableHead>
                  <TableHead className="w-[90px]">Nível</TableHead>
                  <TableHead className="w-[180px]">Empresa</TableHead>
                  <TableHead className="w-[200px]">Usuário</TableHead>
                  <TableHead className="w-[200px]">Evento</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhum evento no período selecionado
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="text-xs whitespace-nowrap">{formatBRTShort(r.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SEVERITY_STYLES[r.severity]}>{r.severity}</Badge>
                    </TableCell>
                    <TableCell className="text-sm truncate max-w-[180px]" title={companyName(r.company_id)}>
                      {companyName(r.company_id)}
                    </TableCell>
                    <TableCell className="text-sm truncate max-w-[200px]" title={r.user_email ?? ""}>
                      {r.user_email ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm font-mono truncate max-w-[200px]" title={r.event_type}>
                      {r.event_type}
                    </TableCell>
                    <TableCell className="text-sm truncate max-w-[400px]" title={r.message ?? ""}>
                      {r.message ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>
                        Detalhes
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {rows.length >= (page + 1) * PAGE_SIZE && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setPage((p) => p + 1)} disabled={loading}>
                Carregar mais
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalhes do evento</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-3 text-sm">
              <Row label="Quando" value={formatBRTShort(selected.created_at)} />
              <Row label="Nível">
                <Badge variant="outline" className={SEVERITY_STYLES[selected.severity]}>{selected.severity}</Badge>
              </Row>
              <Row label="Evento" value={selected.event_type} mono />
              <Row label="Empresa" value={companyName(selected.company_id)} />
              <Row label="Usuário" value={selected.user_email ?? "—"} />
              <Row label="Entidade" value={selected.entity_type ? `${selected.entity_type} · ${selected.entity_id ?? ""}` : "—"} />
              <Row label="Mensagem" value={selected.message ?? "—"} />
              <Row label="IP" value={selected.ip ?? "—"} mono />
              <Row label="User-agent" value={selected.user_agent ?? "—"} />
              <div>
                <div className="text-xs text-muted-foreground mb-1">Metadata</div>
                <pre className="bg-muted rounded p-2 text-xs overflow-auto max-h-[400px]">
                  {JSON.stringify(selected.metadata ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value, children, mono }: { label: string; value?: string; children?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-xs break-all" : "break-words"}>{children ?? value}</div>
    </div>
  );
}
