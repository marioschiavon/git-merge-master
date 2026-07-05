import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ExternalLink, Loader2, Unplug } from "lucide-react";
import { useApolloStatus, useConnectApollo, useDisconnectApollo } from "@/hooks/useApollo";

export function ApolloConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const status = useApolloStatus();
  const connect = useConnectApollo();
  const disconnect = useDisconnectApollo();
  const [apiKey, setApiKey] = useState("");

  const isConnected = !!status.data?.connected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar Apollo.io</DialogTitle>
          <DialogDescription>
            Busca de leads, enriquecimento por email/LinkedIn e telemetria de uso da API.
            A chave é armazenada de forma segura por empresa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isConnected && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>Apollo conectado.</span>
              {status.data?.last_check_at && (
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  Validado {new Date(status.data.last_check_at).toLocaleString("pt-BR")}
                </Badge>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="apl-key">
              API Key Apollo{" "}
              {isConnected && (
                <span className="text-xs text-muted-foreground">(cole novamente para substituir)</span>
              )}
            </Label>
            <Input
              id="apl-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="a1b2c3..."
              autoComplete="off"
            />
            <a
              href="https://apolloio.github.io/apollo-api-docs/?shell#authentication"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Como gerar a chave <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => connect.mutate(apiKey.trim(), { onSuccess: () => setApiKey("") })}
              disabled={apiKey.trim().length < 10 || connect.isPending}
            >
              {connect.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {isConnected ? "Substituir chave" : "Conectar"}
            </Button>
            {isConnected && (
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Desconectar Apollo? Os leads já importados serão mantidos.")) {
                    disconnect.mutate(undefined, { onSuccess: () => onOpenChange(false) });
                  }
                }}
                disabled={disconnect.isPending}
              >
                <Unplug className="mr-1 h-4 w-4" />
                Desconectar
              </Button>
            )}
          </div>

          {isConnected && (
            <>
              <Separator />
              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">Buscar prospects agora</p>
                <p className="text-xs text-muted-foreground">
                  Encontre leads por cargo, senioridade, indústria e localização.
                </p>
                <Link
                  to="/apollo"
                  onClick={() => onOpenChange(false)}
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Abrir busca Apollo <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
