import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useWhatsAppConnectionAlert } from "@/hooks/useWhatsAppConnectionAlert";

/**
 * Aviso fixo quando alguma conexão de WhatsApp caiu.
 * Texto sempre neutro: pedimos reconexão, nunca afirmamos banimento.
 */
export function WhatsAppConnectionBanner() {
  const { data } = useWhatsAppConnectionAlert();
  if (!data || data.length === 0) return null;

  const names = data
    .map((i) => i.display_name || i.phone_number || "conexão")
    .join(", ");
  const suspect = data.some((i) => i.possiblyBlocked);

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>WhatsApp desconectado</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>
          {data.length > 1 ? "As conexões" : "A conexão"} {names}{" "}
          {data.length > 1 ? "caíram" : "caiu"}. Leia o QR-Code novamente para
          voltar a enviar e receber mensagens.
          {suspect && (
            <>
              {" "}
              O WhatsApp recusou este número mais de uma vez; se não conseguir
              reconectar, avalie usar outro chip.
            </>
          )}
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to="/settings/integrations">Reconectar</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
