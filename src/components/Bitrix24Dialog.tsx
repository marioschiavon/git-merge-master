import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ExternalLink, Loader2, Plug, Unplug } from "lucide-react";
import {
  BITRIX_LEAD_FIELDS,
  normalizeFieldMap,
  useBitrix24Integration,
  useConnectBitrix24,
  useDisconnectBitrix24,
  useBitrix24Discover,
  useSaveBitrix24Config,
  useBitrix24Queue,
  type Bitrix24Config,
  type BitrixEntity,
  type BitrixFieldTarget,
} from "@/hooks/useBitrix24";


const NONE = "__none__";

export function Bitrix24Dialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: integration, isLoading } = useBitrix24Integration();
  const connect = useConnectBitrix24();
  const disconnect = useDisconnectBitrix24();
  const saveConfig = useSaveBitrix24Config();
  const { data: queue } = useBitrix24Queue();

  const connected = !!integration && integration.status === "active";
  const savedConfig = (integration?.config ?? {}) as Bitrix24Config;

  const [webhookUrl, setWebhookUrl] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [stageCreated, setStageCreated] = useState<string | null>(null);
  const [stageHandoff, setStageHandoff] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [fieldMap, setFieldMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setCategoryId(savedConfig.category_id ?? null);
    setStageCreated(savedConfig.stage_created ?? null);
    setStageHandoff(savedConfig.stage_handoff ?? null);
    setSourceId(savedConfig.source_id ?? null);
    setFieldMap(savedConfig.field_map ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, integration?.id]);

  const discover = useBitrix24Discover(categoryId, open && connected);
  const data = discover.data;

  const stages = data?.stages ?? [];
  const canSave = useMemo(
    () => !!categoryId && !!stageCreated && !!stageHandoff,
    [categoryId, stageCreated, stageHandoff],
  );

  useEffect(() => {
    if (!categoryId && data?.category_id) setCategoryId(data.category_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.category_id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bitrix24</DialogTitle>
          <DialogDescription>
            Quando um lead é abordado, o negócio nasce no seu Bitrix24. Quando a IA passa o
            atendimento para uma pessoa, o negócio avança de etapa com o resumo da conversa.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : !connected ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bitrix-webhook">URL do webhook de entrada</Label>
              <Input
                id="bitrix-webhook"
                placeholder="https://suaempresa.bitrix24.com.br/rest/1/codigo/"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                No Bitrix24: <strong>Aplicativos → Desenvolvedor → Outros → Webhook de
                entrada</strong>. Marque as permissões de <strong>CRM</strong>, salve e copie a URL
                gerada.
              </p>
            </div>
            <Button
              onClick={() => connect.mutate(webhookUrl)}
              disabled={!webhookUrl.trim() || connect.isPending}
              className="w-full"
            >
              {connect.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plug className="mr-2 h-4 w-4" />
              )}
              Conectar
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">Conectado</Badge>
                <span className="text-muted-foreground">{integration?.api_domain}</span>
              </div>
              <a
                href={`https://${integration?.api_domain}/crm/deal/`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Abrir CRM <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {discover.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Lendo funis e campos do Bitrix24…
              </div>
            ) : discover.isError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                <span>{(discover.error as Error).message}</span>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Funil</Label>
                    <Select
                      value={categoryId ?? undefined}
                      onValueChange={(v) => {
                        setCategoryId(v);
                        setStageCreated(null);
                        setStageHandoff(null);
                      }}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {(data?.categories ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Fonte no Bitrix</Label>
                    <Select
                      value={sourceId ?? NONE}
                      onValueChange={(v) => setSourceId(v === NONE ? null : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Sem fonte" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Sem fonte</SelectItem>
                        {(data?.sources ?? []).map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Etapa ao abordar o lead</Label>
                    <Select
                      value={stageCreated ?? undefined}
                      onValueChange={setStageCreated}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Etapa ao passar para humano</Label>
                    <Select
                      value={stageHandoff ?? undefined}
                      onValueChange={setStageHandoff}
                    >
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {stages.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label>Campos personalizados</Label>
                    <p className="text-xs text-muted-foreground">
                      Escolha para qual campo do Bitrix cada informação do Leaderei deve ir.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {BITRIX_LEAD_FIELDS.map((f) => (
                      <div key={f.key} className="grid grid-cols-2 items-center gap-3">
                        <span className="text-sm">{f.label}</span>
                        <Select
                          value={fieldMap[f.key] ?? NONE}
                          onValueChange={(v) =>
                            setFieldMap((prev) => {
                              const next = { ...prev };
                              if (v === NONE) delete next[f.key];
                              else next[f.key] = v;
                              return next;
                            })
                          }
                        >
                          <SelectTrigger><SelectValue placeholder="Não enviar" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>Não enviar</SelectItem>
                            {(data?.fields ?? []).map((bf) => (
                              <SelectItem key={bf.code} value={bf.code}>{bf.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border p-3 text-sm">
                  <div className="mb-1 font-medium">Fila de sincronização</div>
                  <div className="flex gap-4 text-muted-foreground">
                    <span>Pendentes: {queue?.pending ?? 0}</span>
                    <span>Falhas: {queue?.failed ?? 0}</span>
                  </div>
                  {queue?.lastError && (
                    <p className="mt-2 text-xs text-destructive">Último erro: {queue.lastError}</p>
                  )}
                </div>

                <div className="flex justify-between gap-2">
                  <Button
                    variant="outline"
                    onClick={() => disconnect.mutate(undefined, {
                      onSuccess: () => onOpenChange(false),
                    })}
                    disabled={disconnect.isPending}
                  >
                    <Unplug className="mr-2 h-4 w-4" /> Desconectar
                  </Button>
                  <Button
                    onClick={() =>
                      saveConfig.mutate({
                        user_id: savedConfig.user_id ?? "1",
                        category_id: categoryId,
                        stage_created: stageCreated,
                        stage_handoff: stageHandoff,
                        source_id: sourceId,
                        field_map: fieldMap,
                      })
                    }
                    disabled={!canSave || saveConfig.isPending}
                  >
                    {saveConfig.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar mapeamento
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
