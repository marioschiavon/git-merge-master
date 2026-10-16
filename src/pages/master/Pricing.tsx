import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Item = { key: string; name: string; description: string | null; kind: string; price_cents: number; active: boolean; sort_order: number };

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function Pricing() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["billing-catalog"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("billing_catalog").select("*").order("sort_order");
      if (error) throw error;
      return data as Item[];
    },
  });
  const [items, setItems] = useState<Item[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setItems(data); }, [data]);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((p) => p.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const save = async () => {
    setSaving(true);
    const rows = items.map(({ key, name, description, kind, price_cents, active, sort_order }) => ({ key, name, description, kind, price_cents, active, sort_order, updated_at: new Date().toISOString() }));
    const { error } = await (supabase as any).from("billing_catalog").upsert(rows);
    setSaving(false);
    if (error) return toast.error("Não foi possível salvar: " + error.message);
    toast.success("Preços salvos");
    qc.invalidateQueries({ queryKey: ["billing-catalog"] });
  };

  const base = items.find((i) => i.kind === "base");
  const modules = items.filter((i) => i.kind !== "base");
  const total = (base?.price_cents ?? 0) + modules.filter((m) => m.active).reduce((s, m) => s + m.price_cents, 0);

  const PriceInput = ({ item }: { item: Item }) => (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">R$</span>
      <Input
        type="number" min={0} step="0.01" className="w-32"
        defaultValue={(item.price_cents / 100).toFixed(2)}
        onBlur={(e) => update(item.key, { price_cents: Math.round(Number(e.target.value || 0) * 100) })}
      />
    </div>
  );

  return (
    <div className="space-y-6 p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Financeiro / Preços</h1>
          <p className="text-muted-foreground">Valores padrão sugeridos para novas assinaturas. Podem ser ajustados por empresa.</p>
        </div>
        <Button onClick={save} disabled={saving || isLoading}>{saving ? "Salvando..." : "Salvar alterações"}</Button>
      </div>

      {base && (
        <Card>
          <CardHeader>
            <CardTitle>Assinatura base (mensal)</CardTitle>
            <CardDescription>{base.description}</CardDescription>
          </CardHeader>
          <CardContent><PriceInput key={base.key + base.price_cents} item={base} /></CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Módulos adicionais</CardTitle>
          <CardDescription>Desative um módulo para deixá-lo fora do catálogo de venda.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {modules.map((m) => (
            <div key={m.key} className="flex flex-wrap items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">{m.name}{!m.active && <Badge variant="secondary">Fora do catálogo</Badge>}</div>
                <p className="text-sm text-muted-foreground">{m.description}</p>
              </div>
              <div className="flex items-center gap-4">
                <PriceInput key={m.key + m.price_cents} item={m} />
                <Switch checked={m.active} onCheckedChange={(v) => update(m.key, { active: v })} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cobrança (Asaas)</CardTitle>
          <CardDescription>Conexão com o Asaas ainda não configurada — próxima etapa.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Referência: base + todos os módulos ativos = <span className="font-medium text-foreground">{brl(total)}</span>/mês
        </CardContent>
      </Card>
    </div>
  );
}
