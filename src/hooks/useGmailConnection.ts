import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface EmailGrantRow {
  id: string;
  provider: "google" | "microsoft" | "imap";
  transport: string;
  email: string;
  display_name: string | null;
  status: string;
  user_id: string;
  created_at: string;
}

export function useEmailGrants() {
  return useQuery({
    queryKey: ["personal-email-grants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_email_grants")
        .select("id, provider, transport, email, display_name, status, user_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as EmailGrantRow[];
    },
  });
}

export function useCurrentUserId() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setId(data.user?.id ?? null));
  }, []);
  return id;
}

export function useGmailConnection() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  const { data: grants = [], isLoading } = useEmailGrants();
  const [connecting, setConnecting] = useState(false);

  const gmailGrants = grants.filter((g) => g.transport === "gmail");
  const mine = gmailGrants.find((g) => g.user_id === userId) ?? null;

  const connect = async () => {
    const popup = window.open("", "leaderei-gmail-oauth", "width=600,height=720");
    if (!popup) {
      toast({ title: "Pop-up bloqueado", description: "Permita pop-ups e tente novamente.", variant: "destructive" });
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-oauth-start", {
        body: { origin: window.location.origin },
      });
      if (error) throw error;
      const done = new Promise<void>((resolve, reject) => {
        let poll: number | undefined;
        const cleanup = () => {
          window.removeEventListener("message", onMsg);
          if (poll !== undefined) window.clearInterval(poll);
        };
        const onMsg = (ev: MessageEvent) => {
          const t = ev.data?.type;
          if (ev.origin !== window.location.origin || ev.source !== popup || ev.data?.connectorId !== "google_mail") return;
          if (t !== "appUserConnectorOAuthComplete" && t !== "appUserConnectorOAuthFailed") return;
          cleanup();
          if (t === "appUserConnectorOAuthComplete") resolve();
          else { popup.close(); reject(new Error(ev.data?.reason ?? "Falha na conexão.")); }
        };
        window.addEventListener("message", onMsg);
        poll = window.setInterval(() => {
          if (!popup.closed) return;
          cleanup();
          reject(new Error("Janela fechada antes de concluir."));
        }, 500);
      });
      popup.location.href = (data as any).authorizationUrl;
      await done;
      toast({
        title: mine ? "Gmail reconectado" : "Gmail conectado",
        description: "Sua caixa já pode enviar pelas cadências.",
      });
      qc.invalidateQueries({ queryKey: ["personal-email-grants"] });
    } catch (e: any) {
      popup.close();
      toast({ title: "Falha ao conectar Gmail", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = useMutation({
    mutationFn: async (row_id: string) => {
      const { error } = await supabase.functions.invoke("email-disconnect", { body: { grant_row_id: row_id } });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Conta desconectada" });
      qc.invalidateQueries({ queryKey: ["personal-email-grants"] });
    },
    onError: (e: any) => toast({ title: "Erro", description: String(e?.message || e), variant: "destructive" }),
  });

  return { grants, gmailGrants, mine, userId, isLoading, connecting, connect, disconnect };
}
