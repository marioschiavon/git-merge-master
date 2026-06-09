import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useIntegration, useConnectPipedrive, useDisconnectPipedrive, useSyncLeads } from "@/hooks/usePipedrive";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { RefreshCw, Plug, Unplug, ExternalLink, Mail, MessageCircle, Copy, Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const TWILIO_WEBHOOK_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/twilio-whatsapp-webhook`;

const otherIntegrations = [
  { name: "LinkedIn", description: "Conecte e envie mensagens no LinkedIn", connected: false },
  { name: "Twilio (Ligações)", description: "Faça e receba ligações VoIP", connected: false },
];


const GmailCard = () => {
  const queryClient = useQueryClient();
  const { data: account, isLoading } = useQuery({
    queryKey: ["gmail_account"],
    queryFn: async () => {
      const { data } = await supabase.from("gmail_account").select("*").eq("is_active", true).maybeSingle();
      return data;
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("gmail-sync-inbox", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["gmail_account"] });
      const msg = data?.bootstrapped
        ? `Conta ${data.email} conectada.`
        : `${data?.processed || 0} respostas processadas (${data?.matched || 0} casadas com leads).`;
      toast({ title: "Sincronização Gmail", description: msg });
    },
    onError: (e: Error) => toast({ title: "Erro no Gmail", description: e.message, variant: "destructive" }),
  });

  const isConnected = !!account;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4" /> Gmail (envio + recebimento)
          </CardTitle>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isLoading ? "Carregando..." : isConnected ? "Conectado" : "Não inicializado"}
          </Badge>
        </div>
        <CardDescription>
          Envia emails das cadências e recebe respostas dos leads dentro de Conversations.
          {isConnected && (
            <span className="block mt-1 text-xs">
              Conta: <strong>{account!.email}</strong>
              {account!.last_synced_at && ` · última sync: ${new Date(account!.last_synced_at).toLocaleString("pt-BR")}`}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isConnected && (
          <p className="text-xs text-muted-foreground">
            Clique em "Inicializar / Sincronizar" para registrar a conta Gmail conectada ao workspace.
          </p>
        )}
        <Button
          variant="outline"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          {syncMutation.isPending ? "Sincronizando..." : isConnected ? "Sincronizar agora" : "Inicializar / Sincronizar"}
        </Button>
      </CardContent>
    </Card>
  );
};


const CalComCard = () => {
  const [configured, setConfigured] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Cal.com</CardTitle>
          <Badge variant={configured ? "default" : "secondary"}>
            {configured ? "Configurado" : "Pendente"}
          </Badge>
        </div>
        <CardDescription>
          Agendamento inteligente — reserva 2 slots automaticamente e oferece ao prospect
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          As credenciais do Cal.com são configuradas como variáveis de ambiente no backend. 
          Você precisa de: <strong>API Key</strong>, <strong>Event Type ID</strong> e <strong>Link de agendamento</strong>.
        </p>
        <p className="text-xs text-muted-foreground">
          <a
            href="https://app.cal.com/settings/developer/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Onde encontrar minha API Key? <ExternalLink className="h-3 w-3" />
          </a>
        </p>
        <div className="bg-muted rounded p-3 text-xs space-y-1">
          <p>✅ <strong>CALCOM_API_KEY</strong> — Sua API Key do Cal.com</p>
          <p>✅ <strong>CALCOM_BOOKING_LINK</strong> — Link público de agendamento</p>
          <p>ℹ️ <strong>CALCOM_EVENT_TYPE_ID</strong> — <em>Opcional.</em> Detectado automaticamente via API. Configure apenas para forçar um tipo específico.</p>
        </div>
      </CardContent>
    </Card>
  );
};
const TwilioWhatsAppCard = () => {
  const queryClient = useQueryClient();
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("+14155238886");
  const [isSandbox, setIsSandbox] = useState(true);
  const [copied, setCopied] = useState(false);

  const { data: integration, isLoading } = useQuery({
    queryKey: ["integration", "twilio_whatsapp"],
    queryFn: async () => {
      const { data } = await supabase
        .from("integrations")
        .select("*")
        .eq("provider", "twilio_whatsapp" as any)
        .maybeSingle();
      if (data?.config) {
        const cfg = data.config as any;
        setAccountSid(cfg.account_sid || "");
        setWhatsappNumber(cfg.whatsapp_number || "+14155238886");
        setIsSandbox(!!cfg.is_sandbox);
      }
      return data;
    },
  });

  const isConnected = integration?.status === "active";

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { data: companyMember } = await supabase
        .from("company_members")
        .select("company_id")
        .eq("user_id", (await supabase.auth.getUser()).data.user?.id || "")
        .maybeSingle();
      if (!companyMember?.company_id) throw new Error("Empresa não encontrada");

      const config = {
        account_sid: accountSid.trim(),
        auth_token: authToken.trim(),
        whatsapp_number: whatsappNumber.trim(),
        is_sandbox: isSandbox,
      };

      const { error } = await supabase
        .from("integrations")
        .upsert(
          {
            company_id: companyMember.company_id,
            provider: "twilio_whatsapp" as any,
            config,
            api_token: accountSid.trim(),
            status: "active",
          },
          { onConflict: "company_id,provider" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integration", "twilio_whatsapp"] });
      toast({ title: "Twilio WhatsApp", description: "Credenciais salvas com sucesso." });
      setAuthToken("");
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!accountSid || !authToken) throw new Error("Preencha Account SID e Auth Token");
      const { data, error } = await supabase.functions.invoke("twilio-test-connection", {
        body: { account_sid: accountSid.trim(), auth_token: authToken.trim() },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Falha na validação");
      return data;
    },
    onSuccess: (data) =>
      toast({
        title: "Conexão OK",
        description: `Conta Twilio validada: ${data.friendly_name || ""}`,
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
      queryClient.invalidateQueries({ queryKey: ["integration", "twilio_whatsapp"] });
      toast({ title: "Desconectado", description: "Twilio WhatsApp desativado." });
    },
  });

  const copyUrl = () => {
    navigator.clipboard.writeText(TWILIO_WEBHOOK_URL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> WhatsApp (Twilio)
          </CardTitle>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isLoading ? "Carregando..." : isConnected ? "Conectado" : "Não configurado"}
          </Badge>
        </div>
        <CardDescription>
          Envie e receba mensagens de WhatsApp das cadências. Cada empresa usa suas próprias
          credenciais Twilio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3">
          <div>
            <Label htmlFor="tw-sid">Account SID</Label>
            <Input
              id="tw-sid"
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="tw-token">Auth Token</Label>
            <Input
              id="tw-token"
              type="password"
              placeholder={isConnected ? "•••••••••• (deixe em branco para manter)" : "Cole o Auth Token"}
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="tw-number">Número WhatsApp (E.164)</Label>
            <Input
              id="tw-number"
              placeholder="+14155238886"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="tw-sandbox" checked={isSandbox} onCheckedChange={setIsSandbox} />
            <Label htmlFor="tw-sandbox" className="text-sm">
              Sandbox Twilio (número compartilhado para testes)
            </Label>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!accountSid || (!authToken && !isConnected) || !whatsappNumber || saveMutation.isPending}
          >
            <Plug className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Salvando..." : isConnected ? "Atualizar" : "Salvar e Conectar"}
          </Button>
          <Button
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={!accountSid || !authToken || testMutation.isPending}
          >
            {testMutation.isPending ? "Testando..." : "Testar conexão"}
          </Button>
          {isConnected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              <Unplug className="mr-2 h-4 w-4" />
              Desconectar
            </Button>
          )}
        </div>

        <div className="bg-muted rounded p-3 text-xs space-y-2">
          <p className="font-medium">📥 Webhook para mensagens recebidas</p>
          <p>No console Twilio, configure este URL em <strong>Messaging → Settings → WhatsApp Sandbox</strong> (campo "When a message comes in"):</p>
          <div className="flex items-center gap-2 bg-background rounded px-2 py-1 font-mono text-[11px] break-all">
            <span className="flex-1">{TWILIO_WEBHOOK_URL}</span>
            <Button variant="ghost" size="sm" onClick={copyUrl} className="h-6 px-2">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
          {isSandbox && (
            <p className="text-amber-600 dark:text-amber-400">
              ⚠️ Sandbox: cada lead precisa enviar <code>join &lt;código&gt;</code> para <strong>+1 415 523 8886</strong> antes
              de receber mensagens. Em produção, contrate um número dedicado.
            </p>
          )}
          <p>
            <a
              href="https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Abrir console do WhatsApp Sandbox <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
      </CardContent>
    </Card>
  );
};


export default function Integrations() {
  const [apiToken, setApiToken] = useState("");
  const { data: integration, isLoading } = useIntegration("pipedrive");
  const connectMutation = useConnectPipedrive();
  const disconnectMutation = useDisconnectPipedrive();
  const syncMutation = useSyncLeads();

  const isConnected = integration?.status === "active";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Integrações</h1>
        <p className="text-muted-foreground">Conecte suas ferramentas para automação completa</p>
      </div>

      {/* Pipedrive Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Pipedrive</CardTitle>
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isLoading ? "Carregando..." : isConnected ? "Conectado" : "Desconectado"}
            </Badge>
          </div>
          <CardDescription>
            Importe leads e sincronize atividades do Pipedrive
            {isConnected && integration?.last_synced_at && (
              <span className="block mt-1 text-xs">
                Última sincronização: {new Date(integration.last_synced_at).toLocaleString("pt-BR")}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isConnected ? (
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Cole seu API Token do Pipedrive"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                className="flex-1"
              />
              <Button
                onClick={() => connectMutation.mutate(apiToken)}
                disabled={!apiToken || connectMutation.isPending}
              >
                <Plug className="mr-2 h-4 w-4" />
                {connectMutation.isPending ? "Conectando..." : "Conectar"}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
                {syncMutation.isPending ? "Sincronizando..." : "Sincronizar Agora"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <Unplug className="mr-2 h-4 w-4" />
                Desconectar
              </Button>
            </div>
          )}
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
        </CardContent>
      </Card>

      {/* Gmail Card */}
      <GmailCard />

      {/* Twilio WhatsApp Card */}
      <TwilioWhatsAppCard />

      {/* Cal.com Card */}
      <CalComCard />


      {/* Other integrations */}
      <div className="grid gap-4 md:grid-cols-2">
        {otherIntegrations.map((i) => (
          <Card key={i.name}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{i.name}</CardTitle>
                <Badge variant="secondary">Em breve</Badge>
              </div>
              <CardDescription>{i.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" disabled>
                Conectar
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
