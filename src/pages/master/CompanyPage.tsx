import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Construction, Copy, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useTeamMembers, usePendingInvites } from "@/hooks/useTeam";
import { useCompanyUsageMap } from "@/hooks/useMasterAiUsage";
import { formatBrl, formatTokens, USD_TO_BRL } from "@/lib/ai-pricing";
import { SocialEnrichmentBlock } from "@/components/master/SocialEnrichmentBlock";

const roleLabel: Record<string, string> = { master_admin: "Master admin", company_admin: "Admin", user: "Usuário" };

// Catálogo provisório (assinatura em construção — valores ilustrativos, não salvos).
const MODULES = [
  { key: "core", label: "Leaderei (base)", price: 0 },
  { key: "whatsapp", label: "WhatsApp (Hook7)", price: 0 },
  { key: "email", label: "E-mail", price: 0 },
  { key: "municipia", label: "MunicipIA", price: 0 },
  { key: "social", label: "Enriquecimento de redes", price: 0 },
  { key: "bitrix", label: "Bitrix24", price: 0 },
  { key: "calcom", label: "Cal.com", price: 0 },
];

export default function CompanyPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: usageMap } = useCompanyUsageMap(30);
  const { data: members, isLoading: loadingMembers } = useTeamMembers(id ?? null);
  const { data: invites } = usePendingInvites(id ?? null);

  const { data, isLoading } = useQuery({
    queryKey: ["master-company", id],
    enabled: !!id,
    queryFn: async () => {
      const [c, m, cad, leads] = await Promise.all([
        supabase.from("companies").select("*").eq("id", id!).maybeSingle(),
        supabase.from("municipia_integrations").select("enabled, last_import_at, last_import_count").eq("company_id", id!).maybeSingle(),
        supabase.from("cadences").select("status").eq("company_id", id!),
        supabase.from("leads").select("id", { count: "exact", head: true }).eq("company_id", id!),
      ]);
      return { company: c.data as any, municipia: m.data as any, cadences: cad.data ?? [], leads: leads.count ?? 0 };
    },
  });

  const [active, setActive] = useState<string[]>(["core", "whatsapp"]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  if (isLoading) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</p>;
  const company = data?.company;
  if (!company) return <p className="text-sm text-muted-foreground">Empresa não encontrada.</p>;

  const usage = usageMap.get(company.id);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["master-company", id] });

  const toggleStatus = async (on: boolean) => {
    if (!on && !confirm(`Inativar ${company.name}? Os usuários perdem acesso imediatamente.`)) return;
    const { error } = await supabase.from("companies").update({ status: (on ? "active" : "inactive") as any }).eq("id", company.id);
    if (error) return toast.error(error.message);
    toast.success(on ? "Empresa ativada" : "Empresa inativada");
    invalidate();
  };

  const toggleMunicipia = async (enabled: boolean) => {
    const { error } = await supabase.from("municipia_integrations").upsert({ company_id: company.id, enabled }, { onConflict: "company_id" });
    if (error) return toast.error(error.message);
    toast.success(enabled ? "MunicipIA habilitado" : "MunicipIA desabilitado");
    invalidate();
  };

  const copyInvite = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`);
    toast.success("Link do convite copiado");
  };

  const total = MODULES.filter((m) => active.includes(m.key)).reduce((s, m) => s + m.price, 0);
  const cadActive = data!.cadences.filter((c: any) => c.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
            <Link to="/master/companies"><ArrowLeft className="mr-1 h-4 w-4" /> Empresas</Link>
          </Button>
          <h1 className="text-2xl font-semibold text-foreground">{company.name}</h1>
          <p className="text-sm text-muted-foreground">{company.slug} · criada em {new Date(company.created_at).toLocaleDateString("pt-BR")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={company.status !== "inactive"} onCheckedChange={toggleStatus} />
          <Badge variant={company.status === "inactive" ? "destructive" : "default"}>
            {company.status === "inactive" ? "Inativa" : company.status === "trial" ? "Trial" : "Ativa"}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="modules">Módulos</TabsTrigger>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="subscription">Assinatura</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Leads", data!.leads.toLocaleString("pt-BR")],
              ["Cadências", `${cadActive} ativas / ${data!.cadences.length}`],
              ["Usuários", String(members?.length ?? 0)],
              ["Execuções de IA (30d)", String(usage?.runs ?? 0)],
              ["Tokens (30d)", formatTokens(usage?.totalTokens ?? 0)],
              ["Custo de IA est. (30d)", formatBrl((usage?.costUsd ?? 0) * USD_TO_BRL)],
            ].map(([k, v]) => (
              <Card key={k}>
                <CardHeader className="pb-2"><CardDescription>{k}</CardDescription></CardHeader>
                <CardContent><p className="text-2xl font-semibold">{v}</p></CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="modules" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">MunicipIA</CardTitle>
              <CardDescription>
                {data!.municipia?.last_import_at
                  ? `Última importação: ${data!.municipia.last_import_count ?? 0} leads em ${new Date(data!.municipia.last_import_at).toLocaleDateString("pt-BR")}`
                  : "Nenhuma importação ainda."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Switch checked={!!data!.municipia?.enabled} onCheckedChange={toggleMunicipia} />
              <span className="text-sm">{data!.municipia?.enabled ? "Ligado" : "Desligado"}</span>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6"><SocialEnrichmentBlock companyId={company.id} /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Outras integrações</CardTitle></CardHeader>
            <CardContent>
              <Badge variant={company.calcom_connected_at ? "default" : "outline"}>
                Cal.com {company.calcom_connected_at ? "conectado" : "não conectado"}
              </Badge>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Usuários ({members?.length ?? 0})</CardTitle></CardHeader>
            <CardContent>
              {loadingMembers ? <Loader2 className="h-4 w-4 animate-spin" /> : !members?.length ? (
                <p className="text-sm text-muted-foreground">Nenhum usuário ainda.</p>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Papel</TableHead><TableHead>Entrou</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.user_id}>
                        <TableCell className="font-medium">{m.full_name ?? "—"}</TableCell>
                        <TableCell className="text-xs">{m.email ?? "—"}</TableCell>
                        <TableCell><Badge variant="outline">{roleLabel[m.role] ?? m.role}</Badge></TableCell>
                        <TableCell className="text-xs">{m.joined_at ? new Date(m.joined_at).toLocaleDateString("pt-BR") : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Convites pendentes ({invites?.length ?? 0})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!invites?.length ? <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p> : invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                  <span>{roleLabel[inv.role] ?? inv.role} · expira em {new Date(inv.expires_at).toLocaleDateString("pt-BR")}</span>
                  <Button variant="outline" size="sm" onClick={() => copyInvite(inv.token)}><Copy className="mr-1 h-3.5 w-3.5" /> Copiar link</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscription" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  Assinatura <Badge variant="secondary" className="gap-1"><Construction className="h-3 w-3" /> Em construção</Badge>
                </CardTitle>
                <CardDescription>Módulos contratados e valor mensal. Ainda não é salvo nem cobrado.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setDraft(active); setEditing(true); }}>
                <Pencil className="mr-1 h-3.5 w-3.5" /> Editar módulos
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {MODULES.filter((m) => active.includes(m.key)).map((m) => (
                <div key={m.key} className="flex justify-between rounded-md border p-2 text-sm">
                  <span>{m.label}</span><span className="text-muted-foreground">{formatBrl(m.price)}/mês</span>
                </div>
              ))}
              <div className="flex justify-between border-t pt-3 font-semibold">
                <span>Total mensal</span><span>{formatBrl(total)}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar módulos</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {MODULES.map((m) => (
              <label key={m.key} className="flex items-center gap-3 rounded-md border p-2 text-sm">
                <Checkbox
                  checked={draft.includes(m.key)}
                  disabled={m.key === "core"}
                  onCheckedChange={(v) => setDraft((d) => (v ? [...d, m.key] : d.filter((x) => x !== m.key)))}
                />
                <span className="flex-1">{m.label}</span>
                <span className="text-muted-foreground">{formatBrl(m.price)}</span>
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button onClick={() => { setActive(draft); setEditing(false); toast.info("Prévia atualizada — a assinatura ainda está em construção"); }}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
