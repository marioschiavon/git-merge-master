import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, RefreshCw, Copy, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  useCalcomEventTypes, useSyncEventTypes, useUpdateEventType,
  useCalcomWebhookLog, useCompanyCalcomSettings, useUpdateCompanyCalcomSettings,
} from "@/hooks/useCalcom";

const PROJECT_REF = "pqrslnydcrpjelpzdnyp";
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/calcom-webhook`;

export default function CalcomSettings() {
  const { data: eventTypes, isLoading: loadingTypes } = useCalcomEventTypes();
  const sync = useSyncEventTypes();
  const update = useUpdateEventType();
  const { data: webhookLog, isLoading: loadingLog } = useCalcomWebhookLog();
  const { data: settings } = useCompanyCalcomSettings();
  const saveSettings = useUpdateCompanyCalcomSettings();
  const [teamId, setTeamId] = useState<string>("");
  const [defaultEt, setDefaultEt] = useState<string>("");

  const copyWebhook = () => {
    navigator.clipboard.writeText(WEBHOOK_URL);
    toast.success("URL copiada");
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Cal.com</h1>
        <p className="text-muted-foreground">Configure tipos de evento, webhooks e round-robin</p>
      </div>

      <Tabs defaultValue="event-types">
        <TabsList>
          <TabsTrigger value="event-types">Tipos de evento</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="team">Team & Round-Robin</TabsTrigger>
        </TabsList>

        <TabsContent value="event-types" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Tipos sincronizados</CardTitle>
                <CardDescription>{eventTypes?.length || 0} tipos disponíveis</CardDescription>
              </div>
              <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
                {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Sincronizar
              </Button>
            </CardHeader>
            <CardContent>
              {loadingTypes ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : !eventTypes?.length ? (
                <p className="text-sm text-muted-foreground">Nenhum tipo sincronizado. Clique em "Sincronizar".</p>
              ) : (
                <div className="space-y-2">
                  {eventTypes.map((et: any) => (
                    <div key={et.id} className="flex items-center justify-between border rounded-lg p-3">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {et.title}
                          <Badge variant="outline">{et.length_minutes || "?"} min</Badge>
                          {et.team_id && <Badge variant="secondary">Team</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">ID: {et.calcom_id} {et.slug && `• /${et.slug}`}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs">Ativo</Label>
                        <Switch
                          checked={et.active}
                          onCheckedChange={(checked) => update.mutate({ id: et.id, active: checked })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>URL do webhook</CardTitle>
              <CardDescription>Cole esta URL no painel do Cal.com em Settings → Developer → Webhooks. Selecione os eventos: BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED, BOOKING_NO_SHOW_UPDATED, MEETING_ENDED.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Input readOnly value={WEBHOOK_URL} />
                <Button variant="outline" size="icon" onClick={copyWebhook}><Copy className="h-4 w-4" /></Button>
              </div>
              <p className="text-xs text-muted-foreground">
                O secret de validação HMAC já está salvo (<code>CALCOM_WEBHOOK_SECRET</code>). Use o mesmo valor no painel do Cal.com.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Últimos webhooks recebidos</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingLog ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : !webhookLog?.length ? (
                <p className="text-sm text-muted-foreground">Nenhum webhook recebido ainda.</p>
              ) : (
                <div className="space-y-1 max-h-96 overflow-auto">
                  {webhookLog.map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between text-sm border-b py-2">
                      <div className="flex items-center gap-2">
                        {l.processed ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : l.error ? <XCircle className="h-4 w-4 text-red-600" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                        <span className="font-mono text-xs">{l.event_type}</span>
                        {l.booking_uid && <span className="text-xs text-muted-foreground">{l.booking_uid.slice(0, 12)}…</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString("pt-BR")}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Round-Robin</CardTitle>
              <CardDescription>Distribuição automática entre membros do team (exige plano Team do Cal.com)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Habilitar round-robin</Label>
                <Switch
                  checked={settings?.calcom_round_robin_enabled || false}
                  onCheckedChange={(checked) => saveSettings.mutate({ calcom_round_robin_enabled: checked })}
                />
              </div>
              <div className="space-y-2">
                <Label>Team ID do Cal.com</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder={settings?.calcom_team_id?.toString() || "Ex: 12345"}
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                  />
                  <Button onClick={() => saveSettings.mutate({ calcom_team_id: teamId ? Number(teamId) : null })}>Salvar</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Event Type padrão (ID Cal.com)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder={settings?.calcom_default_event_type_id?.toString() || "Ex: 1234"}
                    value={defaultEt}
                    onChange={(e) => setDefaultEt(e.target.value)}
                  />
                  <Button onClick={() => saveSettings.mutate({ calcom_default_event_type_id: defaultEt ? Number(defaultEt) : null })}>Salvar</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
