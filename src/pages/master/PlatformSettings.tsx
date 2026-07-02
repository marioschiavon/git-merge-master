import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Shield, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export default function PlatformSettings() {
  const qc = useQueryClient();
  const [apifyEnabled, setApifyEnabled] = useState(false);

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
      return data as { apify: { token_configured: boolean } };
    },
  });

  useEffect(() => {
    if (settings) setApifyEnabled(!!settings.apify_enabled);
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("platform_settings")
        .update({ apify_enabled: apifyEnabled })
        .eq("singleton", true);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Configurações da plataforma salvas" });
      qc.invalidateQueries({ queryKey: ["platform_settings"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

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
            Motor global usado pelo enriquecimento de leads (Instagram, Facebook, LinkedIn). O token fica salvo como segredo da plataforma — nenhuma empresa vê ou configura.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between border rounded-md p-3">
            <div>
              <Label className="font-medium">Habilitar Apify globalmente</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Quando desativado, as empresas não conseguem usar scraping via Apify mesmo que tenham marcado a opção.
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
              Peça ao ambiente Lovable para adicionar/atualizar esse segredo antes de habilitar o recurso.
            </div>
          )}

          <div className="pt-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}>
              {save.isPending ? "Salvando..." : "Salvar configurações"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
