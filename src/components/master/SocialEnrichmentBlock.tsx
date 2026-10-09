import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

const NETWORKS = [
  { key: "instagram", label: "Instagram" },
  { key: "linkedin_person", label: "LinkedIn (pessoa)" },
  { key: "linkedin_company", label: "LinkedIn (empresa)" },
  { key: "facebook", label: "Facebook" },
] as const;

type Cfg = Record<string, { enabled?: boolean; monthly_limit?: number | null }>;

export function SocialEnrichmentBlock({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["social-enrichment", companyId],
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const [{ data: c }, ...counts] = await Promise.all([
        supabase.from("companies").select("social_enrichment").eq("id", companyId).maybeSingle(),
        ...NETWORKS.map((n) =>
          supabase
            .from("lead_social_profiles")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .eq("network", n.key)
            .gte("scraped_at", monthStart.toISOString()),
        ),
      ]);
      const usage: Record<string, number> = {};
      NETWORKS.forEach((n, i) => (usage[n.key] = (counts[i] as any).count ?? 0));
      return { cfg: ((c as any)?.social_enrichment ?? {}) as Cfg, usage };
    },
  });

  const [cfg, setCfg] = useState<Cfg>({});
  const [saving, setSaving] = useState(false);
  const [queuing, setQueuing] = useState(false);
  useEffect(() => {
    if (data) setCfg(data.cfg);
  }, [data]);

  const set = (k: string, patch: Partial<Cfg[string]>) => setCfg((s) => ({ ...s, [k]: { ...s[k], ...patch } }));

  const save = async () => {
    setSaving(true);
    const prev = data?.cfg ?? {};
    const turnedOn = NETWORKS.some((n) => prev[n.key]?.enabled === false && cfg[n.key]?.enabled !== false);
    const { error } = await supabase.from("companies").update({ social_enrichment: cfg } as any).eq("id", companyId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Enriquecimento de redes salvo");
    qc.invalidateQueries({ queryKey: ["social-enrichment", companyId] });
    if (turnedOn) await backfill();
  };

  const backfill = async () => {
    setQueuing(true);
    const { data: r, error } = await supabase.functions.invoke("social-enrich-backfill", {
      body: { company_id: companyId, all: true },
    });
    setQueuing(false);
    if (error || r?.error) return toast.error(r?.error || error?.message || "Falha ao reprocessar");
    toast.success(`Reprocessando ${r.candidates} leads da empresa em segundo plano`);
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Enriquecimento de redes</h3>
        <p className="text-xs text-muted-foreground">
          Automático ao entrar cada lead. Ao ativar uma rede e salvar, todos os leads atuais são reprocessados. As redes são buscadas só no site do lead. Limite em branco = sem limite.
        </p>
      </div>
      <div className="space-y-2">
        {NETWORKS.map((n) => (
          <div key={n.key} className="flex items-center gap-3 rounded-md border p-2">
            <Switch
              id={`se-${n.key}`}
              checked={cfg[n.key]?.enabled !== false}
              onCheckedChange={(v) => set(n.key, { enabled: v })}
            />
            <Label htmlFor={`se-${n.key}`} className="flex-1 text-sm font-normal">
              {n.label}
              <span className="ml-2 text-xs text-muted-foreground">{data?.usage[n.key] ?? 0} no mês</span>
            </Label>
            <Input
              type="number"
              min={0}
              placeholder="Limite/mês"
              className="h-8 w-28"
              value={cfg[n.key]?.monthly_limit ?? ""}
              onChange={(e) => set(n.key, { monthly_limit: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Salvar
        </Button>
        <Button size="sm" variant="outline" onClick={backfill} disabled={queuing}>
          {queuing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Reprocessar todos os leads
        </Button>
      </div>
    </div>
  );
}
