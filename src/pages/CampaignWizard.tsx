import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCadences } from "@/hooks/useCadences";
import { useLaunchCampaign } from "@/hooks/useLaunchCampaign";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Rocket, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Lead = { id: string; name: string | null; email: string | null; company_name: string | null; enrichment_status: string | null };

export default function CampaignWizard() {
  const { listId } = useParams();
  const navigate = useNavigate();
  const { companyId } = useAuth();
  const { data: cadences = [] } = useCadences();
  const launch = useLaunchCampaign();

  const [step, setStep] = useState(1);
  const [list, setList] = useState<any>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterEnriched, setFilterEnriched] = useState(true);
  const [requireEmail, setRequireEmail] = useState(true);
  const [cadenceId, setCadenceId] = useState<string>("");
  const [mode, setMode] = useState<"review" | "auto" | "scheduled">("review");
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [name, setName] = useState("");

  useEffect(() => {
    (async () => {
      if (!listId || !companyId) return;
      const { data: l } = await supabase.from("lead_lists" as any).select("*").eq("id", listId).maybeSingle();
      setList(l);
      if (l?.default_cadence_id) setCadenceId(l.default_cadence_id);
      if (l?.name) setName(`Campanha — ${l.name}`);
      const { data: ld } = await supabase
        .from("leads")
        .select("id,name,email,company_name,enrichment_status")
        .eq("lead_list_id", listId)
        .eq("company_id", companyId)
        .limit(2000);
      setLeads((ld as any) || []);
      setSelected(new Set(((ld as any) || []).map((x: Lead) => x.id)));
    })();
  }, [listId, companyId]);

  const visible = useMemo(() => {
    return leads.filter((l) => {
      if (filterEnriched && l.enrichment_status !== "completed") return false;
      if (requireEmail && !l.email) return false;
      return true;
    });
  }, [leads, filterEnriched, requireEmail]);

  const effectiveIds = useMemo(() => visible.filter(v => selected.has(v.id)).map(v => v.id), [visible, selected]);

  const handleLaunch = async () => {
    if (!listId || !cadenceId) {
      toast.error("Selecione uma cadência");
      return;
    }
    if (effectiveIds.length === 0) {
      toast.error("Nenhum lead selecionado");
      return;
    }
    if (mode === "scheduled" && !scheduledFor) {
      toast.error("Informe a data de agendamento");
      return;
    }
    const r = await launch.mutateAsync({
      list_id: listId, cadence_id: cadenceId, mode, name,
      scheduled_for: mode === "scheduled" ? new Date(scheduledFor).toISOString() : null,
      lead_ids: effectiveIds,
      filters: { only_enriched: filterEnriched, require_email: requireEmail },
    });
    if (r?.ok) navigate(`/leads/lists`);
  };

  const selectedCadence = cadences.find(c => c.id === cadenceId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/leads/lists")} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Rocket className="h-6 w-6" /> Lançar campanha
          </h1>
          <p className="text-muted-foreground">{list?.name || "Lista"}</p>
        </div>
        <Badge variant="outline">Passo {step} de 4</Badge>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader><CardTitle>1. Seleção de leads</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={filterEnriched} onCheckedChange={(v) => setFilterEnriched(!!v)} />
                Apenas enriquecidos
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={requireEmail} onCheckedChange={(v) => setRequireEmail(!!v)} />
                Apenas com e-mail
              </label>
            </div>
            <div className="rounded border max-h-96 overflow-y-auto">
              <div className="sticky top-0 bg-muted px-3 py-2 flex items-center gap-3 text-xs">
                <Checkbox
                  checked={visible.length > 0 && visible.every(v => selected.has(v.id))}
                  onCheckedChange={(v) => {
                    const next = new Set(selected);
                    if (v) visible.forEach(x => next.add(x.id));
                    else visible.forEach(x => next.delete(x.id));
                    setSelected(next);
                  }}
                />
                <span>{effectiveIds.length} selecionados de {visible.length} visíveis ({leads.length} total)</span>
              </div>
              {visible.map(l => (
                <div key={l.id} className="px-3 py-2 border-t flex items-center gap-3 text-sm">
                  <Checkbox
                    checked={selected.has(l.id)}
                    onCheckedChange={(v) => {
                      const next = new Set(selected);
                      if (v) next.add(l.id); else next.delete(l.id);
                      setSelected(next);
                    }}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{l.name || "(sem nome)"}</div>
                    <div className="text-xs text-muted-foreground">{l.email || "—"} · {l.company_name || ""}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>2. Cadência</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Nome da campanha</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Cadência</Label>
              <Select value={cadenceId} onValueChange={setCadenceId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {cadences.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} <span className="text-muted-foreground">({c.type})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCadence && (
                <p className="text-xs text-muted-foreground mt-2">{selectedCadence.description}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader><CardTitle>3. Modo de envio</CardTitle></CardHeader>
          <CardContent>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="space-y-3">
              <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-muted/30">
                <RadioGroupItem value="review" id="m1" className="mt-1" />
                <div>
                  <div className="font-medium">Revisar cada mensagem</div>
                  <p className="text-xs text-muted-foreground">A 1ª mensagem é gerada e fica em Aprovações para você revisar antes de enviar.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-muted/30 border-amber-300">
                <RadioGroupItem value="auto" id="m2" className="mt-1" />
                <div>
                  <div className="font-medium">Full-auto ⚡</div>
                  <p className="text-xs text-muted-foreground">A 1ª mensagem é gerada e aprovada automaticamente, respeitando o limite diário da cadência. Ativa o toggle de auto-aprovação na cadência.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-3 border rounded cursor-pointer hover:bg-muted/30">
                <RadioGroupItem value="scheduled" id="m3" className="mt-1" />
                <div className="flex-1">
                  <div className="font-medium">Agendar</div>
                  <p className="text-xs text-muted-foreground">As inscrições são criadas com data futura; a cadência começa a partir dela.</p>
                  {mode === "scheduled" && (
                    <Input type="datetime-local" className="mt-2 max-w-xs" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                  )}
                </div>
              </label>
            </RadioGroup>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader><CardTitle>4. Confirmar</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row k="Lista" v={list?.name} />
            <Row k="Leads selecionados" v={`${effectiveIds.length} de ${leads.length}`} />
            <Row k="Cadência" v={selectedCadence?.name || "—"} />
            <Row k="Modo" v={mode === "review" ? "Revisar cada mensagem" : mode === "auto" ? "Full-auto" : `Agendada para ${scheduledFor}`} />
            <Separator />
            <p className="text-xs text-muted-foreground">
              Após o lançamento, cada lead será inscrito na cadência e a 1ª mensagem será gerada pela IA.
              {mode === "review" ? " Você verá as mensagens em /approvals." : ""}
              {mode === "auto" ? " As mensagens serão auto-aprovadas até o limite diário." : ""}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-between">
        <Button variant="ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Anterior
        </Button>
        {step < 4 ? (
          <Button onClick={() => setStep(step + 1)} disabled={step === 1 && effectiveIds.length === 0}>
            Próximo <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleLaunch} disabled={launch.isPending}>
            {launch.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Rocket className="h-4 w-4 mr-1" />}
            Lançar campanha
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>;
}
