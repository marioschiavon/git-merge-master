import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useCadences } from "@/hooks/useCadences";

type Settings = {
  website_analysis?: boolean;
  discover_socials?: boolean;
  apify_scrape?: boolean;
  generate_message?: boolean;
  default_cadence_id?: string | null;
  apify_actors?: { instagram?: boolean; facebook?: boolean; linkedin_person?: boolean; linkedin_company?: boolean };
};

export function EnrichmentSettingsCard() {
  const qc = useQueryClient();
  const { data: cadences = [] } = useCadences();
  const [apifyToken, setApifyToken] = useState("");

  const { data: company } = useQuery({
    queryKey: ["enrichment_settings"],
    queryFn: async () => {
      const { data: profile } = await supabase.from("profiles").select("user_id").maybeSingle();
      void profile;
      const { data: cm } = await supabase.from("company_members").select("company_id").limit(1).maybeSingle();
      if (!cm?.company_id) return null;
      const { data } = await supabase.from("companies").select("id, enrichment_settings").eq("id", cm.company_id).maybeSingle();
      return data as { id: string; enrichment_settings: Settings } | null;
    },
  });

  const { data: apifyInt } = useQuery({
    queryKey: ["apify_integration", company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data } = await supabase.from("integrations").select("id, api_token, status").eq("company_id", company!.id).eq("provider", "apify").maybeSingle();
      return data;
    },
  });

  const [settings, setSettings] = useState<Settings>({});
  useEffect(() => {
    if (company) setSettings(company.enrichment_settings || {});
  }, [company]);

  const save = useMutation({
    mutationFn: async () => {
      if (!company?.id) throw new Error("Empresa não encontrada");
      const { error } = await supabase.from("companies").update({ enrichment_settings: settings }).eq("id", company.id);
      if (error) throw error;
      if (apifyToken) {
        const { error: e2 } = await supabase.from("integrations").upsert({
          company_id: company.id, provider: "apify", api_token: apifyToken, status: "active",
        }, { onConflict: "company_id,provider" });
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      toast({ title: "Configurações salvas" });
      setApifyToken("");
      qc.invalidateQueries({ queryKey: ["enrichment_settings"] });
      qc.invalidateQueries({ queryKey: ["apify_integration"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const setActor = (k: keyof NonNullable<Settings["apify_actors"]>, v: boolean) =>
    setSettings((s) => ({ ...s, apify_actors: { ...(s.apify_actors || {}), [k]: v } }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Enriquecimento automático de leads
          </CardTitle>
          <Badge variant={apifyInt?.status === "active" ? "default" : "secondary"}>
            {apifyInt?.status === "active" ? "Apify conectado" : "Configure"}
          </Badge>
        </div>
        <CardDescription>
          Ao criar ou importar um lead, dispara em background: análise do site, descoberta de redes sociais, scraping (Apify) e rascunho de mensagem personalizada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Toggle id="ws" label="Analisar website automaticamente" checked={!!settings.website_analysis} onChange={(v) => set("website_analysis", v)} />
        <Toggle id="ds" label="Descobrir Instagram/LinkedIn/Facebook no website" checked={!!settings.discover_socials} onChange={(v) => set("discover_socials", v)} />
        <Toggle id="ap" label="Scraping de redes sociais via Apify" checked={!!settings.apify_scrape} onChange={(v) => set("apify_scrape", v)} />

        {settings.apify_scrape && (
          <div className="pl-6 space-y-3 border-l-2 border-muted">
            <div>
              <Label htmlFor="apify-token">Token Apify</Label>
              <Input
                id="apify-token"
                type="password"
                placeholder={apifyInt?.api_token ? "•••••••• (preenchido)" : "Cole seu Apify API token"}
                value={apifyToken}
                onChange={(e) => setApifyToken(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                <a href="https://console.apify.com/account/integrations" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                  Onde encontrar o token →
                </a>
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Actors habilitados</Label>
              <Toggle id="ai" label="Instagram (apify/instagram-scraper)" checked={settings.apify_actors?.instagram !== false} onChange={(v) => setActor("instagram", v)} />
              {settings.apify_actors?.instagram !== false && (
                <div className="pl-6 flex items-center gap-2">
                  <Label htmlFor="ig-posts" className="text-xs font-normal text-muted-foreground">Posts a analisar</Label>
                  <Input
                    id="ig-posts"
                    type="number"
                    min={3}
                    max={30}
                    className="h-7 w-20"
                    value={(settings.apify_actors as any)?.instagram_posts_limit ?? 12}
                    onChange={(e) => setSettings((s) => ({
                      ...s,
                      apify_actors: { ...(s.apify_actors || {}), instagram_posts_limit: Math.max(3, Math.min(30, Number(e.target.value) || 12)) } as any,
                    }))}
                  />
                </div>
              )}
              <Toggle id="af" label="Facebook (apify/facebook-pages-scraper)" checked={settings.apify_actors?.facebook !== false} onChange={(v) => setActor("facebook", v)} />
              <Toggle id="alp" label="LinkedIn pessoa (dev_fusion/linkedin-profile-scraper)" checked={settings.apify_actors?.linkedin_person !== false} onChange={(v) => setActor("linkedin_person", v)} />
              <Toggle id="alc" label="LinkedIn empresa (apimaestro/linkedin-company)" checked={settings.apify_actors?.linkedin_company !== false} onChange={(v) => setActor("linkedin_company", v)} />
            </div>
          </div>
        )}

        <Toggle id="gm" label="Gerar rascunho de mensagem personalizada" checked={!!settings.generate_message} onChange={(v) => set("generate_message", v)} />

        {settings.generate_message && (
          <div className="pl-6 border-l-2 border-muted">
            <Label>Cadência padrão (rascunho será salvo no 1º passo)</Label>
            <Select value={settings.default_cadence_id || ""} onValueChange={(v) => set("default_cadence_id", v || null)}>
              <SelectTrigger><SelectValue placeholder="Selecione uma cadência" /></SelectTrigger>
              <SelectContent>
                {cadences.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="pt-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Salvando..." : "Salvar configurações"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Label htmlFor={id} className="text-sm font-normal cursor-pointer">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
