import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Loader2, Target, X, Building2, User } from "lucide-react";
import { useHitlSettings } from "@/hooks/useApprovals";
import { useScoringConfig, useUpdateScoringConfig } from "@/hooks/useScoring";
import { useCompanySettings, type BusinessHours } from "@/hooks/useCompanySettings";
import { useProfileSettings } from "@/hooks/useProfileSettings";
import { useAuth } from "@/hooks/useAuth";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const scopeLabels: { key: string; label: string; desc: string }[] = [
  { key: "first_message", label: "Primeira mensagem", desc: "Aprovar a primeira mensagem antes de sair em qualquer canal." },
  { key: "sdr_reply", label: "Respostas do SDR", desc: "Aprovar cada resposta gerada pela IA para mensagens recebidas." },
  { key: "cadence_step", label: "Passos de cadência", desc: "Aprovar cada step subsequente da cadência (follow-ups)." },
  { key: "sensitive_action", label: "Ações sensíveis", desc: "Aprovar agendamentos, cancelamentos, reagendamentos e remoções." },
];

export default function SettingsPage() {
  const { data: company, isLoading, update } = useHitlSettings();
  const { isCompanyAdmin, isMasterAdmin } = useAuth();
  const canEditCompany = isCompanyAdmin || isMasterAdmin;
  const scopes = (company?.hitl_scopes || {}) as Record<string, boolean>;
  const hitlEnabled = !!company?.hitl_enabled;
  const savingHitl = update.isPending;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
        <p className="text-muted-foreground">Empresa, perfil, automação e revisão humana.</p>
      </div>

      <CompanyCard />
      <ProfileCard />
      <ScoringCard />

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle>Human-in-the-Loop</CardTitle>
          </div>
          <CardDescription>
            Quando ativado, nada é enviado automaticamente — toda mensagem ou ação da IA fica na fila de{" "}
            <strong>Aprovações</strong> para você revisar, editar e aprovar antes de sair.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border p-4 bg-muted/30">
                <div>
                  <Label className="text-base">Revisão humana antes de enviar</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {canEditCompany
                      ? "Chave global. Desligue quando se sentir confiante para deixar tudo automatizado."
                      : "Apenas administradores da empresa podem alterar esta configuração."}
                  </p>
                </div>
                <Switch
                  checked={hitlEnabled}
                  onCheckedChange={(v) => update.mutate({ hitl_enabled: v })}
                  disabled={savingHitl || !canEditCompany}
                />
              </div>

              <Separator />

              <div className={`space-y-3 ${hitlEnabled ? "" : "opacity-70"}`}>
                <p className="text-sm font-medium">Escopo</p>
                {scopeLabels.map((s) => (
                  <div key={s.key} className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <Label className="text-sm">{s.label}</Label>
                      <p className="text-xs text-muted-foreground">{s.desc}</p>
                    </div>
                    <Switch
                      checked={scopes[s.key] !== false}
                      onCheckedChange={(v) =>
                        update.mutate({ hitl_enabled: true, hitl_scopes: { ...scopes, [s.key]: v } })
                      }
                      disabled={savingHitl || !canEditCompany}
                    />
                  </div>
                ))}
                {!hitlEnabled && canEditCompany && (
                  <p className="text-xs text-muted-foreground">
                    Alterar qualquer escopo ativa a revisão humana automaticamente.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScoringCard() {
  const { data, isLoading } = useScoringConfig();
  const update = useUpdateScoringConfig();

  const [prompt, setPrompt] = useState("");
  const [include, setInclude] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [newInclude, setNewInclude] = useState("");
  const [newExclude, setNewExclude] = useState("");

  useEffect(() => {
    if (!data) return;
    setPrompt(data.scoring_prompt || "");
    setInclude(data.scoring_include || []);
    setExclude(data.scoring_exclude || []);
  }, [data]);

  const addTag = (raw: string, list: string[], setList: (v: string[]) => void, clear: () => void) => {
    const parts = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s && !list.includes(s));
    if (!parts.length) return;
    setList([...list, ...parts]);
    clear();
  };

  const save = () => {
    update.mutate({
      scoring_prompt: prompt.trim() || null,
      scoring_include: include,
      scoring_exclude: exclude,
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <CardTitle>Qualificação de Leads (Score)</CardTitle>
        </div>
        <CardDescription>
          Descreva o que é um <strong>lead bom</strong> e um <strong>lead ruim</strong> para o seu ICP. A IA usa esse
          critério ao analisar o site de cada lead e gera um score de 0 a 100. Quanto mais específico o critério, mais
          útil o score.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div>
              <Label htmlFor="scoring-prompt">Critério de qualificação (prompt)</Label>
              <Textarea
                id="scoring-prompt"
                className="mt-1 min-h-[140px]"
                placeholder={`Ex.:
Critério 1: possui página dedicada a bolsas de estudo.
Critério 2: publicação recente sobre o tema (últimos 12 meses).
Critério 3: menciona número de bolsas oferecidas.
Critério 4: destaca o tema na homepage.`}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Liste critérios objetivos. A IA gera um breakdown por critério dentro do lead.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <TagField
                label="Palavras/temas que AUMENTAM o score"
                helper="Ex.: casa popular, minha casa minha vida"
                tags={include}
                value={newInclude}
                setValue={setNewInclude}
                onAdd={() => addTag(newInclude, include, setInclude, () => setNewInclude(""))}
                onRemove={(t) => setInclude(include.filter((x) => x !== t))}
                tone="success"
              />
              <TagField
                label="Palavras/temas que REDUZEM ou ZERAM o score"
                helper="Ex.: alto padrão, requinte, localização privilegiada"
                tags={exclude}
                value={newExclude}
                setValue={setNewExclude}
                onAdd={() => addTag(newExclude, exclude, setExclude, () => setNewExclude(""))}
                onRemove={(t) => setExclude(exclude.filter((x) => x !== t))}
                tone="danger"
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={update.isPending}>
                {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar critério
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TagField({
  label,
  helper,
  tags,
  value,
  setValue,
  onAdd,
  onRemove,
  tone,
}: {
  label: string;
  helper: string;
  tags: string[];
  value: string;
  setValue: (v: string) => void;
  onAdd: () => void;
  onRemove: (t: string) => void;
  tone: "success" | "danger";
}) {
  const badgeClass =
    tone === "success"
      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-200"
      : "bg-rose-100 text-rose-800 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-200";
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder="Adicionar termo e Enter"
        />
        <Button type="button" variant="secondary" onClick={onAdd}>
          Adicionar
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Badge key={t} variant="secondary" className={`${badgeClass} gap-1`}>
              {t}
              <button
                type="button"
                onClick={() => onRemove(t)}
                className="rounded-full opacity-60 hover:opacity-100"
                aria-label={`Remover ${t}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasília (America/Sao_Paulo)" },
  { value: "America/Manaus", label: "Manaus (America/Manaus)" },
  { value: "America/Belem", label: "Belém (America/Belem)" },
  { value: "America/Fortaleza", label: "Fortaleza (America/Fortaleza)" },
  { value: "America/Cuiaba", label: "Cuiabá (America/Cuiaba)" },
  { value: "America/Rio_Branco", label: "Rio Branco (America/Rio_Branco)" },
  { value: "America/Noronha", label: "Noronha (America/Noronha)" },
  { value: "UTC", label: "UTC" },
];

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

function CompanyCard() {
  const { data, isLoading, update } = useCompanySettings();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [hours, setHours] = useState<BusinessHours>({ start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] });

  useEffect(() => {
    if (!data) return;
    setName(data.name || "");
    setTimezone(data.timezone || "America/Sao_Paulo");
    setHours(data.business_hours || { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] });
  }, [data]);

  const toggleDay = (d: number) => {
    setHours((h) => ({
      ...h,
      days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d].sort(),
    }));
  };

  const save = () => {
    update.mutate({ name: name.trim(), timezone, business_hours: hours });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <CardTitle>Empresa</CardTitle>
        </div>
        <CardDescription>
          Nome que aparece no rodapé de emails e na apresentação da IA, fuso horário e janela de envio das cadências.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div>
              <Label htmlFor="company-name">Nome da empresa</Label>
              <Input
                id="company-name"
                className="mt-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Leaderei"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Escreva exatamente como quer aparecer em "Fala, aqui é do time da [Empresa]".
              </p>
            </div>

            <div>
              <Label>Fuso horário</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                Use o fuso onde a maioria dos seus prospects está.
              </p>
            </div>

            <div>
              <Label>Janela de envio</Label>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <Input
                  type="time"
                  className="w-32"
                  value={hours.start}
                  onChange={(e) => setHours({ ...hours, start: e.target.value })}
                />
                <span className="text-sm text-muted-foreground">até</span>
                <Input
                  type="time"
                  className="w-32"
                  value={hours.end}
                  onChange={(e) => setHours({ ...hours, end: e.target.value })}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                {WEEKDAYS.map((d) => (
                  <label key={d.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={hours.days.includes(d.value)}
                      onCheckedChange={() => toggleDay(d.value)}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Fora dessa janela, cadências pausam automaticamente para não enviar de madrugada.
              </p>
              <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
                <strong>Atenção:</strong> enviar mensagens fora do horário comercial (madrugada, finais de semana quando não configurados) aumenta muito o risco de <strong>banimento do número de WhatsApp</strong> e queima de reputação de domínio no email. A janela configurada aqui é aplicada a <strong>todos os envios</strong>, inclusive respostas automáticas a leads que responderam. A responsabilidade pela configuração é do administrador da conta — configure uma janela realista para o seu público.
              </div>

            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={update.isPending || !name.trim()}>
                {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar empresa
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileCard() {
  const { data, isLoading, update } = useProfileSettings();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (!data) return;
    setFullName(data.full_name || "");
    setPhone(data.phone || "");
  }, [data]);

  const save = () => {
    update.mutate({ full_name: fullName.trim() || null, phone: phone.trim() || null });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          <CardTitle>Meu perfil</CardTitle>
        </div>
        <CardDescription>Seus dados pessoais dentro do Leaderei.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div>
              <Label htmlFor="profile-name">Nome completo</Label>
              <Input
                id="profile-name"
                className="mt-1"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="profile-phone">Telefone</Label>
              <Input
                id="profile-phone"
                className="mt-1"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+55 11 91234-5678"
              />
            </div>
            <div>
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" className="mt-1" value={data?.email ?? ""} readOnly disabled />
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={update.isPending}>
                {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar perfil
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

