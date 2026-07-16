import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, Coins, DollarSign, Cpu } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMasterAiUsage, type UsagePeriod } from "@/hooks/useMasterAiUsage";
import { formatBrl, formatTokens, formatUsd, USD_TO_BRL } from "@/lib/ai-pricing";

export default function MasterDashboard() {
  const [period, setPeriod] = useState<UsagePeriod>(30);
  const [activeCompanies, setActiveCompanies] = useState<number>(0);
  const usage = useMasterAiUsage(period);

  useEffect(() => {
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .in("status", ["active", "trial"])
      .then(({ count }) => setActiveCompanies(count ?? 0));
  }, []);

  const periodLabel = period === 7 ? "7d" : period === 30 ? "30d" : "90d";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Painel Master</h1>
          <p className="text-muted-foreground">Consumo de IA e visão geral da plataforma</p>
        </div>
        <Tabs value={String(period)} onValueChange={(v) => setPeriod(Number(v) as UsagePeriod)}>
          <TabsList>
            <TabsTrigger value="7">7 dias</TabsTrigger>
            <TabsTrigger value="30">30 dias</TabsTrigger>
            <TabsTrigger value="90">90 dias</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Empresas ativas</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCompanies}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tokens ({periodLabel})</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatTokens(usage.totals.totalTokens)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatTokens(usage.totals.promptTokens)} in · {formatTokens(usage.totals.completionTokens)} out
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Custo estimado ({periodLabel})</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatBrl(usage.totals.costUsd * USD_TO_BRL)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              ≈ {formatUsd(usage.totals.costUsd)} · apenas agente SDR
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Modelo mais usado</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold truncate" title={usage.topModel ?? ""}>
              {usage.topModel ?? "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {usage.totals.runs} execuções no período
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Consumo por modelo ({periodLabel})</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : usage.byModel.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem execuções no período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Modelo</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Tokens in</TableHead>
                  <TableHead className="text-right">Tokens out</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Custo est.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.byModel.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className="font-mono text-xs">{m.model}</TableCell>
                    <TableCell className="text-right">{m.runs}</TableCell>
                    <TableCell className="text-right">{formatTokens(m.promptTokens)}</TableCell>
                    <TableCell className="text-right">{formatTokens(m.completionTokens)}</TableCell>
                    <TableCell className="text-right">{formatTokens(m.totalTokens)}</TableCell>
                    <TableCell className="text-right">{formatBrl(m.costUsd * USD_TO_BRL)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top 10 empresas por consumo ({periodLabel})</CardTitle>
        </CardHeader>
        <CardContent>
          {usage.loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : usage.byCompany.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem consumo no período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Custo est.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.byCompany.map((c) => (
                  <TableRow key={c.companyId}>
                    <TableCell className="font-medium">{c.companyName}</TableCell>
                    <TableCell className="text-right">{c.runs}</TableCell>
                    <TableCell className="text-right">{formatTokens(c.totalTokens)}</TableCell>
                    <TableCell className="text-right">{formatBrl(c.costUsd * USD_TO_BRL)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Custos são estimativas baseadas em preços de referência dos provedores (revise em <code>src/lib/ai-pricing.ts</code>).
        Considera apenas execuções do agente SDR — chamadas isoladas de IA (análise de site, geração de scripts, etc.) não estão incluídas.
      </p>
    </div>
  );
}
