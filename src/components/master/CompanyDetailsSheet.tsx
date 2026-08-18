import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useTeamMembers, usePendingInvites } from "@/hooks/useTeam";
import { Copy, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface CompanyLite {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

interface Props {
  company: CompanyLite | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  municipiaEnabled?: boolean;
  usage?: { runs: number; totalTokens: number; costBrl: number };
}

const roleLabel: Record<string, string> = {
  master_admin: "Master admin",
  company_admin: "Admin",
  user: "Usuário",
};

function useCompanyOverview(companyId: string | null) {
  return useQuery({
    queryKey: ["company-overview", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const [companyRes, cadencesRes] = await Promise.all([
        supabase
          .from("companies")
          .select("calcom_connected_at, calcom_booking_link")
          .eq("id", companyId!)
          .maybeSingle(),
        supabase
          .from("cadences")
          .select("id, status")
          .eq("company_id", companyId!),
      ]);
      const cadences = cadencesRes.data ?? [];
      return {
        calcomConnectedAt: (companyRes.data as any)?.calcom_connected_at ?? null,
        cadencesTotal: cadences.length,
        cadencesActive: cadences.filter((c: any) => c.status === "active").length,
      };
    },
  });
}

export function CompanyDetailsSheet({ company, open, onOpenChange, municipiaEnabled, usage }: Props) {
  const { data: members, isLoading: loadingMembers } = useTeamMembers(open ? company?.id : null);
  const { data: invites } = usePendingInvites(open ? company?.id : null);
  const { data: overview } = useCompanyOverview(open ? (company?.id ?? null) : null);

  const copyInvite = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Link do convite copiado");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{company?.name ?? "Empresa"}</SheetTitle>
          <SheetDescription>Detalhes, usuários e integrações desta empresa.</SheetDescription>
        </SheetHeader>

        {company && (
          <div className="mt-6 space-y-6">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Slug</p>
                <p className="font-medium">{company.slug}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge variant={company.status === "inactive" ? "destructive" : "default"}>
                  {company.status === "inactive" ? "Inativa" : company.status === "trial" ? "Trial" : "Ativa"}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Criada em</p>
                <p className="font-medium">{new Date(company.created_at).toLocaleDateString("pt-BR")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cadências</p>
                <p className="font-medium">
                  {overview ? `${overview.cadencesActive} ativas / ${overview.cadencesTotal}` : "—"}
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Integrações</h3>
              <div className="flex flex-wrap gap-2">
                <Badge variant={municipiaEnabled ? "default" : "outline"}>
                  MunicipIA {municipiaEnabled ? "ativo" : "desligado"}
                </Badge>
                <Badge variant={overview?.calcomConnectedAt ? "default" : "outline"}>
                  Cal.com {overview?.calcomConnectedAt ? "conectado" : "não conectado"}
                </Badge>
              </div>
            </div>

            {usage && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Uso de IA (30 dias)</h3>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Execuções</p>
                      <p className="font-medium">{usage.runs}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Tokens</p>
                      <p className="font-medium">{usage.totalTokens.toLocaleString("pt-BR")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Custo est.</p>
                      <p className="font-medium">
                        {usage.costBrl.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" /> Usuários ({members?.length ?? 0})
              </h3>
              {loadingMembers ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
                </p>
              ) : !members || members.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Esta empresa ainda não tem nenhum usuário. Envie um convite para que alguém possa acessar.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Papel</TableHead>
                      <TableHead>Entrou</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.user_id}>
                        <TableCell className="font-medium">{m.full_name ?? "—"}</TableCell>
                        <TableCell className="break-all text-xs">{m.email ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{roleLabel[m.role] ?? m.role}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {m.joined_at ? new Date(m.joined_at).toLocaleDateString("pt-BR") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Convites pendentes ({invites?.length ?? 0})</h3>
              {!invites || invites.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
              ) : (
                <div className="space-y-2">
                  {invites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                      <div>
                        <p className="font-medium">{roleLabel[inv.role] ?? inv.role}</p>
                        <p className="text-xs text-muted-foreground">
                          expira em {new Date(inv.expires_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => copyInvite(inv.token)}>
                        <Copy className="mr-1 h-3.5 w-3.5" /> Copiar link
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
