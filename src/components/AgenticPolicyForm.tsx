import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

const STOP_FLAGS: { key: string; label: string }[] = [
  { key: "no_interest", label: "Respondeu que não tem interesse" },
  { key: "opt_out", label: "Pediu para remover (opt-out)" },
  { key: "meeting_booked", label: "Reunião agendada" },
  { key: "handoff", label: "Passou para humano" },
  { key: "max_attempts", label: "Atingiu máx. tentativas" },
  { key: "max_days", label: "Passou do prazo" },
];

const defaultPolicy: Partial<CadencePolicy> = {
  goal: "Agendar reunião de 15 minutos",
  max_attempts: 6,
  max_days: 15,
  allowed_channels: ["whatsapp", "email"],
  primary_channel: "whatsapp",
  tone_instructions: "Consultivo, curto, personalizado, sem pressão",
  continue_criteria: "",
  stop_criteria_flags: {
    no_interest: true, opt_out: true, meeting_booked: true, handoff: true, max_attempts: true, max_days: true,
  },
  stop_criteria_text: "",
  min_fit_score: null,
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

  const toggleFlag = (k: string) => {
    const flags = { ...(form.stop_criteria_flags || {}) };
    flags[k] = !flags[k];
    setForm({ ...form, stop_criteria_flags: flags });
  };

  const save = () => {
    if (!companyId) return;
    upsert.mutate({ cadence_id: cadenceId, company_id: companyId, ...form } as any);
  };

  const allowed = form.allowed_channels || [];

  return (
    <div className="space-y-4">
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
      <div className="space-y-2">
        <Label>Tom / instruções da IA</Label>
        <Textarea rows={2} value={form.tone_instructions || ""} onChange={(e) => setForm({ ...form, tone_instructions: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Critérios para continuar (opcional)</Label>
        <Textarea rows={2} placeholder="Ex: fit > 60, ainda há responsável a encontrar"
          value={form.continue_criteria || ""} onChange={(e) => setForm({ ...form, continue_criteria: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Critérios para parar</Label>
        <div className="grid grid-cols-2 gap-2">
          {STOP_FLAGS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={!!form.stop_criteria_flags?.[f.key]} onCheckedChange={() => toggleFlag(f.key)} />
              {f.label}
            </label>
          ))}
        </div>
        <Textarea rows={2} placeholder="Critérios extras em texto livre (opcional)"
          value={form.stop_criteria_text || ""} onChange={(e) => setForm({ ...form, stop_criteria_text: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Fit score mínimo (opcional)</Label>
        <Input type="number" placeholder="Ex: 60"
          value={form.min_fit_score ?? ""}
          onChange={(e) => setForm({ ...form, min_fit_score: e.target.value === "" ? null : +e.target.value })} />
      </div>
      <Button onClick={save} disabled={upsert.isPending} className="w-full">
        {upsert.isPending ? "Salvando..." : existing ? "Salvar política" : "Criar política"}
      </Button>
    </div>
  );
}
