import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCadencePolicy, useUpsertCadencePolicy, type CadencePolicy } from "@/hooks/useAgenticCadence";
import { useAuth } from "@/hooks/useAuth";

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "E-mail" },
  { id: "linkedin", label: "LinkedIn" },
];

const defaultPolicy: Partial<CadencePolicy> = {
  goal: "Agendar reunião de 15 minutos",
  max_attempts: 6,
  max_days: 15,
  allowed_channels: ["whatsapp", "email"],
  primary_channel: "whatsapp",
  business_hours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5], tz: "America/Sao_Paulo" },
};

export function AgenticPolicyForm({ cadenceId }: { cadenceId: string }) {
  const { companyId } = useAuth();
  const { data: existing } = useCadencePolicy(cadenceId);
  const upsert = useUpsertCadencePolicy();
  const [form, setForm] = useState<Partial<CadencePolicy>>(defaultPolicy);

  useEffect(() => {
    if (existing) setForm(existing);
  }, [existing]);

  const toggleChannel = (ch: string) => {
    const cur = form.allowed_channels || [];
    const next = cur.includes(ch) ? cur.filter((c) => c !== ch) : [...cur, ch];
    setForm({ ...form, allowed_channels: next });
  };

  const save = () => {
    if (!companyId) return;
    upsert.mutate({ cadence_id: cadenceId, company_id: companyId, ...form } as any);
  };

  const allowed = form.allowed_channels || [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-foreground space-y-1">
        <div>
          <strong>Como funciona:</strong> a <em>primeira mensagem</em> usa o mesmo motor das cadências padrão
          (knowledge da empresa, destaques, instruções e insights do lead). A IA assume{" "}
          <strong>a partir do 2º toque</strong>, decidindo canal, conteúdo e quando parar.
        </div>
        <div>
          <strong>Tom da IA</strong> vem das <em>Instruções da empresa</em> em Knowledge (global para todas as cadências).
        </div>
        <div>
          <strong>Paradas automáticas:</strong> reunião agendada, opt-out, "sem interesse",
          máx. tentativas e prazo são tratados sem configuração.
        </div>
      </div>
      <div className="space-y-2">
        <Label>Objetivo</Label>
        <Input value={form.goal || ""} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Máx. tentativas</Label>
          <Input type="number" value={form.max_attempts ?? 6} onChange={(e) => setForm({ ...form, max_attempts: +e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Prazo (dias)</Label>
          <Input type="number" value={form.max_days ?? 15} onChange={(e) => setForm({ ...form, max_days: +e.target.value })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Canais permitidos</Label>
        <div className="flex gap-3">
          {CHANNELS.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={allowed.includes(c.id)} onCheckedChange={() => toggleChannel(c.id)} />
              {c.label}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label>Canal principal</Label>
        <Select value={form.primary_channel} onValueChange={(v) => setForm({ ...form, primary_channel: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CHANNELS.filter((c) => allowed.includes(c.id)).map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          A IA prioriza este canal quando o lead tem o contato disponível. Caso contrário, usa um canal permitido alternativo (ex: lead sem WhatsApp → e-mail).
        </p>
      </div>
      <Button onClick={save} disabled={upsert.isPending} className="w-full">
        {upsert.isPending ? "Salvando..." : existing ? "Salvar política" : "Criar política"}
      </Button>
    </div>
  );
}
