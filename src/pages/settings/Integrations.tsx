import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Check,
  ExternalLink,
  Mail,
  Plug,
  RefreshCw,
  Unplug,
  type LucideIcon,
} from "lucide-react";
import { SiWhatsapp, SiCalendly } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import type { IconType } from "react-icons";
import {
  useIntegration,
  useConnectPipedrive,
  useDisconnectPipedrive,
  useSyncLeads,
} from "@/hooks/usePipedrive";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { EnrichmentSettingsCard } from "@/components/EnrichmentSettingsCard";
import { WhatsAppManagerDialog } from "@/components/WhatsAppManagerDialog";
import { ApolloConnectDialog } from "@/components/ApolloConnectDialog";
import { useApolloStatus } from "@/hooks/useApollo";
import { useCalcomConnection, useCalcomConnect, useCalcomDisconnect, useCalcomTestConnection } from "@/hooks/useCalcom";
import { Sparkles } from "lucide-react";


// ---------------------------------------------------------------------------
// Brand icons
// ---------------------------------------------------------------------------

const PipedriveIcon: IconType = (props: any) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M14.32 0C9.92 0 7.04 2.24 7.04 5.76c0 2.4 1.6 4.16 4.32 4.16 1.12 0 2.08-.32 2.72-.8v.16c0 2.4-1.6 3.84-4.32 3.84-1.6 0-3.04-.48-4-1.12L4.8 15.84C6.08 16.96 8.32 17.76 10.88 17.76c5.12 0 8.16-2.88 8.16-7.52V6.4C19.04 2.4 17.12 0 14.32 0zm-.48 6.72c-.48.32-1.12.48-1.76.48-1.28 0-2.08-.8-2.08-1.92 0-1.28.96-2.08 2.4-2.08 1.28 0 2.08.96 2.08 2.4 0 .48-.16.8-.64 1.12zM4.96 18.24v5.28L9.6 24v-5.12c-1.6-.16-3.2-.32-4.64-.64z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Status metadata
// ---------------------------------------------------------------------------

type StatusKey = "connected" | "pending" | "error" | "disconnected";

const STATUS_META: Record<
  StatusKey,
  { label: string; icon: LucideIcon; className: string; helper: string }
> = {
  connected: {
    label: "Conectado",
    icon: CheckCircle2,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    helper: "Integração ativa para esta empresa.",
  },
  pending: {
    label: "Pendente",
    icon: Clock3,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    helper: "Setup iniciado, aguardando conclusão.",
  },
  error: {
    label: "Erro",
    icon: AlertTriangle,
    className: "bg-destructive/10 text-destructive",
    helper: "Última sincronização ou autenticação falhou.",
  },
  disconnected: {
    label: "Desconectado",
    icon: Circle,
    className: "bg-muted text-muted-foreground",
    helper: "Provider disponível, sem conexão ativa.",
  },
};

function relTime(iso?: string | null): string {
  if (!iso) return "Ainda não sincronizado";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
}

// ---------------------------------------------------------------------------
// Provider card + summary card
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent ? "border-primary/30 bg-primary/5" : "bg-card"
      }`}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

type ProviderCardProps = {
  name: string;
  category: string;
  description: string;
  icon: IconType | LucideIcon;
  iconTint?: string;
  status: StatusKey;
  operationalLabel?: string;
  syncLabel?: string | null;
  readinessLabel?: string;
  errorMessage?: string | null;
  actionLabel?: string;
  disabled?: boolean;
  onAction?: () => void;
  badgeLink?: { label: string; to: string };
};

function ProviderCard(props: ProviderCardProps) {
  const meta = STATUS_META[props.status];
  const StatusIcon = meta.icon;
  const Icon = props.icon;

  return (
    <div className="flex flex-col rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`grid h-10 w-10 place-items-center rounded-md border bg-background ${
              props.iconTint ?? "text-muted-foreground"
            }`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold leading-tight text-foreground">
              {props.name}
            </h3>
            <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">
              {props.category}
            </p>
          </div>
        </div>
        <Badge
          variant="secondary"
          className={`${meta.className} gap-1 border-transparent font-normal`}
        >
          <StatusIcon className="h-3 w-3" />
          {meta.label}
        </Badge>
      </div>

      <p className="mt-4 text-sm text-muted-foreground">{props.description}</p>

      <div className="mt-4 space-y-2 rounded-lg border bg-background p-3 text-xs text-muted-foreground">
        <div className="flex items-center justify-between gap-3">
          <span>Status operacional</span>
          <span className="font-medium text-foreground">
            {props.operationalLabel ?? meta.label}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Último sync</span>
          <span>{props.syncLabel ?? "Ainda não sincronizado"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Readiness</span>
          <span>
            {props.readinessLabel ??
              (props.status === "connected"
                ? "Pronto pra uso"
                : "Aguardando setup")}
          </span>
        </div>
      </div>

      {props.errorMessage && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {props.errorMessage}
        </p>
      )}

      <div className="mt-5 flex-1" />

      <Button
        variant={props.status === "connected" ? "outline" : "default"}
        size="sm"
        className="w-full"
        disabled={props.disabled}
        onClick={props.onAction}
      >
        {props.actionLabel ??
          (props.status === "connected" ? "Gerenciar" : "Configurar")}
        {props.status !== "connected" && !props.disabled && (
          <ArrowRight className="ml-1 h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipedrive dialog
// ---------------------------------------------------------------------------

function PipedriveDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [apiToken, setApiToken] = useState("");
  const { data: integration } = useIntegration("pipedrive");
  const connectMutation = useConnectPipedrive();
  const disconnectMutation = useDisconnectPipedrive();
  const syncMutation = useSyncLeads();
  const isConnected = integration?.status === "active";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pipedrive</DialogTitle>
          <DialogDescription>
            Importe leads e sincronize atividades do Pipedrive.
          </DialogDescription>
        </DialogHeader>

        {!isConnected ? (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pd-token">API Token</Label>
              <Input
                id="pd-token"
                type="password"
                placeholder="Cole seu API Token do Pipedrive"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                <a
                  href="https://app.pipedrive.com/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Onde encontrar meu API Token? <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => connectMutation.mutate(apiToken)}
              disabled={!apiToken || connectMutation.isPending}
            >
              <Plug className="mr-2 h-4 w-4" />
              {connectMutation.isPending ? "Conectando..." : "Conectar"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {integration?.last_synced_at && (
              <p className="text-xs text-muted-foreground">
                Última sincronização:{" "}
                {new Date(integration.last_synced_at).toLocaleString("pt-BR")}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${
                    syncMutation.isPending ? "animate-spin" : ""
                  }`}
                />
                {syncMutation.isPending ? "Sincronizando..." : "Sincronizar agora"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Desconectar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Email (Resend) — status hook
// ---------------------------------------------------------------------------

function useEmailDomain() {
  return useQuery({
    queryKey: ["company_email_domain"],
    queryFn: async () => {
      const { data } = await supabase
        .from("company_email_domains")
        .select("id, sending_domain, from_email, status, verified_at")
        .maybeSingle();
      return data;
    },
  });
}


// ---------------------------------------------------------------------------
// Cal.com dialog
// ---------------------------------------------------------------------------

function CalcomDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: conn, refetch } = useCalcomConnection();
  const test = useCalcomTestConnection();
  const connect = useCalcomConnect();
  const disconnect = useCalcomDisconnect();
  const [apiKey, setApiKey] = useState("");
  const [bookingLink, setBookingLink] = useState("");
  const [testResult, setTestResult] = useState<{ email?: string; username?: string; eventTypes: number } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setApiKey("");
      setTestResult(null);
      setBookingLink(conn?.booking_link || "");
    }
  }, [open, conn?.booking_link]);

  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
  const webhookUrl = conn?.slug && projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/calcom-webhook/${conn.slug}`
    : "";

  const copy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch { /* ignore */ }
  };

  const handleTest = async () => {
    if (!apiKey.trim()) return;
    try {
      const r = await test.mutateAsync({ api_key: apiKey.trim() });
      setTestResult({ email: r.cal_user?.email, username: r.cal_user?.username, eventTypes: r.event_types?.length || 0 });
      toast({ title: "Conexão OK", description: `Autenticado como ${r.cal_user?.email || r.cal_user?.username || "usuário Cal.com"} • ${r.event_types?.length || 0} tipos de evento` });
    } catch (e: any) {
      setTestResult(null);
      toast({ title: "Falha ao testar", description: e.message, variant: "destructive" });
    }
  };

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    try {
      await connect.mutateAsync({ api_key: apiKey.trim(), booking_link: bookingLink.trim() });
      setApiKey("");
      setTestResult(null);
      refetch();
    } catch (e: any) {
      toast({ title: "Falha ao conectar", description: e.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cal.com</DialogTitle>
          <DialogDescription>
            Conecte a conta Cal.com desta empresa. Agendamento inteligente reserva 2 slots e oferece ao prospect automaticamente.
          </DialogDescription>
        </DialogHeader>

        {conn?.connected ? (
          <div className="space-y-3 py-2 text-sm">
            <div className="rounded-md border bg-emerald-500/5 p-3 space-y-1">
              <p className="font-medium text-emerald-700 dark:text-emerald-400">Cal.com conectado</p>
              <p className="text-xs text-muted-foreground">
                Conectado em {conn.connected_at ? new Date(conn.connected_at).toLocaleString("pt-BR") : "-"}
              </p>
              {conn.last_error && (
                <p className="text-xs text-destructive">Último erro: {conn.last_error}</p>
              )}
            </div>

            {webhookUrl && (
              <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
                <p className="font-medium">Webhook (cole no Cal.com → Settings → Developer → Webhooks)</p>
                <div className="flex items-center gap-2 rounded bg-background px-2 py-1 font-mono text-[11px] break-all">
                  <span className="flex-1">{webhookUrl}</span>
                  <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => copy(webhookUrl, "url")}>
                    {copiedField === "url" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
                {conn.webhook_secret && (
                  <>
                    <p className="pt-2 font-medium">Secret (HMAC-SHA256)</p>
                    <div className="flex items-center gap-2 rounded bg-background px-2 py-1 font-mono text-[11px] break-all">
                      <span className="flex-1">{conn.webhook_secret}</span>
                      <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => copy(conn.webhook_secret!, "secret")}>
                        {copiedField === "secret" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      </Button>
                    </div>
                  </>
                )}
                <p className="pt-2 text-muted-foreground">
                  Selecione os eventos: <code>BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED, BOOKING_NO_SHOW_UPDATED, MEETING_ENDED</code>.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cal-key">API Key do Cal.com</Label>
              <Input
                id="cal-key"
                type="password"
                placeholder="cal_live_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Cole apenas a chave secreta (<code>cal_live_...</code> ou <code>cal_...</code>), sem <code>Bearer</code>.
              </p>
              <p className="text-xs text-muted-foreground">
                <a
                  href="https://app.cal.com/settings/developer/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Gerar API key no Cal.com <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cal-link">Link público de agendamento (opcional)</Label>
              <Input
                id="cal-link"
                placeholder="https://cal.com/seunome/30min"
                value={bookingLink}
                onChange={(e) => setBookingLink(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Usado como fallback quando o agente sugere marcação manual.
              </p>
            </div>

            {testResult && (
              <div className="rounded-md border bg-emerald-500/5 p-2 text-xs">
                ✅ Autenticado como <strong>{testResult.email || testResult.username}</strong> · {testResult.eventTypes} tipos de evento
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleConnect}
                disabled={!apiKey.trim() || connect.isPending}
              >
                <Plug className="mr-2 h-4 w-4" />
                {connect.isPending ? "Conectando..." : "Conectar"}
              </Button>
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={!apiKey.trim() || test.isPending}
              >
                {test.isPending ? "Testando..." : "Testar conexão"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Z-API/Twilio removidos — WhatsApp usa apenas Hook7 agora.

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Integrations() {
  const navigate = useNavigate();
  const { data: pipedrive } = useIntegration("pipedrive");
  const { data: emailDomain } = useEmailDomain();

  const [pipedriveOpen, setPipedriveOpen] = useState(false);
  const [calcomOpen, setCalcomOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [apolloOpen, setApolloOpen] = useState(false);
  const { data: apolloStatus } = useApolloStatus();

  // Hook7 (novo WhatsApp) — status agregado por company
  const { data: hook7Instances } = useQuery({
    queryKey: ["hook7_instances_summary"],
    queryFn: async () => {
      const { data } = await supabase
        .from("hook7_instances")
        .select("id, status, phone_number, connected_profile_name")
        .is("archived_at", null);
      return data ?? [];
    },
  });
  const hook7Connected = (hook7Instances ?? []).find(
    (i: any) => i.status === "connected",
  );
  const whatsappStatus: StatusKey =
    hook7Connected
      ? "connected"
      : (hook7Instances ?? []).length > 0
      ? "pending"
      : "disconnected";

  const pipedriveStatus: StatusKey =
    pipedrive?.status === "active" ? "connected" : "disconnected";
  const emailStatus: StatusKey =
    emailDomain?.status === "verified"
      ? "connected"
      : emailDomain
        ? "pending"
        : "disconnected";
  const { data: calcomConn } = useCalcomConnection();
  const calcomStatus: StatusKey = calcomConn?.connected ? "connected" : "disconnected";

  const providers: Array<ProviderCardProps & { key: string }> = [
    {
      key: "pipedrive",
      name: "Pipedrive",
      category: "CRM",
      description: "Importe leads e sincronize atividades do Pipedrive.",
      icon: PipedriveIcon,
      iconTint: "text-foreground",
      status: pipedriveStatus,
      syncLabel: pipedrive?.last_synced_at ? relTime(pipedrive.last_synced_at) : null,
      onAction: () => setPipedriveOpen(true),
    },
    {
      key: "email",
      name: "Email",
      category: "Email",
      description:
        "Cada empresa envia com seu próprio domínio (mail.suaempresa.com). Reputação isolada por cliente.",
      icon: Mail,
      iconTint: "text-primary",
      status: emailStatus,
      operationalLabel: emailDomain?.from_email ?? emailDomain?.sending_domain ?? undefined,
      readinessLabel:
        emailDomain && emailDomain.status !== "verified" ? "Aguardando verificação DNS" : undefined,
      onAction: () => navigate("/settings/email"),
    },

    {
      key: "cal_com",
      name: "Cal.com",
      category: "Agenda",
      description:
        "Agendamento inteligente — reserva 2 slots automaticamente e oferece ao prospect.",
      icon: SiCalendly,
      iconTint: "text-foreground",
      status: calcomStatus,
      operationalLabel: calcomConn?.connected ? "Conta conectada" : undefined,
      syncLabel: calcomConn?.connected_at ? relTime(calcomConn.connected_at) : null,
      readinessLabel: calcomConn?.connected ? undefined : "Cole a API key da sua empresa",
      errorMessage: calcomConn?.last_error || null,
      onAction: () => setCalcomOpen(true),
    },
    {
      key: "whatsapp",
      name: "WhatsApp",
      category: "Mensageria",
      description:
        "Conecte o WhatsApp da sua empresa para que o agente envie mensagens aos seus leads e acompanhe respostas automaticamente.",
      icon: SiWhatsapp,
      iconTint: "text-[#25D366]",
      status: whatsappStatus,
      operationalLabel:
        hook7Connected
          ? (hook7Connected.connected_profile_name ??
             hook7Connected.phone_number ??
             "Conectado")
          : undefined,
      readinessLabel:
        whatsappStatus === "pending" ? "Aguardando leitura do QR" : undefined,
      onAction: () => setWhatsappOpen(true),
    },
    {
      key: "apollo",
      name: "Apollo.io",
      category: "Prospecção",
      description: "Busque prospects e enriqueça leads direto pela API do Apollo.",
      icon: Sparkles,
      iconTint: "text-primary",
      status: (apolloStatus?.connected ? "connected" : "disconnected") as StatusKey,
      operationalLabel: apolloStatus?.connected ? "Chave ativa" : undefined,
      syncLabel: apolloStatus?.last_check_at ? relTime(apolloStatus.last_check_at) : null,
      onAction: () => setApolloOpen(true),
    },
    {
      key: "linkedin",
      name: "LinkedIn",
      category: "Social",
      description: "Conecte e envie mensagens no LinkedIn. Em breve.",
      icon: FaLinkedin,
      iconTint: "text-[#0A66C2]",
      status: "disconnected",
      readinessLabel: "Em breve",
      actionLabel: "Em breve",
      disabled: true,
    },
  ];

  const connectedCount = providers.filter((p) => p.status === "connected").length;
  const pendingCount = providers.filter((p) => p.status === "pending").length;
  const errorCount = providers.filter((p) => p.status === "error").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Integrações</h1>
        <p className="text-muted-foreground">
          Status reais dos provedores disponíveis para a empresa atual.
        </p>
      </div>

      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <div className="flex items-start gap-3">
          <Plug className="mt-0.5 h-4 w-4 text-primary" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">Conecte seus canais</p>
            <p className="text-muted-foreground">
              Cada integração é isolada por empresa. Credenciais ficam armazenadas com
              segurança e podem ser revogadas a qualquer momento no botão{" "}
              <strong>Gerenciar</strong> do respectivo card.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard label="Disponíveis" value={providers.length} />
        <SummaryCard label="Conectadas" value={connectedCount} accent />
        <SummaryCard label="Pendentes" value={pendingCount} />
        <SummaryCard label="Com erro" value={errorCount} />
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map(({ key, ...p }) => (
          <ProviderCard key={key} {...p} />
        ))}
      </section>

      <EnrichmentSettingsCard />

      <PipedriveDialog open={pipedriveOpen} onOpenChange={setPipedriveOpen} />
      
      <CalcomDialog open={calcomOpen} onOpenChange={setCalcomOpen} />
      
      <WhatsAppManagerDialog open={whatsappOpen} onOpenChange={setWhatsappOpen} />

      <ApolloConnectDialog open={apolloOpen} onOpenChange={setApolloOpen} />
    </div>
  );
}
