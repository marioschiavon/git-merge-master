import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Mail,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Send,
  Inbox,
  Info,
  Copy,
  Check,
  Trash2,
  Shield,
  ChevronDown,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  inbound_domain: string | null;
  inbound_dns_records: DnsRecord[] | null;
  inbound_status: string | null;
  inbound_configured_at: string | null;
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

// Injeta linha DMARC recomendada quando o domínio não tem ainda (para domínios
// criados antes da migration de anti-spam).
function withDmarc(domain: DomainRow | null): DnsRecord[] {
  const records: DnsRecord[] = Array.isArray(domain?.dns_records) ? [...domain!.dns_records] : [];
  if (!domain?.sending_domain) return records;
  const hasDmarc = records.some((r) =>
    (r?.name || "").toString().toLowerCase().startsWith("_dmarc"),
  );
  if (hasDmarc) return records;
  const parts = domain.sending_domain.split(".");
  const root = parts.length > 2 ? parts.slice(-2).join(".") : domain.sending_domain;
  const dmarcName = parts.length > 2 ? `_dmarc.${root}` : "_dmarc";
  records.push({
    record: "DMARC",
    name: dmarcName,
    type: "TXT",
    value: `v=DMARC1; p=none; rua=mailto:dmarc@${root}; fo=1; adkim=r; aspf=r`,
    ttl: "Auto",
    status: "pending_manual",
  });
  return records;
}

function withInbound(domain: DomainRow | null): DnsRecord[] {
  if (!domain?.inbound_domain) return [];
  const records: DnsRecord[] = Array.isArray(domain?.inbound_dns_records)
    ? [...domain!.inbound_dns_records]
    : [];
  if (records.length > 0) return records;
  return [
    {
      record: "Inbound",
      name: "inbound",
      type: "MX",
      value: "inbound-smtp.us-east-1.amazonaws.com",
      priority: 10,
      ttl: "Auto",
      status: "pending",
    },
  ];
}

function deliverabilityChecks(domain: DomainRow | null) {
  const records = withDmarc(domain);
  const inboundRecords = withInbound(domain);
  const has = (rec: string) =>
    records.some((r) => (r.record || "").toUpperCase() === rec.toUpperCase() && r.status === "verified");
  const hasType = (t: string) =>
    records.some((r) => (r.type || "").toUpperCase() === t.toUpperCase() && r.status === "verified");
  const dmarcRow = records.find((r) =>
    (r?.name || "").toString().toLowerCase().startsWith("_dmarc"),
  );
  const parts = (domain?.sending_domain || "").split(".");
  const isSubdomain = parts.length > 2;
  const inboundVerified = inboundRecords.length > 0 && inboundRecords.every((r) => r.status === "verified");
  return {
    spf: has("SPF") || hasType("MX"),
    dkim: has("DKIM"),
    dmarc: dmarcRow?.status === "verified",
    subdomain: !!domain && isSubdomain,
    inbound: domain?.inbound_status === "verified" || inboundVerified,
  };
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

type StepState = "done" | "current" | "pending";

function computeSteps(domain: DomainRow | null): StepState[] {
  if (!domain) return ["current", "pending", "pending", "pending"];
  if (domain.status === "verified") return ["done", "done", "done", "done"];
  // pending / verifying / failed / others
  return ["done", "done", "current", "pending"];
}

const STEP_LABELS = [
  { title: "Escolha um subdomínio", desc: "Ex.: mail.suaempresa.com — não use o domínio raiz." },
  { title: "Cadastre aqui", desc: "Vamos gerar os registros de DNS automaticamente." },
  { title: "Adicione os registros no DNS", desc: "Copie e cole no painel do seu registrador." },
  { title: "Clique em 'Verificar DNS'", desc: "Liberamos o envio assim que o DNS propagar." },
];

export default function EmailSettings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: domain, isLoading } = useDomain();
  const { data: stats } = useEmailStats();

  const [sendingDomain, setSendingDomain] = useState("");
  const [fromName, setFromName] = useState("Atendimento");
  const [fromLocal, setFromLocal] = useState("atendimento");
  const [copied, setCopied] = useState<string | null>(null);
  const [dnsHelpOpen, setDnsHelpOpen] = useState(false);
  const [showDnsWhenVerified, setShowDnsWhenVerified] = useState(false);

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
      toast({ title: "Domínio criado", description: "Agora adicione os registros DNS abaixo." });
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
        title: s === "verified" ? "Verificado!" : "Ainda propagando",
        description:
          s === "verified"
            ? "Tudo pronto — sua empresa já pode enviar emails."
            : "Estamos verificando automaticamente em segundo plano — a tela atualiza sozinha assim que o DNS propagar.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  // Auto-poll silencioso enquanto o domínio ainda não está verificado.
  const pollAttemptsRef = useRef(0);
  const isPollingStatus = domain && (domain.status === "pending" || domain.status === "verifying");
  useEffect(() => {
    if (!isPollingStatus) {
      pollAttemptsRef.current = 0;
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      pollAttemptsRef.current += 1;
      try {
        await supabase.functions.invoke("resend-domain-verify", { body: {} });
      } catch {
        // ignora erros no polling silencioso
      }
      if (!cancelled) {
        queryClient.invalidateQueries({ queryKey: ["company_email_domain_full"] });
      }
    };
    // primeira tentativa imediata (rápida, ao abrir a página)
    tick();
    const interval = setInterval(() => {
      if (pollAttemptsRef.current >= 20) {
        clearInterval(interval);
        return;
      }
      tick();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPollingStatus]);


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

  const copy = async (label: string, value: string) => {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } else {
      toast({
        title: "Não foi possível copiar automaticamente",
        description: "Selecione o texto e use Ctrl+C (Cmd+C no Mac).",
        variant: "destructive",
      });
    }
  };

  const isVerified = domain?.status === "verified";
  const steps = computeSteps(domain ?? null);
  const previewDomain = sendingDomain || "mail.suaempresa.com";
  const previewFrom = `${fromName || "Atendimento"} <${fromLocal || "atendimento"}@${previewDomain}>`;

  const createdAtMs = domain ? Date.parse((domain as any).created_at ?? "") : NaN;
  const hoursSinceCreated = Number.isFinite(createdAtMs)
    ? (Date.now() - createdAtMs) / 3_600_000
    : 0;
  const isStuckVerifying =
    !!domain && !isVerified && domain.status === "verifying" && hoursSinceCreated > 24;

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
              Envie e receba emails usando o domínio da sua empresa.
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
            {isVerified ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <RefreshCw className="h-3 w-3 animate-spin" />
            )}
            {isVerified ? "Verificado" : "Verificando automaticamente..."}
          </Badge>
        )}
      </div>

      <div className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm flex items-start gap-2">
        <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">A reputação de envio pertence ao seu domínio</p>
          <p className="text-muted-foreground mt-1">
            Cada empresa envia com seu próprio domínio (ex.: <code>mail.suaempresa.com</code>).
            Isso protege sua reputação e melhora a entregabilidade dos emails.
          </p>
        </div>
      </div>

      {/* Passo a passo */}
      <div className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Como funciona (4 passos)
        </h2>
        <ol className="space-y-3">
          {STEP_LABELS.map((s, i) => {
            const state = steps[i];
            return (
              <li key={i} className="flex items-start gap-3">
                <div
                  className={
                    "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold " +
                    (state === "done"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : state === "current"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground")
                  }
                >
                  {state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div>
                  <p
                    className={
                      "text-sm font-medium " +
                      (state === "pending" ? "text-muted-foreground" : "text-foreground")
                    }
                  >
                    {s.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.desc}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {isVerified && (
          <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5" />
            <span>Tudo pronto! Sua empresa já pode enviar emails pelo Leaderei.</span>
          </div>
        )}
      </div>

      {domain && (
        <>
          <DeliverabilityCard domain={domain} />
          <InboundCard domain={domain} copy={copy} />
        </>
      )}

      {!isLoading && !domain && (
        <div className="rounded-xl border bg-card p-5 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Passo 1: Cadastre seu domínio de envio
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Preencha os campos abaixo. É rápido — os detalhes técnicos ficam por nossa conta.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="sending_domain">Subdomínio de envio</Label>
              <Input
                id="sending_domain"
                placeholder="mail.suaempresa.com"
                value={sendingDomain}
                onChange={(e) => setSendingDomain(e.target.value.toLowerCase().trim())}
              />
              <p className="text-xs text-muted-foreground mt-1">
                É o endereço técnico usado para enviar. Recomendamos <code>mail.suaempresa.com</code>.
                Se <code>suaempresa.com</code> já é seu, basta usar <code>mail.</code> na frente.
                Não use o domínio principal — isso protege sua reputação.
              </p>
            </div>

            <div>
              <Label htmlFor="from_name">Nome do remetente</Label>
              <Input
                id="from_name"
                placeholder="Atendimento"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Nome que aparece na caixa de entrada de quem recebe. Ex.: Atendimento, Comercial,
                Equipe Acme.
              </p>
            </div>

            <div>
              <Label htmlFor="from_local">Caixa de envio</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="from_local"
                  placeholder="atendimento"
                  value={fromLocal}
                  onChange={(e) => setFromLocal(e.target.value.toLowerCase().trim())}
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  @{sendingDomain || "mail.suaempresa.com"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Parte antes do @. Ex.: atendimento, contato, ola. Evite <code>no-reply</code> —
                respostas são bem-vindas e sinal positivo para provedores.
              </p>
            </div>
          </div>

          <div className="rounded-md border bg-background p-3">
            <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              Prévia — como o destinatário vai ver
            </p>
            <p className="mt-1 text-sm font-medium text-foreground break-all">{previewFrom}</p>
          </div>

          <Button
            onClick={() => createMutation.mutate()}
            disabled={!sendingDomain || createMutation.isPending}
          >
            {createMutation.isPending ? "Criando..." : "Cadastrar domínio e gerar registros DNS"}
          </Button>
        </div>
      )}

      {domain && (
        <>
          <div className="rounded-xl border bg-card p-5 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Sua configuração
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow label="Domínio" value={domain.sending_domain} />
              <InfoRow
                label="Remetente"
                value={`${domain.from_name ?? "Atendimento"} <${domain.from_email ?? ""}>`}
              />
              <InfoRow label="Reply-to" value={domain.reply_to ?? "—"} />
              <InfoRow
                label="Status"
                value={
                  domain.status === "verified"
                    ? "Verificado"
                    : domain.status === "pending"
                      ? "Aguardando DNS"
                      : domain.status === "verifying"
                        ? "Verificando..."
                        : domain.status === "failed"
                          ? "Falhou"
                          : domain.status
                }
              />
            </div>
            {domain.last_error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                <span className="text-muted-foreground font-mono break-all">
                  {domain.last_error}
                </span>
              </div>
            )}
            {isStuckVerifying && !domain.last_error && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm flex items-start gap-2">
                <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-muted-foreground">
                  Os registros DNS parecem publicados, mas o Resend ainda não fechou a verificação
                  (já se passaram mais de 24h). Isso costuma resolver sozinho em algumas horas —
                  nosso sistema re-verifica automaticamente a cada hora. Se persistir, remova o
                  domínio e cadastre de novo.
                </div>
              </div>
            )}
            {!isVerified && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                >
                  <RefreshCw
                    className={`h-3 w-3 mr-1 ${verifyMutation.isPending ? "animate-spin" : ""}`}
                  />
                  Verificar DNS agora
                </Button>
                {isStuckVerifying && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (
                        confirm(
                          "Remover o domínio atual e recomeçar o cadastro? Os registros DNS podem precisar ser atualizados.",
                        )
                      ) {
                        deleteMutation.mutate();
                      }
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Remover e cadastrar de novo
                  </Button>
                )}
              </div>
            )}
          </div>


          {domain.dns_records && domain.dns_records.length > 0 && (
            <>
              {isVerified && !showDnsWhenVerified ? (
                <button
                  className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
                  onClick={() => setShowDnsWhenVerified(true)}
                >
                  Ver registros DNS configurados
                </button>
              ) : (
                <div className="rounded-xl border bg-card">
                  <div className="p-5 border-b space-y-2">
                    <h2 className="text-base font-semibold text-foreground">
                      Passo 3: Adicione estes registros no DNS do seu domínio
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Copie cada registro abaixo e cadastre no painel de DNS do seu registrador
                      (onde você comprou o domínio <code>{domain.sending_domain}</code>). Cada
                      linha da tabela vira uma entrada nova.
                    </p>
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div className="text-muted-foreground">
                        Ao copiar o campo <b>Nome</b>, use exatamente o que aparece aqui. Alguns
                        provedores adicionam o domínio automaticamente — se acontecer duplicação
                        (ex.: <code>mail.suaempresa.com.suaempresa.com</code>), apague a parte
                        extra.
                      </div>
                    </div>
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
                        {withDmarc(domain).map((r, i) => (
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
                            <TableCell className="text-xs text-muted-foreground">
                              {r.ttl ?? "Auto"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={
                                  r.status === "verified"
                                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent"
                                    : r.status === "pending_manual"
                                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-transparent"
                                      : "bg-muted text-muted-foreground border-transparent"
                                }
                              >
                                {r.status === "verified"
                                  ? "verificado"
                                  : r.status === "pending_manual"
                                    ? "recomendado"
                                    : "pendente"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="p-4 border-t">
                    <Collapsible open={dnsHelpOpen} onOpenChange={setDnsHelpOpen}>
                      <CollapsibleTrigger asChild>
                        <button className="flex w-full items-center justify-between text-sm font-medium text-foreground">
                          <span>Como adicionar DNS no meu provedor?</span>
                          <ChevronDown
                            className={
                              "h-4 w-4 transition-transform " + (dnsHelpOpen ? "rotate-180" : "")
                            }
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-3 space-y-3 text-sm text-muted-foreground">
                        <ProviderHelp
                          name="Registro.br"
                          steps={[
                            "Acesse registro.br e entre na sua conta.",
                            "Vá em Painel → seu domínio → Editar Zona DNS.",
                            "Para cada linha da tabela acima, clique em 'Novo registro' e preencha Tipo, Nome e Valor.",
                            "Salve as alterações.",
                          ]}
                        />
                        <ProviderHelp
                          name="GoDaddy"
                          steps={[
                            "Acesse godaddy.com e entre na sua conta.",
                            "Vá em Meus Produtos → seu domínio → DNS.",
                            "Clique em 'Adicionar' e preencha Tipo, Nome e Valor para cada linha.",
                            "Salve.",
                          ]}
                        />
                        <ProviderHelp
                          name="Cloudflare"
                          steps={[
                            "Acesse cloudflare.com e selecione seu domínio.",
                            "Vá em DNS → Records → Add record.",
                            "Preencha Tipo, Nome e Valor. Deixe o Proxy DESLIGADO (nuvem cinza).",
                            "Salve cada registro.",
                          ]}
                        />
                        <ProviderHelp
                          name="HostGator / Locaweb / cPanel"
                          steps={[
                            "Acesse o cPanel do seu provedor de hospedagem.",
                            "Procure por 'Zona DNS' ou 'Editor de zona'.",
                            "Adicione um registro novo para cada linha da tabela acima.",
                            "Salve.",
                          ]}
                        />
                      </CollapsibleContent>
                    </Collapsible>
                  </div>

                  <div className="p-4 border-t flex items-center gap-2 text-xs text-muted-foreground">
                    <Info className="h-4 w-4" />
                    <span>
                      Após adicionar, o DNS pode levar até 72h para propagar — mas normalmente é
                      bem mais rápido (15 minutos a 2 horas).
                    </span>
                  </div>
                </div>
              )}
            </>
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
              {isVerified ? "Verificado" : "Passo 4: Verificar meu DNS"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (
                  confirm(
                    "Remover configuração de domínio? Os envios da sua empresa serão interrompidos.",
                  )
                ) {
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

function DeliverabilityCard({ domain }: { domain: DomainRow }) {
  const checks = deliverabilityChecks(domain);
  const items: Array<{ ok: boolean; label: string; hint: string }> = [
    {
      ok: checks.spf,
      label: "SPF",
      hint: "Autoriza o Resend a enviar em nome do seu domínio.",
    },
    {
      ok: checks.dkim,
      label: "DKIM",
      hint: "Assina digitalmente cada email — essencial para não cair no spam.",
    },
    {
      ok: checks.dmarc,
      label: "DMARC",
      hint: "Exigido pelo Gmail/Yahoo (2024). Sem ele, entregabilidade despenca.",
    },
    {
      ok: checks.subdomain,
      label: "Subdomínio de envio",
      hint: "Use um subdomínio (ex.: mail.seudominio.com) para isolar a reputação do domínio raiz.",
    },
    {
      ok: checks.inbound,
      label: "Recebimento de respostas",
      hint: "MX de inbound permite que o Leaderei receba replies dos prospects e mantenha a conversa no app.",
    },
  ];
  const okCount = items.filter((i) => i.ok).length;
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Checklist de entregabilidade</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Requisitos para não cair no spam (Gmail e Yahoo apertaram as regras em 2024).
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {okCount}/{items.length} ok
        </Badge>
      </div>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2 text-sm">
            {item.ok ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
            )}
            <div>
              <p className="font-medium text-foreground">{item.label}</p>
              <p className="text-muted-foreground">{item.hint}</p>
            </div>
          </li>
        ))}
      </ul>
      {!checks.dmarc && (
        <p className="mt-4 text-xs text-muted-foreground">
          Adicione a linha DMARC listada nos registros DNS abaixo no seu provedor
          (ela aparece marcada como <strong>recomendado</strong>). É um TXT em
          <code className="mx-1 rounded bg-muted px-1">_dmarc.seudominio.com</code>
          com política <code className="rounded bg-muted px-1">p=none</code> para monitorar sem bloquear.
        </p>
      )}
    </div>
  );
}

function InboundCard({ domain, copy }: { domain: DomainRow; copy: (label: string, value: string) => void }) {
  const records = withInbound(domain);
  const isVerified = domain.inbound_status === "verified";
  const isPending = domain.inbound_status === "pending" || !domain.inbound_status;
  const inboundAddress = domain.reply_to || (domain.from_email ? `${domain.from_email.split("@")[0]}@${domain.inbound_domain}` : "");

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Recebimento de respostas</h2>
          <p className="text-sm text-muted-foreground mt-1">
            As respostas dos prospects chegam em <code className="rounded bg-muted px-1">{domain.inbound_domain}</code>.
            O <b>Reply-To</b> dos emails de saída é automaticamente configurado para este endereço.
          </p>
        </div>
        <Badge
          variant="secondary"
          className={
            isVerified
              ? "gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-transparent"
              : "gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-transparent"
          }
        >
          {isVerified ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {isVerified ? "Ativo" : isPending ? "Configurando" : "Verificando"}
        </Badge>
      </div>

      <div className="mt-4 rounded-md border bg-background p-3">
        <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">Endereço de reply-to</p>
        <div className="flex items-center gap-2 mt-1">
          <p className="text-sm font-medium text-foreground break-all">{inboundAddress}</p>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copy("reply-to", inboundAddress)}>
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {records.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-medium text-foreground mb-2">Registro DNS de recebimento</p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Prioridade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">{r.type}</TableCell>
                    <TableCell className="font-mono text-xs">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs max-w-[300px]">
                      <div className="flex items-center gap-1">
                        <span className="truncate">{r.value}</span>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => copy(`inbound-val-${i}`, r.value)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.priority ?? 10}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Adicione este registro no painel DNS do domínio raiz (onde está configurado <code className="rounded bg-muted px-1">{domain.sending_domain}</code>).
            Se seu provedor preencher o domínio automaticamente, o nome completo será <code className="rounded bg-muted px-1">{domain.inbound_domain}</code>.
          </p>
        </div>
      )}

      {!isVerified && (
        <p className="mt-4 text-xs text-muted-foreground">
          A propagação do MX de inbound pode levar até 1h. Enquanto isso, o Leaderei
          continua enviando; apenas as respostas ainda não são roteadas para o app.
        </p>
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

function ProviderHelp({ name, steps }: { name: string; steps: string[] }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-sm font-medium text-foreground">{name}</p>
      <ol className="mt-2 list-decimal list-inside space-y-1 text-xs">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
