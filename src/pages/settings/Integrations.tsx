import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { Sparkles } from "lucide-react";

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const ZAPI_WEBHOOK_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/zapi-webhook`;

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
// Gmail dialog
// ---------------------------------------------------------------------------

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

function GmailDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: account, isLoading } = useGmailAccount();
  const isConnected = !!account;

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
      const msg = data?.bootstrapped
        ? `Conta ${data.email} conectada.`
        : `${data?.processed || 0} respostas processadas (${
            data?.matched || 0
          } casadas com leads).`;
      toast({ title: "Sincronização Gmail", description: msg });
    },
    onError: (e: Error) =>
      toast({ title: "Erro no Gmail", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Gmail</DialogTitle>
          <DialogDescription>
            Envia emails das cadências e recebe respostas dos leads dentro de Conversations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isConnected && (
            <p className="text-xs text-muted-foreground">
              Conta: <strong>{account!.email}</strong>
              {account!.last_synced_at && (
                <> · última sync: {new Date(account!.last_synced_at).toLocaleString("pt-BR")}</>
              )}
            </p>
          )}
          {!isConnected && (
            <p className="text-xs text-muted-foreground">
              Clique em "Inicializar / Sincronizar" para registrar a conta Gmail conectada
              ao workspace.
            </p>
          )}
          <Button
            className="w-full"
            variant={isConnected ? "outline" : "default"}
            onClick={() => syncMutation.mutate()}
            disabled={isLoading || syncMutation.isPending}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
            />
            {syncMutation.isPending
              ? "Sincronizando..."
              : isConnected
                ? "Sincronizar agora"
                : "Inicializar / Sincronizar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cal.com</DialogTitle>
          <DialogDescription>
            Agendamento inteligente — reserva 2 slots automaticamente e oferece ao prospect.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs text-muted-foreground">
          <p>
            As credenciais do Cal.com são configuradas como variáveis de ambiente no backend.
            Você precisa de: <strong>API Key</strong>, <strong>Event Type ID</strong> e{" "}
            <strong>Link de agendamento</strong>.
          </p>
          <p>
            <a
              href="https://app.cal.com/settings/developer/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Onde encontrar minha API Key? <ExternalLink className="h-3 w-3" />
            </a>
          </p>
          <div className="rounded-md border bg-muted/40 p-3 space-y-1">
            <p>✅ <strong>CALCOM_API_KEY</strong> — Sua API Key do Cal.com</p>
            <p>✅ <strong>CALCOM_BOOKING_LINK</strong> — Link público de agendamento</p>
            <p>
              ℹ️ <strong>CALCOM_EVENT_TYPE_ID</strong> — <em>Opcional.</em> Detectado
              automaticamente via API.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Z-API WhatsApp dialog
// ---------------------------------------------------------------------------

function ZapiDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [clientToken, setClientToken] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: integration, isLoading } = useQuery({
    queryKey: ["integration", "zapi_whatsapp"],
    queryFn: async () => {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("provider", "zapi_whatsapp" as any)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (integration?.config && open) {
      const cfg = integration.config as any;
      setInstanceId(cfg.instance_id || "");
      setWhatsappNumber(cfg.whatsapp_number || "");
    }
  }, [integration, open]);

  const isConnected = integration?.status === "active";

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: companyMember } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", (await supabase.auth.getUser()).data.user?.id || "")
        .maybeSingle();
      if (!companyMember?.company_id) throw new Error("Empresa não encontrada");

      const existingCfg = (integration?.config as any) || {};
      const config = {
        instance_id: instanceId.trim() || existingCfg.instance_id,
        token: token.trim() || existingCfg.token,
        client_token: clientToken.trim() || existingCfg.client_token,
        whatsapp_number: whatsappNumber.trim() || existingCfg.whatsapp_number,
      };

      const { error } = await supabase.from("integrations").upsert(
        {
          company_id: companyMember.company_id,
          provider: "zapi_whatsapp" as any,
          config,
          api_token: config.instance_id,
          status: "active",
        },
        { onConflict: "company_id,provider" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration", "zapi_whatsapp"] });
      toast({ title: "Z-API WhatsApp", description: "Credenciais salvas com sucesso." });
      setToken("");
      setClientToken("");
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const existingCfg = (integration?.config as any) || {};
      const i = instanceId.trim() || existingCfg.instance_id;
      const t = token.trim() || existingCfg.token;
      const c = clientToken.trim() || existingCfg.client_token || "";
      if (!i || !t) throw new Error("Preencha Instance ID e Token");
      const { data, error } = await supabase.functions.invoke("zapi-test-connection", {
        body: { instance_id: i, token: t, client_token: c },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha na validação");
      return data;
    },
    onSuccess: (data) =>
      toast({
        title: "Conexão OK",
        description: data.connected
          ? "Instância Z-API conectada ao WhatsApp."
          : "Credenciais válidas, mas a instância ainda não está conectada (escaneie o QR Code no painel Z-API).",
      }),
    onError: (e: Error) =>
      toast({ title: "Falha no teste", description: e.message, variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!integration?.id) return;
      const { error } = await supabase
        .from("integrations")
        .update({ status: "inactive" })
        .eq("id", integration.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration", "zapi_whatsapp"] });
      toast({ title: "Desconectado", description: "Z-API WhatsApp desativada." });
    },
  });

  const copyUrl = () => {
    navigator.clipboard.writeText(ZAPI_WEBHOOK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>WhatsApp (Z-API)</DialogTitle>
          <DialogDescription>
            Envie e receba mensagens de WhatsApp via Z-API. Cada empresa usa sua própria
            instância conectada por QR Code.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="z-instance">Instance ID</Label>
              <Input
                id="z-instance"
                placeholder="3D..."
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="z-token">Instance Token</Label>
              <Input
                id="z-token"
                type="password"
                placeholder={
                  isConnected
                    ? "•••••••••• (deixe em branco para manter)"
                    : "Cole o token da instância"
                }
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="z-client-token">
                Client-Token{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="z-client-token"
                type="password"
                placeholder={
                  isConnected
                    ? "•••••••••• (deixe em branco para manter)"
                    : "Apenas se a conta tiver Token de Segurança ativado"
                }
                value={clientToken}
                onChange={(e) => setClientToken(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="z-number">Número WhatsApp conectado (E.164)</Label>
              <Input
                id="z-number"
                placeholder="+5511999999999"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                (!instanceId && !(integration?.config as any)?.instance_id) ||
                (!token && !isConnected)
              }
            >
              <Plug className="mr-2 h-4 w-4" />
              {saveMutation.isPending
                ? "Salvando..."
                : isConnected
                  ? "Atualizar"
                  : "Salvar e Conectar"}
            </Button>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || isLoading}
            >
              {testMutation.isPending ? "Testando..." : "Testar conexão"}
            </Button>
            {isConnected && (
              <Button
                variant="ghost"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Desconectar
              </Button>
            )}
          </div>

          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
            <p className="font-medium">📥 Webhook para mensagens recebidas</p>
            <p className="text-muted-foreground">
              No painel da Z-API, vá em <strong>Webhooks → Ao receber</strong> e cole este URL
              (método POST, formato JSON):
            </p>
            <div className="flex items-center gap-2 rounded bg-background px-2 py-1 font-mono text-[11px] break-all">
              <span className="flex-1">{ZAPI_WEBHOOK_URL}</span>
              <Button variant="ghost" size="sm" onClick={copyUrl} className="h-6 px-2">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </Button>
            </div>
            <p>
              <a
                href="https://app.z-api.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Abrir painel da Z-API <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Integrations() {
  const navigate = useNavigate();
  const { data: pipedrive } = useIntegration("pipedrive");
  const { data: gmail } = useGmailAccount();

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
  const gmailStatus: StatusKey = gmail ? "connected" : "disconnected";
  // Cal.com is configured via env vars; we can't detect from the client. Show pending.
  const calcomStatus: StatusKey = "pending";

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
      key: "gmail",
      name: "Gmail",
      category: "Email",
      description:
        "Envia emails das cadências e recebe respostas dos leads dentro de Conversations.",
      icon: Mail,
      iconTint: "text-[#EA4335]",
      status: gmailStatus,
      operationalLabel: gmail?.email,
      syncLabel: gmail?.last_synced_at ? relTime(gmail.last_synced_at) : null,
      onAction: () => navigate("/settings/gmail"),
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
      operationalLabel: "Config via variáveis de ambiente",
      readinessLabel: "Verifique CALCOM_API_KEY",
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
