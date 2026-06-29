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
import { Plus } from "lucide-react";
import { toast } from "sonner";

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

  const fetchCompanies = async () => {
    const { data } = await supabase.from("companies").select("*").order("created_at", { ascending: false });
    setCompanies((data as Company[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchCompanies(); }, []);

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
                  <TableHead>Limite Usuários</TableHead>
                  <TableHead>Limite Leads</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.slug}</TableCell>
                    <TableCell><Badge variant={statusColor(c.status)}>{statusLabel(c.status)}</Badge></TableCell>
                    <TableCell>{c.max_users}</TableCell>
                    <TableCell>{c.max_leads}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={c.status !== "inactive"}
                          onCheckedChange={() => handleToggleStatus(c)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {c.status !== "inactive" ? "Ativa" : "Inativa"}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
