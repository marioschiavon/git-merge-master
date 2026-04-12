import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useIntegration, useConnectPipedrive, useDisconnectPipedrive, useSyncLeads } from "@/hooks/usePipedrive";
import { RefreshCw, Plug, Unplug, ExternalLink } from "lucide-react";

const otherIntegrations = [
  { name: "WhatsApp Business", description: "Envie mensagens via WhatsApp", connected: false },
  { name: "LinkedIn", description: "Conecte e envie mensagens no LinkedIn", connected: false },
  { name: "Email (SMTP)", description: "Configure o envio de emails", connected: false },
  { name: "Twilio (Ligações)", description: "Faça e receba ligações VoIP", connected: false },
];

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
