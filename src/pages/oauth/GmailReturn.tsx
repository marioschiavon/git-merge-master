import { useEffect, useState } from "react";

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
    // Envia o código para a janela principal, que tem a sessão do usuário.
    setMessage("Concluindo… pode fechar esta janela se ela não fechar sozinha.");
    window.opener?.postMessage({ type: "gmailOAuthCode", connectorId: "google_mail", code }, window.location.origin);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
