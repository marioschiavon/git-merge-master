import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  Unplug,
  CheckCircle2,
  AlertTriangle,
  Clock3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type InstanceStatus =
  | "pending_qr"
  | "qr_ready"
  | "pairing"
  | "connected"
  | "disconnected"
  | "banned"
  | "error";

interface Hook7Instance {
  id: string;
  display_name: string;
  external_name: string | null;
  status: InstanceStatus;
  phone_number: string | null;
  connected_profile_name: string | null;
  owner_user_id: string | null;
  last_connected_at: string | null;
  last_qr_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<InstanceStatus, string> = {
  pending_qr: "Aguardando QR",
  qr_ready: "Escaneie o QR",
  pairing: "Pareando",
  connected: "Conectado",
  disconnected: "Desconectado",
  banned: "Banido",
  error: "Erro",
};

const STATUS_CLASS: Record<InstanceStatus, string> = {
  pending_qr: "bg-muted text-muted-foreground",
  qr_ready: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  pairing: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  connected: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  disconnected: "bg-muted text-muted-foreground",
  banned: "bg-destructive/10 text-destructive",
  error: "bg-destructive/10 text-destructive",
};

async function callManage<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(
    "hook7-instance-manage",
    { body },
  );
  if (error) {
    // supabase-js only surfaces the HTTP error message; try to extract server message
    const raw = (error as any)?.context?.text
      ? await (error as any).context.text()
      : "";
    let msg = error.message;
    try {
      const j = JSON.parse(raw);
      if (j?.error) msg = j.error;
    } catch { /* noop */ }
    throw new Error(msg);
  }
  return data as T;
}

export function WhatsAppManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const pollRef = useRef<number | null>(null);

  const {
    data: instances,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["hook7_instances"],
    queryFn: async () => {
      const r = await callManage<{ instances: Hook7Instance[] }>({
        action: "list",
      });
      return r.instances;
    },
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });

  const activeInstance =
    (instances ?? []).find((i) => i.id === activeId) ?? null;

  const createMut = useMutation({
    mutationFn: async (name: string) => {
      const r = await callManage<{ instance: Hook7Instance }>({
        action: "create",
        display_name: name,
      });
      return r.instance;
    },
    onSuccess: async (inst) => {
      setNewName("");
      qc.invalidateQueries({ queryKey: ["hook7_instances"] });
      qc.invalidateQueries({ queryKey: ["hook7_instances_summary"] });
      // conecta e abre o QR imediatamente
      setActiveId(inst.id);
      await connectAndFetchQr(inst.id);
    },
    onError: (e: Error) =>
      toast({ title: "Erro ao criar", description: e.message, variant: "destructive" }),
  });

  const disconnectMut = useMutation({
    mutationFn: async (id: string) =>
      await callManage({ action: "disconnect", instance_id: id }),
    onSuccess: () => {
      toast({ title: "Instância desconectada" });
      qc.invalidateQueries({ queryKey: ["hook7_instances"] });
      qc.invalidateQueries({ queryKey: ["hook7_instances_summary"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) =>
      await callManage({ action: "delete", instance_id: id, reason: "user_delete" }),
    onSuccess: () => {
      toast({ title: "Instância removida" });
      if (activeId) setActiveId(null);
      setQrBase64(null);
      qc.invalidateQueries({ queryKey: ["hook7_instances"] });
    },
  });

  const connectAndFetchQr = useCallback(async (id: string) => {
    setQrLoading(true);
    setQrBase64(null);
    try {
      await callManage({ action: "connect", instance_id: id });
      const r = await callManage<{ qrcode_base64: string | null }>({
        action: "qr",
        instance_id: id,
      });
      setQrBase64(r.qrcode_base64);
    } catch (e: any) {
      toast({
        title: "Falha ao gerar QR",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setQrLoading(false);
    }
  }, []);

  // Polling do status enquanto QR está aberto
  useEffect(() => {
    if (!activeId) return;
    const inst = (instances ?? []).find((i) => i.id === activeId);
    if (!inst || inst.status === "connected") return;

    const tick = async () => {
      try {
        const r = await callManage<{
          status: InstanceStatus;
          connected_profile_name: string | null;
        }>({ action: "status", instance_id: activeId });
        if (r.status === "connected") {
          toast({
            title: "WhatsApp conectado",
            description: r.connected_profile_name ?? "Instância ativa.",
          });
          setQrBase64(null);
          qc.invalidateQueries({ queryKey: ["hook7_instances"] });
        }
      } catch { /* silent */ }
    };
    pollRef.current = window.setInterval(tick, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [activeId, instances, qc]);

  useEffect(() => {
    if (!open) {
      setActiveId(null);
      setQrBase64(null);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-[#25D366]" /> WhatsApp — Instâncias
          </DialogTitle>
          <DialogDescription>
            Conecte o WhatsApp da sua empresa para que o agente envie mensagens
            aos seus leads e acompanhe respostas automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Coluna esquerda: lista + criar */}
          <div className="space-y-4">
            <div className="rounded-lg border p-3">
              <Label htmlFor="new-inst" className="text-xs font-medium">
                Nova instância
              </Label>
              <div className="mt-2 flex gap-2">
                <Input
                  id="new-inst"
                  placeholder="Ex: Comercial — Rio"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={createMut.isPending}
                  maxLength={60}
                />
                <Button
                  onClick={() => createMut.mutate(newName.trim())}
                  disabled={
                    !newName.trim() || createMut.isPending
                  }
                >
                  {createMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                O QR abre logo após criar. Escaneie no app do WhatsApp em até 2
                minutos.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Suas instâncias</h4>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => refetch()}
                  disabled={isLoading}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>

              {isLoading && !instances && (
                <>
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </>
              )}

              {instances && instances.length === 0 && (
                <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Nenhuma instância ainda.
                </p>
              )}

              {(instances ?? []).map((inst) => (
                <button
                  key={inst.id}
                  onClick={() => setActiveId(inst.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 ${
                    activeId === inst.id ? "border-primary/60 bg-primary/5" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {inst.display_name}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {inst.connected_profile_name ??
                          inst.phone_number ??
                          "—"}
                      </div>
                    </div>
                    <Badge className={STATUS_CLASS[inst.status]}>
                      {STATUS_LABEL[inst.status]}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Coluna direita: QR + ações */}
          <div className="rounded-lg border p-4">
            {!activeInstance && (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <QrCode className="mb-2 h-10 w-10 opacity-40" />
                Selecione ou crie uma instância para ver o QR Code.
              </div>
            )}

            {activeInstance && (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {activeInstance.display_name}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {activeInstance.external_name}
                    </div>
                  </div>
                  <StatusChip status={activeInstance.status} />
                </div>

                {activeInstance.status === "connected" ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
                    <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      WhatsApp ativo
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {activeInstance.connected_profile_name ??
                        activeInstance.phone_number ??
                        "Pronto para enviar e receber mensagens."}
                    </p>
                  </div>
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-md border bg-muted/30">
                    {qrLoading && (
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    )}
                    {!qrLoading && qrBase64 && (
                      <img
                        src={
                          qrBase64.startsWith("data:")
                            ? qrBase64
                            : `data:image/png;base64,${qrBase64}`
                        }
                        alt="QR Code WhatsApp"
                        className="h-full w-full object-contain p-3"
                      />
                    )}
                    {!qrLoading && !qrBase64 && (
                      <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
                        <Clock3 className="h-6 w-6" />
                        Clique em "Gerar QR" para iniciar o pareamento.
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {activeInstance.status !== "connected" && (
                    <Button
                      size="sm"
                      onClick={() => connectAndFetchQr(activeInstance.id)}
                      disabled={qrLoading}
                    >
                      <QrCode className="mr-1 h-4 w-4" />
                      {qrBase64 ? "Gerar novo QR" : "Gerar QR"}
                    </Button>
                  )}
                  {activeInstance.status === "connected" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => disconnectMut.mutate(activeInstance.id)}
                      disabled={disconnectMut.isPending}
                    >
                      <Unplug className="mr-1 h-4 w-4" />
                      Desconectar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (
                        confirm(
                          "Remover esta instância? A conexão com o WhatsApp será encerrada.",
                        )
                      ) {
                        deleteMut.mutate(activeInstance.id);
                      }
                    }}
                    disabled={deleteMut.isPending}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />
                    Remover
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusChip({ status }: { status: InstanceStatus }) {
  const cls = STATUS_CLASS[status];
  const Icon =
    status === "connected"
      ? CheckCircle2
      : status === "error" || status === "banned"
      ? AlertTriangle
      : Clock3;
  return (
    <Badge className={`${cls} gap-1`}>
      <Icon className="h-3 w-3" />
      {STATUS_LABEL[status]}
    </Badge>
  );
}
