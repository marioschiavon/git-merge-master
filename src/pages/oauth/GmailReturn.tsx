import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function GmailReturn() {
  const [message, setMessage] = useState("Finalizando conexão com o Gmail…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const notify = (type: "appUserConnectorOAuthComplete" | "appUserConnectorOAuthFailed", reason?: string) => {
      window.opener?.postMessage({ type, connectorId: "google_mail", reason }, window.location.origin);
      window.close();
    };
    if (params.get("success") !== "true") {
      setMessage(params.get("error") ?? "A autorização não foi concluída.");
      notify("appUserConnectorOAuthFailed", params.get("error") ?? undefined);
      return;
    }
    const code = params.get("code");
    if (!code) {
      const reason = params.get("offline_access_allowed") === "false"
        ? "Acesso offline desativado no cliente OAuth do Gmail."
        : "Autorização sem código de troca.";
      setMessage(reason);
      window.opener?.postMessage({ type: "appUserConnectorOAuthFailed", connectorId: "google_mail", reason }, window.location.origin);
      return;
    }
    supabase.functions.invoke("gmail-oauth-complete", { body: { code } })
      .then(({ error }) => {
        if (error) throw error;
        notify("appUserConnectorOAuthComplete");
      })
      .catch(() => {
        setMessage("Não foi possível concluir a conexão.");
        notify("appUserConnectorOAuthFailed", "Não foi possível concluir a conexão.");
      });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
