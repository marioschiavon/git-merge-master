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

import { EnrichmentSettingsCard } from "@/components/EnrichmentSettingsCard";


const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const ZAPI_WEBHOOK_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/zapi-webhook`;

const otherIntegrations = [
  { name: "LinkedIn", description: "Conecte e envie mensagens no LinkedIn", connected: false },
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
const ZApiWhatsAppCard = () => {
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
      if (data?.config) {
        const cfg = data.config as any;
        setInstanceId(cfg.instance_id || "");
        setWhatsappNumber(cfg.whatsapp_number || "");
        // client_token e token nunca pré-preenchidos por segurança
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

      // Mantém os valores antigos caso o usuário não tenha digitado novamente
      const existingCfg = (integration?.config as any) || {};
      const config = {
        instance_id: instanceId.trim() || existingCfg.instance_id,
        token: token.trim() || existingCfg.token,
        client_token: clientToken.trim() || existingCfg.client_token,
        whatsapp_number: whatsappNumber.trim() || existingCfg.whatsapp_number,
      };

      const { error } = await supabase
        .from("integrations")
        .upsert(
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageCircle className="h-4 w-4" /> WhatsApp (Z-API)
          </CardTitle>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isLoading ? "Carregando..." : isConnected ? "Conectado" : "Não configurado"}
          </Badge>
        </div>
        <CardDescription>
          Envie e receba mensagens de WhatsApp via Z-API. Cada empresa usa sua própria
          instância conectada por QR Code.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3">
          <div>
            <Label htmlFor="z-instance">Instance ID</Label>
            <Input
              id="z-instance"
              placeholder="3D..."
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="z-token">Instance Token</Label>
            <Input
              id="z-token"
              type="password"
              placeholder={isConnected ? "•••••••••• (deixe em branco para manter)" : "Cole o token da instância"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="z-client-token">Client-Token <span className="text-muted-foreground font-normal">(opcional)</span></Label>
            <Input
              id="z-client-token"
              type="password"
              placeholder={isConnected ? "•••••••••• (deixe em branco para manter)" : "Apenas se a conta tiver Token de Segurança ativado"}
              value={clientToken}
              onChange={(e) => setClientToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              No painel Z-API: <strong>Minha Conta → Token de Segurança da Conta</strong>. Só é
              necessário se você ativou essa proteção.
            </p>
          </div>
          <div>
            <Label htmlFor="z-number">Número WhatsApp conectado (E.164)</Label>
            <Input
              id="z-number"
              placeholder="+5511999999999"
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending ||
              (!instanceId && !(integration?.config as any)?.instance_id) ||
              (!token && !isConnected)
            }
          >
            <Plug className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? "Salvando..." : isConnected ? "Atualizar" : "Salvar e Conectar"}
          </Button>
          <Button
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
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
          <p>
            No painel da Z-API, vá em <strong>Webhooks → Ao receber</strong> e cole este URL
            (método POST, formato JSON):
          </p>
          <div className="flex items-center gap-2 bg-background rounded px-2 py-1 font-mono text-[11px] break-all">
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

      {/* Z-API WhatsApp Card */}
      <ZApiWhatsAppCard />

      {/* Cal.com Card */}
      <CalComCard />

      {/* Enrichment Settings */}
      <EnrichmentSettingsCard />




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
