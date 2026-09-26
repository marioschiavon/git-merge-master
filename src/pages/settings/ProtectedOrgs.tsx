import { useMemo, useState } from "react";
import { ShieldCheck, Plus, Trash2, Pencil, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  PROTECTED_REASON_LABELS, ProtectedOrg, ProtectedReason,
  useDeleteProtectedOrg, useProtectedOrgs, useSaveProtectedOrg,
} from "@/hooks/useProtectedOrgs";

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

type Form = {
  id?: string; kind: "municipio" | "empresa"; city: string; state: string;
  name: string; domain: string; reason: ProtectedReason; note: string;
};
const empty: Form = { kind: "municipio", city: "", state: "", name: "", domain: "", reason: "cliente", note: "" };

export default function ProtectedOrgs() {
  const { toast } = useToast();
  const { companyId } = useAuth();
  const qc = useQueryClient();
  const { data: orgs = [], isLoading } = useProtectedOrgs();
  const save = useSaveProtectedOrg();
  const del = useDeleteProtectedOrg();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);

  const { data: autoProtect } = useQuery({
    queryKey: ["auto-protect", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("companies").select("auto_protect_orgs").eq("id", companyId).maybeSingle();
      return data?.auto_protect_orgs ?? true;
    },
  });

  const toggleAuto = async (v: boolean) => {
    const { error } = await (supabase as any).from("companies").update({ auto_protect_orgs: v }).eq("id", companyId);
    if (error) toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" });
    qc.invalidateQueries({ queryKey: ["auto-protect", companyId] });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((o) => [o.label, o.domain, o.note].some((v) => v?.toLowerCase().includes(q)));
  }, [orgs, search]);

  const edit = (o: ProtectedOrg) => {
    setForm({
      id: o.id, kind: o.kind, city: o.city ?? "", state: o.state ?? "",
      name: o.kind === "empresa" ? o.label : "", domain: o.domain ?? "", reason: o.reason, note: o.note ?? "",
    });
    setOpen(true);
  };

  const submit = async () => {
    try {
      if (form.kind === "municipio") {
        if (!form.city.trim() || !form.state) throw new Error("Informe município e UF.");
        await save.mutateAsync({
          id: form.id, kind: "municipio", label: `${form.city.trim()} / ${form.state}`,
          city: form.city.trim(), state: form.state, domain: null, reason: form.reason, note: form.note || null,
        });
      } else {
        if (!form.name.trim() && !form.domain.trim()) throw new Error("Informe o nome ou o site da empresa.");
        await save.mutateAsync({
          id: form.id, kind: "empresa", label: form.name.trim() || form.domain.trim(),
          domain: form.domain.trim() || null, city: null, state: null, reason: form.reason, note: form.note || null,
        });
      }
      toast({ title: form.id ? "Atualizado" : "Adicionado à lista Não prospectar" });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Não foi possível salvar", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><ShieldCheck className="h-6 w-6 text-primary" /> Não prospectar</h1>
          <p className="text-sm text-muted-foreground">
            Prefeituras e empresas desta lista nunca recebem abordagem automática: não entram em cadência e não são importadas pelo MunicipIA.
          </p>
        </div>
        <Button onClick={() => { setForm(empty); setOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Adicionar</Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Proteção automática</CardTitle>
          <CardDescription>
            Quando um lead agenda reunião, a organização entra na lista como "Em negociação". Quando vira convertido, entra como "Cliente".
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch checked={autoProtect ?? true} onCheckedChange={toggleAuto} id="auto-protect" />
          <Label htmlFor="auto-protect">{autoProtect ?? true ? "Ligada" : "Desligada"}</Label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organização</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhuma organização protegida.</TableCell></TableRow>
              ) : filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.label}
                    {o.domain && o.domain !== o.label && <div className="text-xs text-muted-foreground">{o.domain}</div>}
                  </TableCell>
                  <TableCell>{o.kind === "municipio" ? "Prefeitura" : "Empresa"}</TableCell>
                  <TableCell><Badge variant="secondary">{PROTECTED_REASON_LABELS[o.reason] ?? o.reason}</Badge></TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{o.note || "—"}</TableCell>
                  <TableCell className="text-sm">{o.source === "auto" ? "Automática" : "Manual"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => edit(o)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label="Remover" onClick={async () => {
                      if (!confirm(`Remover "${o.label}" da lista? A organização poderá voltar a ser prospectada.`)) return;
                      await del.mutateAsync(o.id);
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.id ? "Editar organização" : "Adicionar à lista Não prospectar"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as Form["kind"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="municipio">Prefeitura (município + UF)</SelectItem>
                  <SelectItem value="empresa">Empresa (nome ou site)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.kind === "municipio" ? (
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <div className="space-y-1.5"><Label>Município</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Altamira" /></div>
                <div className="space-y-1.5">
                  <Label>UF</Label>
                  <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>{UFS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5"><Label>Nome da empresa</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Site ou domínio de e-mail</Label><Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="empresa.com.br" /></div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v as ProtectedReason })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PROTECTED_REASON_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Observação</Label><Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={save.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
