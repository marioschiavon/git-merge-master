import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useCadences } from "@/hooks/useCadences";

type Settings = {
  website_analysis?: boolean;
  discover_socials?: boolean;
  generate_message?: boolean;
  autofill_contacts?: boolean;
  validate_whatsapp?: boolean;
  default_cadence_id?: string | null;
};

export function EnrichmentSettingsCard() {
  const qc = useQueryClient();
  const { data: cadences = [] } = useCadences();

  const { data: company } = useQuery({
    queryKey: ["enrichment_settings"],
    queryFn: async () => {
      const { data: cm } = await supabase.from("company_members").select("company_id").limit(1).maybeSingle();
      if (!cm?.company_id) return null;
      const { data } = await supabase.from("companies").select("id, enrichment_settings").eq("id", cm.company_id).maybeSingle();
      return data as { id: string; enrichment_settings: Settings } | null;
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
    },
    onSuccess: () => {
      toast({ title: "Configurações salvas" });
      qc.invalidateQueries({ queryKey: ["enrichment_settings"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings((s) => ({ ...s, [k]: v }));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Enriquecimento automático de leads
        </CardTitle>
        <CardDescription>
          Ao criar ou importar um lead, dispara em background: análise do site, descoberta de redes sociais e rascunho de mensagem personalizada.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Toggle id="ws" label="Analisar website automaticamente" checked={!!settings.website_analysis} onChange={(v) => set("website_analysis", v)} />
        <Toggle id="ds" label="Descobrir Instagram/LinkedIn/Facebook no website" checked={!!settings.discover_socials} onChange={(v) => set("discover_socials", v)} />

        <p className="text-xs text-muted-foreground -mt-2 pl-0">
          O enriquecimento de redes sociais (Instagram, Facebook, LinkedIn) é executado automaticamente pela plataforma quando disponível — nenhuma configuração necessária.
        </p>

        <Toggle id="ac" label="Completar contatos faltantes (email / telefone / WhatsApp) a partir do site e redes" checked={settings.autofill_contacts !== false} onChange={(v) => set("autofill_contacts", v)} />

        <div className="space-y-1">
          <Toggle id="vw" label="Validar se o número tem WhatsApp (Z-API)" checked={!!settings.validate_whatsapp} onChange={(v) => set("validate_whatsapp", v)} />
          <p className="text-xs text-muted-foreground pl-0">
            Consulta a Z-API para confirmar se o telefone do lead está registrado no WhatsApp. Se não estiver, a cadência pula automaticamente os passos de WhatsApp. Requer integração Z-API ativa.
          </p>
        </div>

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
