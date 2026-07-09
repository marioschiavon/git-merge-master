import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Info, Trash2, Loader2, UserPlus, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  useTeamMembers,
  useUpdateMemberRole,
  useRemoveMember,
  usePendingInvites,
  useCreateInvite,
  useCancelInvite,
  buildInviteUrl,
  type AppRole,
  type TeamMember,
  type PendingInvite,
} from "@/hooks/useTeam";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

const roleLabel = (r: AppRole) =>
  r === "company_admin" ? "Admin da empresa" : r === "user" ? "Usuário" : "Suporte Leaderei";

export default function Team() {
  const { user, companyId, isCompanyAdmin, isMasterAdmin } = useAuth();
  const canManage = isCompanyAdmin || isMasterAdmin;
  const { data: members = [], isLoading } = useTeamMembers(companyId);
  const { data: invites = [] } = usePendingInvites(companyId);
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const createInvite = useCreateInvite();
  const cancelInvite = useCancelInvite();

  const [toRemove, setToRemove] = useState<TeamMember | null>(null);
  const [toCancelInvite, setToCancelInvite] = useState<PendingInvite | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<AppRole>("user");
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const handleCreate = async () => {
    const res = await createInvite.mutateAsync(inviteRole);
    const url = buildInviteUrl(res.token);
    setCreatedLink(url);
    await copy(url);
  };

  const closeInviteDialog = () => {
    setInviteOpen(false);
    setCreatedLink(null);
    setInviteRole("user");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Equipe</h1>
          <p className="text-muted-foreground">
            Gerencie os membros da sua empresa e seus papéis
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Convidar membro
          </Button>
        )}
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Gere um link de convite e envie pelo canal que preferir (WhatsApp, email, etc.).
          O envio automático será liberado quando você configurar Email ou WhatsApp nas integrações.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum membro encontrado.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Entrou em</TableHead>
                  <TableHead className="w-[100px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const isSelf = m.user_id === user?.id;
                  const isMaster = m.role === "master_admin";
                  const canEdit = canManage && !isSelf && !isMaster;

                  return (
                    <TableRow key={m.user_id}>
                      <TableCell className="font-medium">
                        {m.full_name || "—"}
                        {isSelf && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (você)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{m.email || "—"}</TableCell>
                      <TableCell>{m.phone || "—"}</TableCell>
                      <TableCell>
                        {isMaster ? (
                          <Badge variant="secondary">Suporte Leaderei</Badge>
                        ) : canEdit ? (
                          <Select
                            value={m.role}
                            onValueChange={(v) =>
                              updateRole.mutate({
                                userId: m.user_id,
                                newRole: v as AppRole,
                              })
                            }
                            disabled={updateRole.isPending}
                          >
                            <SelectTrigger className="w-[180px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="company_admin">
                                Admin da empresa
                              </SelectItem>
                              <SelectItem value="user">Usuário</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline">{roleLabel(m.role)}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(m.joined_at)}
                      </TableCell>
                      <TableCell>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setToRemove(m)}
                            aria-label="Remover membro"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage && invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Convites pendentes</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Papel</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead>Expira em</TableHead>
                  <TableHead className="w-[180px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Badge variant="outline">{roleLabel(inv.role)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(inv.expires_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copy(buildInviteUrl(inv.token))}
                        >
                          <Copy className="mr-1 h-3 w-3" />
                          Copiar link
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setToCancelInvite(inv)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => (o ? setInviteOpen(true) : closeInviteDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar membro</DialogTitle>
            <DialogDescription>
              {createdLink
                ? "Copie e envie este link para o novo membro. Ele expira em 7 dias."
                : "Escolha o papel do novo membro. Você receberá um link para enviar."}
            </DialogDescription>
          </DialogHeader>

          {createdLink ? (
            <div className="space-y-2">
              <Label>Link de convite</Label>
              <div className="flex gap-2">
                <Input value={createdLink} readOnly onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" onClick={() => copy(createdLink)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuário</SelectItem>
                  <SelectItem value="company_admin">Admin da empresa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <DialogFooter>
            {createdLink ? (
              <Button onClick={closeInviteDialog}>Concluir</Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeInviteDialog}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate} disabled={createInvite.isPending}>
                  {createInvite.isPending ? "Gerando..." : "Gerar link"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove member confirmation */}
      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover membro?</AlertDialogTitle>
            <AlertDialogDescription>
              {toRemove?.full_name || toRemove?.email} perderá acesso à empresa
              imediatamente. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toRemove) {
                  removeMember.mutate(toRemove.user_id, {
                    onSettled: () => setToRemove(null),
                  });
                }
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel invite confirmation */}
      <AlertDialog
        open={!!toCancelInvite}
        onOpenChange={(o) => !o && setToCancelInvite(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar convite?</AlertDialogTitle>
            <AlertDialogDescription>
              O link deixará de funcionar imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toCancelInvite) {
                  cancelInvite.mutate(toCancelInvite.id, {
                    onSettled: () => setToCancelInvite(null),
                  });
                }
              }}
            >
              Cancelar convite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
