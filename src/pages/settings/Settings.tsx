import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useHitlSettings } from "@/hooks/useApprovals";

const scopeLabels: { key: string; label: string; desc: string }[] = [
  { key: "first_message", label: "Primeira mensagem", desc: "Aprovar a primeira mensagem antes de sair em qualquer canal." },
  { key: "sdr_reply", label: "Respostas do SDR", desc: "Aprovar cada resposta gerada pela IA para mensagens recebidas." },
  { key: "cadence_step", label: "Passos de cadência", desc: "Aprovar cada step subsequente da cadência (follow-ups)." },
  { key: "sensitive_action", label: "Ações sensíveis", desc: "Aprovar agendamentos, cancelamentos, reagendamentos e remoções." },
];

export default function SettingsPage() {
  const { data: company, isLoading, update } = useHitlSettings();
  const scopes = (company?.hitl_scopes || {}) as Record<string, boolean>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
        <p className="text-muted-foreground">Operação, automação e revisão humana.</p>
      </div>

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
                    Chave global. Desligue quando se sentir confiante para deixar tudo automatizado.
                  </p>
                </div>
                <Switch
                  checked={!!company?.hitl_enabled}
                  onCheckedChange={(v) => update.mutate({ hitl_enabled: v })}
                  disabled={update.isPending}
                />
              </div>

              <Separator />

              <div className={`space-y-3 ${company?.hitl_enabled ? "" : "opacity-50 pointer-events-none"}`}>
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
                        update.mutate({ hitl_scopes: { ...scopes, [s.key]: v } })
                      }
                      disabled={update.isPending || !company?.hitl_enabled}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
