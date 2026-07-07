import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Search, Loader2, Linkedin, Building2, MapPin, AlertCircle, Database,
  CheckCircle2, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  APOLLO_EMPLOYEE_RANGES, APOLLO_SENIORITIES,
  useApolloImport, useApolloSearch, useApolloStatus,
} from "@/hooks/useApollo";

type FiltersState = {
  q_keywords: string;
  person_titles: string;
  person_seniorities: string[];
  person_locations: string;
  organization_industries: string;
  organization_num_employees_ranges: string[];
  per_page: number;
};

const defaultFilters: FiltersState = {
  q_keywords: "",
  person_titles: "",
  person_seniorities: [],
  person_locations: "",
  organization_industries: "",
  organization_num_employees_ranges: [],
  per_page: 25,
};

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export default function ApolloSearch() {
  const statusQuery = useApolloStatus();
  const searchMut = useApolloSearch();
  const importMut = useApolloImport();

  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<any>(null);
  const [selected, setSelected] = useState<Record<string, any>>({});
  const [enrichLimit, setEnrichLimit] = useState<string>("");

  const isConnected = !!statusQuery.data?.connected;

  const runSearch = (p: number) => {
    setPage(p);
    searchMut.mutate(
      {
        filters: {
          q_keywords: filters.q_keywords || undefined,
          person_titles: splitList(filters.person_titles),
          person_seniorities: filters.person_seniorities,
          person_locations: splitList(filters.person_locations),
          organization_industries: splitList(filters.organization_industries),
          organization_num_employees_ranges: filters.organization_num_employees_ranges,
          per_page: filters.per_page,
        },
        page: p,
      },
      {
        onSuccess: (r) => {
          setResults(r);
          setSelected({});
        },
      },
    );
  };

  const people = (results?.people ?? []) as any[];
  const pagination = results?.pagination;
  const existingEmails = new Set<string>((results?.existingEmails ?? []).map((e: string) => e.toLowerCase()));
  const existingApolloIds = new Set<string>(results?.existingApolloIds ?? []);
  const selectedCount = Object.keys(selected).length;
  const allSelected = useMemo(
    () => people.length > 0 && people.every((p) => selected[p.id]),
    [people, selected],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Busca Apollo</h1>
          <p className="text-sm text-muted-foreground">
            Encontre prospects por cargo, senioridade, indústria e localização. Importe direto para a base.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link to="/leads"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar</Link>
        </Button>
      </div>

      {!statusQuery.isLoading && !isConnected && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 text-amber-700" />
            <div>
              <p className="font-medium">Apollo não está conectado.</p>
              <p className="text-muted-foreground">
                Conecte sua chave em{" "}
                <Link to="/settings/integrations" className="text-primary hover:underline">Integrações</Link>{" "}
                para começar a buscar.
              </p>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-xl border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Palavras-chave">
            <Input
              placeholder="ex: SaaS, growth, agência"
              value={filters.q_keywords}
              onChange={(e) => setFilters({ ...filters, q_keywords: e.target.value })}
            />
          </Field>
          <Field label="Cargos (separados por vírgula)">
            <Input
              placeholder="CEO, Marketing Manager, CMO"
              value={filters.person_titles}
              onChange={(e) => setFilters({ ...filters, person_titles: e.target.value })}
            />
          </Field>
          <Field label="Localização da pessoa">
            <Input
              placeholder="Brazil, Argentina, São Paulo"
              value={filters.person_locations}
              onChange={(e) => setFilters({ ...filters, person_locations: e.target.value })}
            />
          </Field>
          <Field label="Indústrias">
            <Input
              placeholder="software, marketing, financial services"
              value={filters.organization_industries}
              onChange={(e) => setFilters({ ...filters, organization_industries: e.target.value })}
            />
          </Field>
          <Field label="Senioridade">
            <MultiToggle
              options={APOLLO_SENIORITIES as unknown as string[]}
              value={filters.person_seniorities}
              onChange={(v) => setFilters({ ...filters, person_seniorities: v })}
            />
          </Field>
          <Field label="Tamanho da empresa">
            <MultiToggle
              options={APOLLO_EMPLOYEE_RANGES as unknown as string[]}
              value={filters.organization_num_employees_ranges}
              onChange={(v) => setFilters({ ...filters, organization_num_employees_ranges: v })}
            />
          </Field>
          <Field label="Resultados por página">
            <Select
              value={String(filters.per_page)}
              onValueChange={(v) => setFilters({ ...filters, per_page: Number(v) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button disabled={!isConnected || searchMut.isPending} onClick={() => runSearch(1)}>
            {searchMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
            Buscar
          </Button>
          <Button variant="ghost" onClick={() => { setFilters(defaultFilters); setResults(null); setSelected({}); }}>
            Limpar
          </Button>
          {results?.fromCache && (
            <Badge variant="secondary" className="gap-1">
              <Database className="h-3 w-3" /> Em cache (24h)
            </Badge>
          )}
        </div>
      </section>

      {results && (
        <section className="space-y-3 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{pagination?.total_entries ?? people.length}</span>{" "}
              resultados · página {pagination?.page ?? page} de {Math.min(pagination?.total_pages ?? 1, 5)}
            </div>
            <Button
              size="sm"
              disabled={!selectedCount || importMut.isPending}
              onClick={() => {
                if (confirm(`Importar ${selectedCount} leads para a base?`))
                  importMut.mutate(Object.values(selected), { onSuccess: () => setSelected({}) });
              }}
            >
              {importMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
              Importar selecionados ({selectedCount})
            </Button>
          </div>

          {people.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum resultado.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-10 p-2 text-left">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            const next: Record<string, any> = {};
                            for (const p of people) next[p.id] = p;
                            setSelected(next);
                          } else setSelected({});
                        }}
                      />
                    </th>
                    <th className="p-2 text-left">Pessoa</th>
                    <th className="p-2 text-left">Empresa</th>
                    <th className="p-2 text-left">Local</th>
                    <th className="p-2 text-left">Email</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => {
                    const already =
                      existingApolloIds.has(p.id) ||
                      (p.email && existingEmails.has(String(p.email).toLowerCase()));
                    const checked = !!selected[p.id];
                    return (
                      <tr key={p.id} className="border-t hover:bg-muted/20">
                        <td className="p-2">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              const next = { ...selected };
                              if (c) next[p.id] = p; else delete next[p.id];
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td className="p-2">
                          <div className="font-medium">
                            {p.name ?? (`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || "—")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {p.title ?? "—"}
                            {p.linkedin_url && (
                              <a href={p.linkedin_url} target="_blank" rel="noreferrer"
                                className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline">
                                <Linkedin className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1 text-xs">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            {p.organization?.name ?? "—"}
                          </div>
                          {p.organization?.industry && (
                            <div className="text-xs text-muted-foreground">{p.organization.industry}</div>
                          )}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1 text-xs">
                            <MapPin className="h-3 w-3 text-muted-foreground" />
                            {[p.city, p.state, p.country].filter(Boolean).join(", ") || "—"}
                          </div>
                        </td>
                        <td className="p-2 font-mono text-xs">
                          {p.email
                            ? p.email.includes("email_not_unlocked")
                              ? <span className="text-muted-foreground">bloqueado</span>
                              : p.email
                            : "—"}
                        </td>
                        <td className="p-2">
                          {already ? (
                            <Badge variant="secondary" className="gap-1 border-transparent bg-amber-500/10 text-amber-700">
                              <CheckCircle2 className="h-3 w-3" /> Já na base
                            </Badge>
                          ) : <Badge variant="outline">Novo</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pagination && pagination.total_pages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button size="sm" variant="outline"
                disabled={page <= 1 || searchMut.isPending}
                onClick={() => runSearch(page - 1)}>
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                Página {page} (máximo 5 por busca para proteger créditos)
              </span>
              <Button size="sm" variant="outline"
                disabled={page >= Math.min(pagination.total_pages, 5) || searchMut.isPending}
                onClick={() => runSearch(page + 1)}>
                Próxima
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function MultiToggle({
  options, value, onChange,
}: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-full border px-2 py-0.5 text-xs transition ${
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.replace(/_/g, " ")}
          </button>
        );
      })}
    </div>
  );
}
