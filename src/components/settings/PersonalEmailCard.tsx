import { Mail, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useGmailConnection } from "@/hooks/useGmailConnection";

const statusLabel = (s: string) =>
  s === "active" ? "Ativa" : s === "expired" ? "Renovar acesso" : s === "error" ? "Erro" : s;

export function PersonalEmailCard() {
  const { grants, mine, userId, isLoading, connecting, connect, disconnect } = useGmailConnection();
  const needsRenew = mine && mine.status !== "active";

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Meu Gmail
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte sua conta Gmail para que o Leaderei envie e responda em seu nome.
        </p>
      </div>

      <div className="rounded-md bg-muted/40 border border-dashed p-3 text-xs text-muted-foreground flex gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <span>
          O Leaderei usa sua caixa para enviar aos <b>leads cadastrados</b>. Emails de outros
          remetentes continuam apenas na sua caixa de entrada real.
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={connect} disabled={connecting}>
          {connecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {needsRenew ? "Reconectar Gmail" : mine ? "Conectar outra vez" : "Conectar Gmail"}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Contas conectadas</div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : grants.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">Nenhuma conta conectada ainda.</div>
        ) : (
          <ul className="divide-y rounded-md border">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{g.email}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] py-0">
                      {g.transport === "gmail" ? "Gmail" : "Legado"}
                    </Badge>
                    <Badge
                      variant={g.status === "active" ? "default" : "destructive"}
                      className="text-[10px] py-0"
                    >
                      {statusLabel(g.status)}
                    </Badge>
                  </div>
                </div>
                {userId === g.user_id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Desconectar ${g.email}?`)) disconnect.mutate(g.id);
                    }}
                    disabled={disconnect.isPending}
                    aria-label={`Desconectar ${g.email}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">(colega da empresa)</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
