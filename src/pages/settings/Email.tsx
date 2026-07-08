import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Mail,
  RefreshCw,
  AlertTriangle,
  Send,
  Inbox,
  Info,
  Copy,
  Check,
  Trash2,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface DnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl?: string | number;
  status?: string;
  priority?: number;
}

interface DomainRow {
  id: string;
  sending_domain: string;
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  resend_domain_id: string | null;
  status: string;
  dns_records: DnsRecord[] | null;
  verified_at: string | null;
  last_error: string | null;
}

function useDomain() {
  return useQuery({
    queryKey: ["company_email_domain_full"],
    queryFn: async () => {
      const { data } = await supabase
        .from("company_email_domains")
        .select("*")
        .maybeSingle();
      return (data as unknown as DomainRow) ?? null;
    },
  });
}

function useEmailStats() {
  return useQuery({
    queryKey: ["email_stats_7d"],
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("messages")
        .select("id, direction, email_provider")
        .eq("email_provider", "resend")
        .gte("sent_at", since);
      const rows = data ?? [];
      return {
        sent: rows.filter((m: any) => m.direction === "outbound").length,
        received: rows.filter((m: any) => m.direction === "inbound").length,
      };
    },
  });
}

export default function EmailSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: domain, isLoading } = useDomain();
  const { data: stats } = useEmailStats();

  const [sendingDomain, setSendingDomain] = useState("");
  const [fromName, setFromName] = useState("SDR");
  const [fromLocal, setFromLocal] = useState("contato");
  const [copied, setCopied] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("resend-domain-create", {
        body: {
          sending_domain: sendingDomain,
          from_name: fromName,
          from_local: fromLocal,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company_email_domain_full"] });
      queryClient.invalidateQueries({ queryKey: ["company_email_domain"] });
      toast({ title: "Domínio criado", description: "Configure os registros DNS abaixo." });
    },
    onError: (e: Error) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("resend-domain-verify", {
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["company_email_domain_full"] });
      queryClient.invalidateQueries({ queryKey: ["company_email_domain"] });
      const s = data?.domain?.status;
      toast({
        title: "Verificação",
        description:
          s === "verified"
            ? "Domínio verificado! Pronto para enviar."
            : "Ainda propagando. Tente novamente em alguns minutos.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("resend-domain-delete", {
        body: {},
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company_email_domain_full"] });
      queryClient.invalidateQueries({ queryKey: ["company_email_domain"] });
      toast({ title: "Domínio removido" });
    },
    onError: (e: Error) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  const isVerified = domain?.status === "verified";

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
          <div className="grid h-12 w-12 place-items-center rounded-lg border bg-background text-primary">
            <Mail className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Email da empresa</h1>
            <p className="text-muted-foreground text-sm">
              Envie e receba emails usando o domínio da sua empresa via Resend.
            </p>
          </div>
        </div>
        {domain && (
          <Badge
            variant="secondary"
            className={
              isVerified
                ? "gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent"
                : "gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-transparent"
            }
          >
            {isVerified ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
            {isVerified ? "Verificado" : domain.status}
          </Badge>
        )}
      </div>

      <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm flex items-start gap-2">
        <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Reputação de envio pertence ao seu domínio</p>
          <p className="text-muted-foreground mt-1">
            Cada empresa envia com seu próprio domínio (ex.: <code>mail.suaempresa.com</code>).
            Isso protege a reputação e melhora a entregabilidade.
          </p>
        </div>
      </div>

      {!isLoading && !domain && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Configurar domínio de envio
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sending_domain">Subdomínio de envio</Label>
              <Input
                id="sending_domain"
                placeholder="mail.suaempresa.com"
                value={sendingDomain}
                onChange={(e) => setSendingDomain(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Recomendado usar subdomínio (não o domínio principal).
              </p>
            </div>
            <div>
              <Label htmlFor="from_name">Nome do remetente</Label>
              <Input
                id="from_name"
                placeholder="SDR"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="from_local">Caixa de envio</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="from_local"
                  placeholder="contato"
                  value={fromLocal}
                  onChange={(e) => setFromLocal(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">@{sendingDomain || "..."}</span>
              </div>
            </div>
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!sendingDomain || createMutation.isPending}
          >
            {createMutation.isPending ? "Criando..." : "Criar domínio no Resend"}
          </Button>
        </div>
      )}

      {domain && (
        <>
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Configuração
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow label="Domínio" value={domain.sending_domain} />
              <InfoRow label="Remetente" value={`${domain.from_name} <${domain.from_email}>`} />
              <InfoRow label="Reply-to" value={domain.reply_to ?? "—"} />
              <InfoRow label="Status" value={domain.status} />
            </div>
            {domain.last_error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                <span className="text-muted-foreground font-mono break-all">{domain.last_error}</span>
              </div>
            )}
          </div>

          {domain.dns_records && domain.dns_records.length > 0 && (
            <div className="rounded-xl border bg-card">
              <div className="p-5 border-b">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Registros DNS
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Adicione estes registros no DNS do seu domínio ({domain.sending_domain}).
                </p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>TTL</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {domain.dns_records.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{r.type}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[220px]">
                          <div className="flex items-center gap-1">
                            <span className="truncate">{r.name}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => copy(`name-${i}`, r.name)}
                            >
                              {copied === `name-${i}` ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[380px]">
                          <div className="flex items-center gap-1">
                            <span className="truncate">{r.value}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={() => copy(`val-${i}`, r.value)}
                            >
                              {copied === `val-${i}` ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.ttl ?? "Auto"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={
                              r.status === "verified"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent"
                                : "bg-muted text-muted-foreground border-transparent"
                            }
                          >
                            {r.status ?? "pendente"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="p-4 border-t flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="h-4 w-4" />
                <span>Após adicionar os registros, DNS pode levar até 72h para propagar.</span>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Enviados (7d)" value={stats?.sent ?? 0} icon={Send} />
            <StatCard label="Recebidos (7d)" value={stats?.received ?? 0} icon={Inbox} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => verifyMutation.mutate()}
              disabled={verifyMutation.isPending || isVerified}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${verifyMutation.isPending ? "animate-spin" : ""}`}
              />
              {isVerified ? "Verificado" : "Verificar DNS"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (confirm("Remover configuração de domínio? Envios serão interrompidos.")) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remover
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">{label}</p>
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
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}
