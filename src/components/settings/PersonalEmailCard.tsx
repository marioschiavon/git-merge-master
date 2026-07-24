import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface GrantRow {
  id: string;
  provider: "google" | "microsoft" | "imap";
  email: string;
  display_name: string | null;
  status: string;
  user_id: string;
  created_at: string;
}

const providerLabel = (p: string) =>
  p === "google" ? "Gmail" : p === "microsoft" ? "Outlook" : "IMAP";

export function PersonalEmailCard({ currentUserId }: { currentUserId: string | null }) {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState<string | null>(null);

  // Handle OAuth callback query params
  useEffect(() => {
    const url = new URL(window.location.href);
    const connected = url.searchParams.get("connected");
    const email = url.searchParams.get("email");
    const err = url.searchParams.get("connect_error");
    if (connected) {
      toast({ title: "Email conectado", description: email || "" });
    } else if (err) {
      toast({
        title: "Falha ao conectar",
        description:
          err === "slot_limit"
            ? "Limite de contas conectadas atingido no piloto (5 no total)."
            : err,
        variant: "destructive",
      });
    }
    if (connected || err) {
      url.searchParams.delete("connected");
      url.searchParams.delete("email");
      url.searchParams.delete("connect_error");
      window.history.replaceState({}, "", url.toString());
      qc.invalidateQueries({ queryKey: ["personal-email-grants"] });
    }
  }, [qc]);

  const { data: grants = [], isLoading } = useQuery({
    queryKey: ["personal-email-grants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_email_grants")
        .select("id, provider, email, display_name, status, user_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as GrantRow[];
    },
  });

  const disconnect = useMutation({
    mutationFn: async (row_id: string) => {
      const { error } = await supabase.functions.invoke("email-disconnect", {
        body: { grant_row_id: row_id },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Conta desconectada" });
      qc.invalidateQueries({ queryKey: ["personal-email-grants"] });
    },
    onError: (e: any) => {
      toast({ title: "Erro", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const connect = async (provider: "google" | "microsoft" | "imap") => {
    setConnecting(provider);
    try {
      const { data, error } = await supabase.functions.invoke("email-connect-start", {
        body: { provider, redirect_origin: window.location.origin },
      });
      if (error) throw error;
      const authUrl = (data as any)?.auth_url;
      if (!authUrl) throw new Error("URL de autorização não retornada");
      window.location.href = authUrl;
    } catch (e: any) {
      const msg =
        e?.message?.includes("slot_limit") || String(e).includes("slot_limit")
          ? "Limite de contas conectadas atingido no piloto (5 no total)."
          : String(e?.message || e);
      toast({ title: "Falha ao iniciar conexão", description: msg, variant: "destructive" });
      setConnecting(null);
    }
  };

  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Meu email
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte sua conta de email pessoal (Gmail, Outlook ou outra via IMAP)
            para que o Leaderei envie e responda em seu nome.
          </p>
        </div>
      </div>

      <div className="rounded-md bg-muted/40 border border-dashed p-3 text-xs text-muted-foreground flex gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <span>
          Apenas emails de <b>leads cadastrados</b> aparecem aqui no Leaderei.
          Emails de outros remetentes continuam apenas na sua caixa de entrada
          real, sem passar pelo app.
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => connect("google")}
          disabled={connecting !== null}
        >
          {connecting === "google" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Conectar Gmail
        </Button>
        <Button
          variant="outline"
          onClick={() => connect("microsoft")}
          disabled={connecting !== null}
        >
          {connecting === "microsoft" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Conectar Outlook
        </Button>
        <Button
          variant="outline"
          onClick={() => connect("imap")}
          disabled={connecting !== null}
        >
          {connecting === "imap" ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : null}
          Outro (IMAP)
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          Contas conectadas
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : grants.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            Nenhuma conta conectada ainda.
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {grants.map((g) => (
              <li
                key={g.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{g.email}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] py-0">
                      {providerLabel(g.provider)}
                    </Badge>
                    <Badge
                      variant={g.status === "active" ? "default" : "destructive"}
                      className="text-[10px] py-0"
                    >
                      {g.status}
                    </Badge>
                  </div>
                </div>
                {currentUserId === g.user_id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Desconectar ${g.email}?`)) {
                        disconnect.mutate(g.id);
                      }
                    }}
                    disabled={disconnect.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    (colega da empresa)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground pt-2 border-t">
        Integração de email via Nylas.
      </p>
    </div>
  );
}
