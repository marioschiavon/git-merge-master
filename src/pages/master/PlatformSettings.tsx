import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Shield, AlertCircle, CheckCircle2, ExternalLink, RotateCcw, Smartphone, Copy, Loader2, Mail, Mic } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type ActorCfg = { actor_id: string; enabled: boolean };
type ActorsMap = Record<"instagram" | "facebook" | "linkedin_person" | "linkedin_company", ActorCfg>;

const DEFAULT_ACTORS: ActorsMap = {
  instagram:        { actor_id: "apify/instagram-scraper",             enabled: true },
  facebook:         { actor_id: "apify/facebook-pages-scraper",        enabled: true },
  linkedin_person:  { actor_id: "harvestapi/linkedin-profile-scraper", enabled: true },
  linkedin_company: { actor_id: "apimaestro/linkedin-company",         enabled: true },
};

const ACTOR_ROWS: { key: keyof ActorsMap; label: string }[] = [
  { key: "instagram",        label: "Instagram" },
  { key: "facebook",         label: "Facebook" },
  { key: "linkedin_person",  label: "LinkedIn (pessoa)" },
  { key: "linkedin_company", label: "LinkedIn (empresa)" },
];

export default function PlatformSettings() {
  const qc = useQueryClient();
  const [apifyEnabled, setApifyEnabled] = useState(false);
  const [actors, setActors] = useState<ActorsMap>(DEFAULT_ACTORS);

  const { data: settings, isLoading } = useQuery({
    queryKey: ["platform_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("*")
        .eq("singleton", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: status } = useQuery({
    queryKey: ["platform_settings_status"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("platform-settings-status");
      if (error) throw error;
      return data as {
        apify: { token_configured: boolean };
        resend: {
          key_configured: boolean;
          key_source: "db" | "connector" | "none";
          db_key_configured: boolean;
          connector_key_configured: boolean;
          passphrase_configured: boolean;
          connected_at: string | null;
          lovable_api_key_configured: boolean;
        };
        hook7: {
          apikey_configured: boolean;
          webhook_configured: boolean;
          passphrase_configured: boolean;
          base_url: string;
          webhook_url_masked: string | null;
        };
        elevenlabs: {
          key_configured: boolean;
          connected_at: string | null;
          model: string;
          passphrase_configured: boolean;
        };
      };
    },
  });


  useEffect(() => {
    if (settings) {
      setApifyEnabled(!!settings.apify_enabled);
      setActors({ ...DEFAULT_ACTORS, ...((settings as any).apify_actors || {}) });
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_settings")
        .update({ apify_enabled: apifyEnabled, apify_actors: actors as any })
        .eq("singleton", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Configurações da plataforma salvas" });
      qc.invalidateQueries({ queryKey: ["platform_settings"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const updateActor = (k: keyof ActorsMap, patch: Partial<ActorCfg>) =>
    setActors((s) => ({ ...s, [k]: { ...s[k], ...patch } }));

  const tokenConfigured = !!status?.apify.token_configured;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Integrações da Plataforma</h1>
          <p className="text-sm text-muted-foreground">
            Recursos globais gerenciados pelo master admin. Todas as empresas podem consumir esses serviços sem configurar credenciais próprias.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Apify — Scraping de redes sociais
            </CardTitle>
            <Badge variant={tokenConfigured ? "default" : "secondary"}>
              {tokenConfigured ? (
                <><CheckCircle2 className="h-3 w-3 mr-1" /> Token configurado</>
              ) : (
                <><AlertCircle className="h-3 w-3 mr-1" /> Token ausente</>
              )}
            </Badge>
          </div>
          <CardDescription>
            Motor global usado pelo enriquecimento de leads. O token fica salvo como segredo da plataforma — nenhuma empresa vê ou configura.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between border rounded-md p-3">
            <div>
              <Label className="font-medium">Habilitar Apify globalmente</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Quando desativado, nenhuma empresa consegue usar scraping via Apify.
              </p>
            </div>
            <Switch
              checked={apifyEnabled}
              onCheckedChange={setApifyEnabled}
              disabled={isLoading}
            />
          </div>

          {!tokenConfigured && (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
              O secret <code className="text-xs bg-background px-1 py-0.5 rounded">APIFY_API_TOKEN</code> não está configurado.
              Configure-o antes de habilitar o recurso.
            </div>
          )}

          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Actors por rede</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Escolha qual actor do Apify roda em cada rede. Formato: <code>owner/actor-name</code>.
                </p>
              </div>
              <a
                href="https://apify.com/store"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                Apify Store <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="space-y-2">
              {ACTOR_ROWS.map(({ key, label }) => {
                const cfg = actors[key];
                const isDefault = cfg.actor_id === DEFAULT_ACTORS[key].actor_id;
                return (
                  <div key={key} className="flex items-center gap-2 border rounded-md p-3">
                    <Switch
                      checked={cfg.enabled}
                      onCheckedChange={(v) => updateActor(key, { enabled: v })}
                    />
                    <div className="w-40 shrink-0">
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-[10px] text-muted-foreground">
                        default: {DEFAULT_ACTORS[key].actor_id}
                      </div>
                    </div>
                    <Input
                      value={cfg.actor_id}
                      onChange={(e) => updateActor(key, { actor_id: e.target.value })}
                      placeholder="owner/actor-name"
                      className="h-8 font-mono text-xs"
                      disabled={!cfg.enabled}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => updateActor(key, { actor_id: DEFAULT_ACTORS[key].actor_id })}
                      disabled={isDefault}
                      title="Restaurar padrão"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}>
              {save.isPending ? "Salvando..." : "Salvar configurações"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ResendCard status={status?.resend} />

      <ElevenLabsCard status={status?.elevenlabs} />

      <Hook7Card
        status={status?.hook7}
        currentBaseUrl={(settings as any)?.hook7_base_url ?? null}
      />
    </div>
  );

}

// ---------------------------------------------------------------------------
// Resend (Email) — chave master gerenciada 100% pela UI
// ---------------------------------------------------------------------------

function ResendCard({
  status,
}: {
  status?: {
    key_configured: boolean;
    key_source: "db" | "connector" | "none";
    db_key_configured: boolean;
    connector_key_configured: boolean;
    passphrase_configured: boolean;
    connected_at: string | null;
    lovable_api_key_configured: boolean;
  };
}) {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const keyOk = !!status?.key_configured;
  const dbOk = !!status?.db_key_configured;
  const connectorOk = !!status?.connector_key_configured;
  const passOk = !!status?.passphrase_configured;
  const lovableOk = !!status?.lovable_api_key_configured;
  const allOk = keyOk && lovableOk && passOk;

  const source = status?.key_source ?? "none";
  const sourceLabel =
    source === "db" ? "Banco (UI)" : source === "connector" ? "Connector (legado)" : "Não configurada";

  const saveKey = useMutation({
    mutationFn: async () => {
      const clean = apiKey.trim();
      if (clean.length < 8) throw new Error("Chave muito curta");
      const { data, error } = await supabase.functions.invoke("resend-master-set", {
        body: { api_key: clean },
      });
      if (error) throw error;
      return data as { ok: boolean; domain_count?: number; message: string };
    },
    onSuccess: (r) => {
      toast({
        title: r.ok ? "Chave salva" : "Falha ao salvar",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      });
      if (r.ok) {
        setApiKey("");
        qc.invalidateQueries({ queryKey: ["platform_settings_status"] });
      }
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const testConn = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("resend-master-test");
      if (error) throw error;
      return data as { ok: boolean; configured: boolean; status?: number; domain_count?: number; message: string };
    },
    onSuccess: (r) =>
      toast({
        title: r.ok ? "Conexão OK" : "Falha na conexão",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      }),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const clearKey = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("resend-master-clear");
      if (error) throw error;
      return data as { ok: boolean; message: string };
    },
    onSuccess: () => {
      toast({ title: "Chave removida" });
      setConfirmClear(false);
      qc.invalidateQueries({ queryKey: ["platform_settings_status"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" /> Email · Resend (master)
          </CardTitle>
          <Badge variant={allOk ? "default" : "secondary"}>
            {allOk ? (
              <><CheckCircle2 className="h-3 w-3 mr-1" /> Pronto</>
            ) : (
              <><AlertCircle className="h-3 w-3 mr-1" /> Config pendente</>
            )}
          </Badge>
        </div>
        <CardDescription>
          Conta Resend master de produção — os domínios de todas as empresas são cadastrados e
          verificados aqui. A chave fica criptografada no banco e é gerenciada 100% por esta tela.
          Após salvar, a chave nunca mais é exibida; para trocar, cole a nova e salve por cima.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <StatusPill
            label={`Chave Resend · ${sourceLabel}`}
            ok={keyOk}
            envName={dbOk ? "platform_settings.resend_api_key_encrypted" : "RESEND_API_KEY"}
          />
          <StatusPill label="Passphrase (cripto)" ok={passOk} envName="RESEND_KEY_PASSPHRASE" />
          <StatusPill label="Lovable API Key" ok={lovableOk} envName="LOVABLE_API_KEY" />
        </div>

        {status?.connected_at && (
          <p className="text-[11px] text-muted-foreground">
            Última atualização da chave: {new Date(status.connected_at).toLocaleString("pt-BR")}
          </p>
        )}

        {connectorOk && !dbOk && (
          <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs">
            Existe uma chave legada vinda do connector do workspace. Cole a chave master abaixo
            para migrar tudo para o gerenciamento pela UI.
          </div>
        )}

        <div className="space-y-2 border rounded-md p-3">
          <Label htmlFor="resend-api-key" className="text-sm font-medium">
            {dbOk ? "Substituir chave Resend" : "Nova chave Resend"}
          </Label>
          <div className="flex gap-2">
            <Input
              id="resend-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="re_..."
              className="font-mono text-xs"
              disabled={!passOk}
            />
            <Button
              onClick={() => saveKey.mutate()}
              disabled={saveKey.isPending || !passOk || apiKey.trim().length < 8}
            >
              {saveKey.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Salvando…</>
              ) : (
                <>Salvar chave</>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Crie uma chave <strong>Full access</strong> em <code>resend.com/api-keys</code> e cole aqui.
            Antes de salvar, ela é validada em <code>api.resend.com/domains</code>. Se rejeitada, nada é gravado.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => testConn.mutate()}
            disabled={testConn.isPending || !keyOk || !lovableOk}
            variant="outline"
          >
            {testConn.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Testando…</>
            ) : (
              <>Testar conexão</>
            )}
          </Button>
          {dbOk && !confirmClear && (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>
              Remover chave
            </Button>
          )}
          {dbOk && confirmClear && (
            <>
              <Button
                variant="destructive"
                onClick={() => clearKey.mutate()}
                disabled={clearKey.isPending}
              >
                {clearKey.isPending ? "Removendo…" : "Confirmar remoção"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancelar
              </Button>
            </>
          )}
          <a
            href="https://resend.com/domains"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline self-center"
          >
            resend.com/domains <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// Hook7 (WhatsApp) — configuração da plataforma
// ---------------------------------------------------------------------------

function Hook7Card({
  status,
  currentBaseUrl,
}: {
  status?: {
    apikey_configured: boolean;
    webhook_configured: boolean;
    passphrase_configured: boolean;
    base_url: string;
    webhook_url_masked: string | null;
  };
  currentBaseUrl: string | null;
}) {
  const qc = useQueryClient();
  const [baseUrl, setBaseUrl] = useState<string>("");

  useEffect(() => {
    setBaseUrl(currentBaseUrl ?? status?.base_url ?? "https://api.hook7.com.br");
  }, [currentBaseUrl, status?.base_url]);

  const apikeyOk = !!status?.apikey_configured;
  const webhookOk = !!status?.webhook_configured;
  const passphraseOk = !!status?.passphrase_configured;
  const allConfigured = apikeyOk && webhookOk && passphraseOk;

  const saveBaseUrl = useMutation({
    mutationFn: async () => {
      const clean = baseUrl.trim().replace(/\/+$/, "");
      if (!clean || !/^https?:\/\//i.test(clean)) {
        throw new Error("Informe uma URL válida (https://…)");
      }
      const { error } = await supabase
        .from("platform_settings")
        .update({ hook7_base_url: clean } as any)
        .eq("singleton", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "URL base do Hook7 atualizada" });
      qc.invalidateQueries({ queryKey: ["platform_settings"] });
      qc.invalidateQueries({ queryKey: ["platform_settings_status"] });
    },
    onError: (e: any) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const testConn = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("hook7-test-connection");
      if (error) throw error;
      return data as { ok: boolean; message: string };
    },
    onSuccess: (r) =>
      toast({
        title: r.ok ? "Conexão OK" : "Falha na conexão",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      }),
    onError: (e: any) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-[#25D366]" /> WhatsApp · Hook7
          </CardTitle>
          <Badge variant={allConfigured ? "default" : "secondary"}>
            {allConfigured ? (
              <><CheckCircle2 className="h-3 w-3 mr-1" /> Pronto</>
            ) : (
              <><AlertCircle className="h-3 w-3 mr-1" /> Config pendente</>
            )}
          </Badge>
        </div>
        <CardDescription>
          Infraestrutura WhatsApp usada por todas as empresas. A chave global e a
          passphrase de criptografia ficam como segredos da plataforma —
          nenhuma empresa vê ou altera esses valores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <StatusPill label="Chave global" ok={apikeyOk} envName="HOOK7_GLOBAL_APIKEY" />
          <StatusPill label="Passphrase (cripto)" ok={passphraseOk} envName="HOOK7_INSTANCE_TOKEN_PASSPHRASE" />
          <StatusPill label="Webhook secret" ok={webhookOk} envName="HOOK7_WEBHOOK_SECRET" />
        </div>

        <div className="space-y-2 border rounded-md p-3">
          <Label htmlFor="hook7-base-url" className="text-sm font-medium">
            URL base do Hook7
          </Label>
          <div className="flex gap-2">
            <Input
              id="hook7-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.hook7.com.br"
              className="font-mono text-xs"
            />
            <Button
              onClick={() => saveBaseUrl.mutate()}
              disabled={saveBaseUrl.isPending}
              variant="outline"
            >
              Salvar URL
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Não é segredo; pode ser alterada pela UI. Só o master admin vê este
            campo.
          </p>
        </div>

        {status?.webhook_url_masked && (
          <div className="space-y-2 border rounded-md p-3">
            <Label className="text-sm font-medium">URL do webhook (mascarada)</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] bg-muted rounded px-2 py-1 truncate">
                {status.webhook_url_masked}
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(status.webhook_url_masked ?? "");
                  toast({ title: "Copiado" });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              O secret real nunca aparece na UI. O Hook7 é registrado
              automaticamente pelo servidor ao conectar cada instância.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={() => testConn.mutate()}
            disabled={testConn.isPending || !apikeyOk}
            variant="outline"
          >
            {testConn.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Testando…</>
            ) : (
              <>Testar conexão</>
            )}
          </Button>
          <a
            href="https://hook7.com.br"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline self-center"
          >
            hook7.com.br <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({
  label,
  ok,
  envName,
}: {
  label: string;
  ok: boolean;
  envName: string;
}) {
  return (
    <div className="border rounded-md p-2">
      <div className="flex items-center gap-2 text-sm">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <AlertCircle className="h-4 w-4 text-destructive" />
        )}
        <span className="font-medium">{label}</span>
      </div>
      <div className="text-[10px] font-mono text-muted-foreground mt-1 truncate">
        {envName}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ElevenLabs (Speech-to-Text) — chave master gerenciada 100% pela UI
// ---------------------------------------------------------------------------

function ElevenLabsCard({
  status,
}: {
  status?: {
    key_configured: boolean;
    connected_at: string | null;
    model: string;
    passphrase_configured: boolean;
  };
}) {
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<string>(status?.model || "scribe_v2");
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (status?.model) setModel(status.model);
  }, [status?.model]);

  const keyOk = !!status?.key_configured;
  const passOk = !!status?.passphrase_configured;
  const allOk = keyOk && passOk;

  const saveKey = useMutation({
    mutationFn: async () => {
      const clean = apiKey.trim();
      if (clean.length < 8) throw new Error("Chave muito curta");
      const { data, error } = await supabase.functions.invoke("elevenlabs-master-set", {
        body: { api_key: clean, model },
      });
      if (error) throw error;
      return data as { ok: boolean; tier?: string | null; message: string };
    },
    onSuccess: (r) => {
      toast({
        title: r.ok ? "Chave salva" : "Falha ao salvar",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      });
      if (r.ok) {
        setApiKey("");
        qc.invalidateQueries({ queryKey: ["platform_settings_status"] });
      }
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const testConn = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("elevenlabs-master-test");
      if (error) throw error;
      return data as { ok: boolean; configured: boolean; status?: number; tier?: string | null; message: string };
    },
    onSuccess: (r) =>
      toast({
        title: r.ok ? "Conexão OK" : "Falha na conexão",
        description: r.message,
        variant: r.ok ? "default" : "destructive",
      }),
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const clearKey = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("elevenlabs-master-clear");
      if (error) throw error;
      return data as { ok: boolean; message: string };
    },
    onSuccess: () => {
      toast({ title: "Chave removida" });
      setConfirmClear(false);
      qc.invalidateQueries({ queryKey: ["platform_settings_status"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" /> Áudio · ElevenLabs (master)
          </CardTitle>
          <Badge variant={allOk ? "default" : "secondary"}>
            {allOk ? (
              <><CheckCircle2 className="h-3 w-3 mr-1" /> Pronto</>
            ) : (
              <><AlertCircle className="h-3 w-3 mr-1" /> Config pendente</>
            )}
          </Badge>
        </div>
        <CardDescription>
          Chave usada por todas as empresas para transcrever áudios recebidos no WhatsApp.
          Fica criptografada no banco e é gerenciada 100% por esta tela. Após salvar, a chave
          nunca mais é exibida; para trocar, cole a nova e salve por cima. Se a chave não
          estiver configurada, a plataforma usa o fluxo antigo (Gemini) como fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <StatusPill
            label="Chave ElevenLabs"
            ok={keyOk}
            envName="platform_settings.elevenlabs_api_key_encrypted"
          />
          <StatusPill label="Passphrase (cripto)" ok={passOk} envName="RESEND_KEY_PASSPHRASE" />
        </div>

        {status?.connected_at && (
          <p className="text-[11px] text-muted-foreground">
            Última atualização da chave: {new Date(status.connected_at).toLocaleString("pt-BR")}
          </p>
        )}

        <div className="space-y-2 border rounded-md p-3">
          <Label className="text-sm font-medium">Modelo de transcrição</Label>
          <div className="flex gap-2 flex-wrap">
            {[
              { id: "scribe_v2", label: "scribe_v2 (padrão · batch)" },
              { id: "scribe_v2_realtime", label: "scribe_v2_realtime (streaming)" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m.id)}
                className={
                  "px-3 py-1.5 rounded-md text-xs border transition-colors " +
                  (model === m.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted border-input")
                }
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            O modelo é salvo junto com a chave. O webhook do WhatsApp usa transcrição em batch;
            deixe em <code>scribe_v2</code>.
          </p>
        </div>

        <div className="space-y-2 border rounded-md p-3">
          <Label htmlFor="elevenlabs-api-key" className="text-sm font-medium">
            {keyOk ? "Substituir chave ElevenLabs" : "Nova chave ElevenLabs"}
          </Label>
          <div className="flex gap-2">
            <Input
              id="elevenlabs-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_..."
              className="font-mono text-xs"
              disabled={!passOk}
            />
            <Button
              onClick={() => saveKey.mutate()}
              disabled={saveKey.isPending || !passOk || apiKey.trim().length < 8}
            >
              {saveKey.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Salvando…</>
              ) : (
                <>Salvar chave</>
              )}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Crie uma chave em <code>elevenlabs.io/app/settings/api-keys</code> com permissão de
            <strong> Speech to Text</strong> e cole aqui. Antes de salvar, a chave é validada no
            endpoint real de transcrição, sem exigir permissões de modelos ou usuário.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => testConn.mutate()}
            disabled={testConn.isPending || !keyOk}
            variant="outline"
          >
            {testConn.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Testando…</>
            ) : (
              <>Testar conexão</>
            )}
          </Button>
          {keyOk && !confirmClear && (
            <Button variant="ghost" onClick={() => setConfirmClear(true)}>
              Remover chave
            </Button>
          )}
          {keyOk && confirmClear && (
            <>
              <Button
                variant="destructive"
                onClick={() => clearKey.mutate()}
                disabled={clearKey.isPending}
              >
                {clearKey.isPending ? "Removendo…" : "Confirmar remoção"}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancelar
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

