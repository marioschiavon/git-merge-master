import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Mail,
  RefreshCw,
  Unplug,
  AlertTriangle,
  Send,
  Inbox,
  Clock3,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

function relTime(iso?: string | null): string {
  if (!iso) return "Nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
}

function useGmailAccount() {
  return useQuery({
    queryKey: ["gmail_account"],
    queryFn: async () => {
      const { data } = await supabase
        .from("gmail_account")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
  });
}

function useEmailStats() {
  return useQuery({
    queryKey: ["gmail_email_stats_7d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("messages")
        .select("id, direction, sent_at, channel")
        .eq("channel", "email")
        .gte("sent_at", since);
      if (error) throw error;
      const sent = (data ?? []).filter((m: any) => m.direction === "outbound").length;
      const received = (data ?? []).filter((m: any) => m.direction === "inbound").length;
      return { sent, received, total: (data ?? []).length };
    },
  });
}

function useRecentEmails() {
  return useQuery({
    queryKey: ["gmail_recent_emails"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select(
          "id, direction, sent_at, content, metadata, conversation_id, conversations!inner(lead_id, leads(full_name, email))",
        )
        .eq("channel", "email")
        .order("sent_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export default function GmailSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: account, isLoading: loadingAccount } = useGmailAccount();
  const { data: stats } = useEmailStats();
  const { data: recent } = useRecentEmails();

  // Handle OAuth callback return
  useEffect(() => {
    const connected = searchParams.get("connected");
    const err = searchParams.get("gmail_error");
    if (connected) {
      toast({ title: "Gmail conectado", description: "Sua conta Gmail foi vinculada com sucesso." });
      queryClient.invalidateQueries({ queryKey: ["gmail_account"] });
      searchParams.delete("connected");
      setSearchParams(searchParams, { replace: true });
    } else if (err) {
      toast({ title: "Erro ao conectar Gmail", description: err, variant: "destructive" });
      searchParams.delete("gmail_error");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("gmail-oauth-start", {
        body: { origin: window.location.origin },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.authorize_url) throw new Error("URL de autorização não recebida");
      window.location.href = data.authorize_url;
    },
    onError: (e: Error) =>
      toast({ title: "Falha ao iniciar OAuth", description: e.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("gmail-sync-inbox", {
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["gmail_account"] });
      queryClient.invalidateQueries({ queryKey: ["gmail_email_stats_7d"] });
      queryClient.invalidateQueries({ queryKey: ["gmail_recent_emails"] });
      const msg = `${data?.processed || 0} respostas processadas (${data?.matched || 0} casadas com leads).`;
      toast({ title: "Sincronização Gmail", description: msg });
    },
    onError: (e: Error) =>
      toast({
        title: "Erro no Gmail",
        description: e.message,
        variant: "destructive",
      }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!account?.id) throw new Error("Sem conta ativa");
      const { error } = await supabase
        .from("gmail_account")
        .update({
          is_active: false,
          refresh_token_encrypted: null,
          access_token: null,
          access_token_expires_at: null,
        })
        .eq("id", account.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail_account"] });
      toast({ title: "Gmail desconectado" });
    },
    onError: (e: Error) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const isConnected = !!account && !!(account as any).refresh_token_encrypted;
  const needsReauth = !!account && !(account as any).refresh_token_encrypted;
  const lastError = (account as any)?.last_error as string | null | undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/settings/integrations")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Integrações
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-lg border bg-background text-[#EA4335]">
            <Mail className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Gmail</h1>
            <p className="text-muted-foreground text-sm">
              Configuração e monitoramento da integração Gmail da empresa.
            </p>
          </div>
        </div>
        <Badge
          variant="secondary"
          className={
            isConnected
              ? "gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent"
              : "gap-1 bg-muted text-muted-foreground border-transparent"
          }
        >
          {isConnected ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <Circle className="h-3 w-3" />
          )}
          {isConnected ? "Conectado" : "Desconectado"}
        </Badge>
      </div>

      {needsReauth && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div>
              <p className="font-medium">Sua integração precisa ser reconectada</p>
              <p className="text-muted-foreground mt-1">
                Migramos para autenticação OAuth direto com o Google. Clique em{" "}
                <strong>Conectar Gmail</strong> para autorizar novamente.
              </p>
            </div>
          </div>
        </div>
      )}

      {lastError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-4 text-sm text-foreground">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium">Último erro reportado pelo Gmail</p>
              <p className="text-muted-foreground mt-1 font-mono text-xs break-all">{lastError}</p>
            </div>
          </div>
        </div>
      )}

      {/* Account card */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Conta conectada
        </h2>

        {loadingAccount ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : isConnected ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoRow label="Email" value={(account as any).email} />
            <InfoRow
              label="Conectado em"
              value={
                (account as any).connected_at
                  ? new Date((account as any).connected_at).toLocaleString("pt-BR")
                  : new Date((account as any).created_at).toLocaleString("pt-BR")
              }
            />
            <InfoRow
              label="Última sincronização"
              value={
                (account as any).last_synced_at
                  ? `${new Date((account as any).last_synced_at).toLocaleString("pt-BR")} (${relTime(
                      (account as any).last_synced_at,
                    )})`
                  : "Nunca"
              }
            />
          </div>
        ) : (
          <div className="rounded-md border bg-background p-4 text-sm">
            <p className="font-medium">Nenhuma conta Gmail conectada</p>
            <p className="text-muted-foreground mt-1">
              Conecte a conta Gmail que sua empresa usará para enviar e receber emails dos leads.
              O Google pedirá permissão para envio, leitura e modificação de mensagens.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {!isConnected || needsReauth ? (
            <Button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
            >
              <Link2 className="mr-2 h-4 w-4" />
              {connectMutation.isPending ? "Abrindo Google…" : "Conectar Gmail"}
            </Button>
          ) : (
            <>
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
                />
                {syncMutation.isPending ? "Sincronizando…" : "Sincronizar agora"}
              </Button>
              <Button
                variant="outline"
                onClick={() => connectMutation.mutate()}
                disabled={connectMutation.isPending}
              >
                <Link2 className="mr-2 h-4 w-4" />
                Reconectar
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Desconectar a conta Gmail da empresa?")) {
                    disconnectMutation.mutate();
                  }
                }}
                disabled={disconnectMutation.isPending}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Desconectar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Última sync"
          value={relTime((account as any)?.last_synced_at)}
          icon={Clock3}
        />
        <StatCard label="Enviados (7d)" value={stats?.sent ?? 0} icon={Send} />
        <StatCard label="Recebidos (7d)" value={stats?.received ?? 0} icon={Inbox} />
      </div>

      {/* Recent activity */}
      <div className="rounded-xl border bg-card">
        <div className="p-5 border-b">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Atividade recente
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Últimas mensagens de email trocadas com leads.
          </p>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Direção</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Prévia</TableHead>
                <TableHead className="text-right">Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recent ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-sm text-muted-foreground py-8"
                  >
                    Nenhuma mensagem de email ainda.
                  </TableCell>
                </TableRow>
              ) : (
                (recent ?? []).map((m: any) => {
                  const lead = m.conversations?.leads;
                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={
                            m.direction === "outbound"
                              ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-transparent"
                              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent"
                          }
                        >
                          {m.direction === "outbound" ? "Enviado" : "Recebido"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {lead?.full_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {lead?.email ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                        {m.content?.slice(0, 100) ?? ""}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {m.sent_at ? relTime(m.sent_at) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground break-all">{value}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Mail;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
