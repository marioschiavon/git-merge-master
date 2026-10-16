import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { toast } from "sonner";

type Mod = { key: string; name: string; description: string | null; kind: string; price_cents: number; active: boolean; sort_order: number; included_in_plans: boolean };
type Plan = { id?: string; name: string; description: string | null; price_cents: number; active: boolean; sort_order: number };

const db = supabase as any;

function PriceInput({ cents, onChange }: { cents: number; onChange: (c: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">R$</span>
      <Input
        type="number" min={0} step="0.01" className="w-32"
        defaultValue={(cents / 100).toFixed(2)}
        onBlur={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))}
      />
    </div>
  );
}

export default function Pricing() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["billing-pricing"],
    queryFn: async () => {
      const [m, p] = await Promise.all([
        db.from("billing_catalog").select("*").order("sort_order"),
        db.from("billing_plans").select("*").order("sort_order"),
      ]);
      if (m.error) throw m.error;
      if (p.error) throw p.error;
      return { mods: m.data as Mod[], plans: p.data as Plan[] };
    },
  });
  const [mods, setMods] = useState<Mod[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) { setMods(data.mods); setPlans(data.plans); } }, [data]);

  const updMod = (key: string, patch: Partial<Mod>) => setMods((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const updPlan = (idx: number, patch: Partial<Plan>) => setPlans((p) => p.map((i, n) => (n === idx ? { ...i, ...patch } : i)));

  const save = async () => {
    if (plans.some((p) => !p.name.trim())) return toast.error("Todo plano precisa de um nome");
    setSaving(true);
    const now = new Date().toISOString();
    const modRows = mods.map(({ key, name, description, kind, price_cents, active, sort_order, included_in_plans }) => ({ key, name, description, kind, price_cents, active, sort_order, included_in_plans, updated_at: now }));
    const existing = plans.filter((p) => p.id).map((p) => ({ ...p, updated_at: now }));
    const fresh = plans.filter((p) => !p.id).map(({ id, ...p }) => p);
    const results = await Promise.all([
      db.from("billing_catalog").upsert(modRows),
      existing.length ? db.from("billing_plans").upsert(existing) : { error: null },
      fresh.length ? db.from("billing_plans").insert(fresh) : { error: null },
    ]);
    setSaving(false);
    const err = results.find((r: any) => r.error)?.error;
    if (err) return toast.error("Não foi possível salvar: " + err.message);
    toast.success("Preços salvos");
    qc.invalidateQueries({ queryKey: ["billing-pricing"] });
  };

  const sellable = mods.filter((m) => m.kind !== "base" && !m.included_in_plans);
  const included = mods.filter((m) => m.included_in_plans);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Financeiro / Preços</h1>
          <p className="text-muted-foreground">Planos e módulos usados como valores padrão nas assinaturas das empresas.</p>
        </div>
        <Button onClick={save} disabled={saving || isLoading}>{saving ? "Salvando..." : "Salvar alterações"}</Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Planos (mensal)</CardTitle>
            <CardDescription>Desative um plano para tirá-lo da venda sem afetar quem já assina.</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setPlans((p) => [...p, { name: "", description: null, price_cents: 0, active: true, sort_order: p.length + 1 }])}>
            <Plus className="mr-1 h-4 w-4" /> Novo plano
          </Button>
        </CardHeader>
        <CardContent className="divide-y">
          {plans.map((p, idx) => (
            <div key={p.id ?? `new-${idx}`} className="flex flex-wrap items-center gap-4 py-3">
              <Input className="w-48" placeholder="Nome do plano" value={p.name} onChange={(e) => updPlan(idx, { name: e.target.value })} />
              <Input className="min-w-[200px] flex-1" placeholder="Descrição (opcional)" value={p.description ?? ""} onChange={(e) => updPlan(idx, { description: e.target.value || null })} />
              <PriceInput cents={p.price_cents} onChange={(c) => updPlan(idx, { price_cents: c })} />
              <div className="flex items-center gap-2">
                <Switch checked={p.active} onCheckedChange={(v) => updPlan(idx, { active: v })} />
                {!p.active && <Badge variant="secondary">Fora da venda</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Módulos adicionais</CardTitle>
          <CardDescription>Cobrados à parte, somados ao plano.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {sellable.map((m) => (
            <div key={m.key} className="flex flex-wrap items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">{m.name}{!m.active && <Badge variant="secondary">Fora da venda</Badge>}</div>
                <p className="text-sm text-muted-foreground">{m.description}</p>
              </div>
              <div className="flex items-center gap-4">
                <PriceInput key={m.key + m.price_cents} cents={m.price_cents} onChange={(c) => updMod(m.key, { price_cents: c })} />
                <Switch checked={m.active} onCheckedChange={(v) => updMod(m.key, { active: v })} />
              </div>
            </div>
          ))}
          {included.length > 0 && (
            <p className="pt-3 text-sm text-muted-foreground">
              Inclusos em todos os planos: {included.map((m) => m.name).join(", ")}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cobrança (Asaas)</CardTitle>
          <CardDescription>Conexão com o Asaas ainda não configurada — próxima etapa.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
