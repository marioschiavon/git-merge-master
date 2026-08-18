import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Users, Eye } from "lucide-react";
import { toast } from "sonner";
import { useCompanyUsageMap } from "@/hooks/useMasterAiUsage";
import { formatBrl, formatTokens, USD_TO_BRL } from "@/lib/ai-pricing";
import { CompanyDetailsSheet } from "@/components/master/CompanyDetailsSheet";

interface Company {
  id: string;
  name: string;
  slug: string;
  status: string;
  max_users: number;
  max_leads: number;
  created_at: string;
}

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [confirmCompany, setConfirmCompany] = useState<Company | null>(null);
  const [detailsCompany, setDetailsCompany] = useState<Company | null>(null);
  const { data: usageMap } = useCompanyUsageMap(30);

  const [municipia, setMunicipia] = useState<Record<string, { enabled: boolean; last_import_at: string | null; last_import_count: number }>>({});
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});

  const fetchCompanies = async () => {
    const { data } = await supabase.from("companies").select("*").order("created_at", { ascending: false });
    setCompanies((data as Company[]) || []);
    setLoading(false);
  };

  const fetchMemberCounts = async () => {
    const { data } = await supabase.from("company_members").select("company_id");
    const map: Record<string, number> = {};
    for (const row of data ?? []) {
      map[row.company_id] = (map[row.company_id] ?? 0) + 1;
    }
    setMemberCounts(map);
  };

  const fetchMunicipia = async () => {
    const { data } = await supabase
      .from("municipia_integrations")
      .select("company_id, enabled, last_import_at, last_import_count");
    const map: Record<string, { enabled: boolean; last_import_at: string | null; last_import_count: number }> = {};
    for (const row of data ?? []) {
      map[row.company_id] = {
        enabled: row.enabled,
        last_import_at: row.last_import_at,
        last_import_count: row.last_import_count ?? 0,
      };
    }
    setMunicipia(map);
  };

  const toggleMunicipia = async (companyId: string, enabled: boolean) => {
    const { error } = await supabase
      .from("municipia_integrations")
      .upsert({ company_id: companyId, enabled }, { onConflict: "company_id" });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (enabled && (memberCounts[companyId] ?? 0) === 0) {
      toast.warning("MunicipIA habilitado, mas esta empresa não tem usuários — ninguém verá o app até alguém entrar por convite.");
    } else {
      toast.success(enabled ? "MunicipIA habilitado" : "MunicipIA desabilitado");
    }
    fetchMunicipia();
  };

  useEffect(() => { fetchCompanies(); fetchMunicipia(); fetchMemberCounts(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("companies").insert({ name, slug: slug.toLowerCase().replace(/\s+/g, "-") });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Empresa criada!");
      setOpen(false);
      setName("");
      setSlug("");
      fetchCompanies();
    }
  };

  const handleToggleStatus = async (company: Company) => {
    if (company.status === "active" || company.status === "trial") {
      // About to inactivate — show confirmation
      setConfirmCompany(company);
    } else {
      // Reactivate directly
      await updateStatus(company.id, "active");
    }
  };

  const updateStatus = async (companyId: string, newStatus: string) => {
    const { error } = await supabase
      .from("companies")
      .update({ status: newStatus as any })
      .eq("id", companyId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(newStatus === "inactive" ? "Empresa inativada!" : "Empresa ativada!");
      fetchCompanies();
    }
  };

  const statusColor = (s: string) => {
    if (s === "active") return "default";
    if (s === "trial") return "secondary";
    return "destructive";
  };

  const statusLabel = (s: string) => {
    if (s === "active") return "Ativa";
    if (s === "trial") return "Trial";
    return "Inativa";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Empresas</h1>
          <p className="text-muted-foreground">Gerencie as empresas da plataforma</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" /> Nova Empresa</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Criar Empresa</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={name} onChange={(e) => { setName(e.target.value); setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-")); }} required />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full">Criar</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Todas as Empresas</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : companies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Usuários</TableHead>
                  <TableHead className="text-right">Runs (30d)</TableHead>
                  <TableHead className="text-right">Tokens (30d)</TableHead>
                  <TableHead className="text-right">Custo est. (30d)</TableHead>
                  <TableHead>MunicipIA</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => {
                  const u = usageMap.get(c.id);
                  const members = memberCounts[c.id] ?? 0;
                  return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.slug}</TableCell>
                    <TableCell><Badge variant={statusColor(c.status)}>{statusLabel(c.status)}</Badge></TableCell>
                    <TableCell className="text-right">
                      <Badge variant={members === 0 ? "destructive" : "outline"} className="gap-1">
                        <Users className="h-3 w-3" />
                        {members}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{u?.runs ?? 0}</TableCell>
                    <TableCell className="text-right">{formatTokens(u?.totalTokens ?? 0)}</TableCell>
                    <TableCell className="text-right">{formatBrl((u?.costUsd ?? 0) * USD_TO_BRL)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!!municipia[c.id]?.enabled}
                          onCheckedChange={(v) => toggleMunicipia(c.id, v)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {municipia[c.id]?.last_import_at
                            ? `${municipia[c.id]?.last_import_count ?? 0} leads · ${new Date(municipia[c.id]!.last_import_at!).toLocaleDateString("pt-BR")}`
                            : municipia[c.id]?.enabled ? (members === 0 ? "Sem usuários" : "Sem importações") : "Desligado"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={c.status !== "inactive"}
                          onCheckedChange={() => handleToggleStatus(c)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {c.status !== "inactive" ? "Ativa" : "Inativa"}
                        </span>
                        <Button variant="outline" size="sm" onClick={() => setDetailsCompany(c)}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> Detalhes
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CompanyDetailsSheet
        company={detailsCompany as any}
        open={!!detailsCompany}
        onOpenChange={(o) => !o && setDetailsCompany(null)}
        municipiaEnabled={detailsCompany ? !!municipia[detailsCompany.id]?.enabled : false}
        usage={
          detailsCompany
            ? {
                runs: usageMap.get(detailsCompany.id)?.runs ?? 0,
                totalTokens: usageMap.get(detailsCompany.id)?.totalTokens ?? 0,
                costBrl: (usageMap.get(detailsCompany.id)?.costUsd ?? 0) * USD_TO_BRL,
              }
            : undefined
        }
      />

      <AlertDialog open={!!confirmCompany} onOpenChange={(open) => !open && setConfirmCompany(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Inativar empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              Ao inativar a empresa <strong>{confirmCompany?.name}</strong>, todos os usuários dela perderão acesso ao sistema imediatamente. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmCompany) {
                  updateStatus(confirmCompany.id, "inactive");
                  setConfirmCompany(null);
                }
              }}
            >
              Inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
