import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCadences, useCreateCadence, useDeleteCadence, useUpdateCadence } from "@/hooks/useCadences";
import { CadenceDetail } from "@/components/CadenceDetail";
import { MessageSquare, Plus, Trash2, Pause, Zap } from "lucide-react";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-green-100 text-green-800",
  paused: "bg-yellow-100 text-yellow-800",
  archived: "bg-red-100 text-red-800",
};

const statusLabels: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
};

const typeLabels: Record<string, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  multi_channel: "Multi-canal",
};

export default function Cadences() {
  const { data: cadences = [], isLoading } = useCadences();
  const createMutation = useCreateCadence();
  const deleteMutation = useDeleteCadence();
  const updateMutation = useUpdateCadence();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCadenceId, setSelectedCadenceId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "", type: "email" });

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    await createMutation.mutateAsync(form);
    setForm({ name: "", description: "", type: "email" });
    setCreateOpen(false);
  };

  const toggleStatus = (cadence: any) => {
    const newStatus = cadence.status === "active" ? "paused" : "active";
    updateMutation.mutate({ id: cadence.id, status: newStatus });
  };

  if (!isLoading && cadences.length === 0 && !createOpen) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Cadências</h1>
            <p className="text-muted-foreground">Configure sequências automáticas de contato</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Nova Cadência</Button>
            </DialogTrigger>
            <CreateCadenceDialog form={form} setForm={setForm} onCreate={handleCreate} isPending={createMutation.isPending} />
          </Dialog>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-medium">Nenhuma cadência configurada</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie sua primeira cadência para automatizar a prospecção.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Cadências</h1>
          <p className="text-muted-foreground">{cadences.length} cadência(s)</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Nova Cadência</Button>
          </DialogTrigger>
          <CreateCadenceDialog form={form} setForm={setForm} onCreate={handleCreate} isPending={createMutation.isPending} />
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criada em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : (
                cadences.map((c: any) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelectedCadenceId(c.id)}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{typeLabels[c.type] || c.type}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[c.status] || ""} variant="secondary">
                        {statusLabels[c.status] || c.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(c.created_at).toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant={c.status === "active" ? "default" : "outline"}
                          size="sm"
                          onClick={() => toggleStatus(c)}
                          title={c.status === "active" ? "Pausar Automação" : "Ativar Automação"}
                          className="gap-1"
                        >
                          {c.status === "active" ? (
                            <>
                              <Pause className="h-3 w-3" />
                              <span className="hidden sm:inline">Pausar</span>
                            </>
                          ) : (
                            <>
                              <Zap className="h-3 w-3" />
                              <span className="hidden sm:inline">Ativar</span>
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(c.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CadenceDetail
        cadenceId={selectedCadenceId}
        open={!!selectedCadenceId}
        onOpenChange={(open) => !open && setSelectedCadenceId(null)}
      />
    </div>
  );
}

function CreateCadenceDialog({ form, setForm, onCreate, isPending }: {
  form: { name: string; description: string; type: string };
  setForm: (f: any) => void;
  onCreate: () => void;
  isPending: boolean;
}) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nova Cadência</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 pt-2">
        <div className="space-y-2">
          <Label>Nome</Label>
          <Input
            placeholder="Ex: Prospecção Outbound Q1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Descrição (opcional)</Label>
          <Textarea
            placeholder="Descreva o objetivo desta cadência..."
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">E-mail</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="linkedin">LinkedIn</SelectItem>
              <SelectItem value="multi_channel">Multi-canal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={onCreate} disabled={isPending || !form.name.trim()} className="w-full">
          {isPending ? "Criando..." : "Criar Cadência"}
        </Button>
      </div>
    </DialogContent>
  );
}
