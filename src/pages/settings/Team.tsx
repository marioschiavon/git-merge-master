import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Info, Trash2, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  useTeamMembers,
  useUpdateMemberRole,
  useRemoveMember,
  type AppRole,
  type TeamMember,
} from "@/hooks/useTeam";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

export default function Team() {
  const { user, companyId, isCompanyAdmin, isMasterAdmin } = useAuth();
  const canManage = isCompanyAdmin || isMasterAdmin;
  const { data: members = [], isLoading } = useTeamMembers(companyId);
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();
  const [toRemove, setToRemove] = useState<TeamMember | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Equipe</h1>
        <p className="text-muted-foreground">
          Gerencie os membros da sua empresa e seus papéis
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Novos membros ainda são adicionados manualmente pela equipe Leaderei.
          Em breve você poderá convidar por email direto daqui, após configurar
          suas integrações de Email ou WhatsApp.
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
                          <Badge variant="outline">
                            {m.role === "company_admin"
                              ? "Admin da empresa"
                              : "Usuário"}
                          </Badge>
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
    </div>
  );
}
