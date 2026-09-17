import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useWhatsAppConnectionAlert } from "@/hooks/useWhatsAppConnectionAlert";
import { describeDownFor, describeWhatsAppDownReason } from "@/lib/whatsapp-status";

/**
 * Aviso fixo quando alguma conexão de WhatsApp caiu.
 * Texto sempre neutro: pedimos reconexão, nunca afirmamos banimento.
 */
export function WhatsAppConnectionBanner() {
  const { data } = useWhatsAppConnectionAlert();
  if (!data || data.length === 0) return null;

  const anyRefused = data.some(
    (i) => describeWhatsAppDownReason(i.last_error).refused || i.possiblyBlocked,
  );

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>WhatsApp desconectado</AlertTitle>
      <AlertDescription className="space-y-2">
        <ul className="space-y-1">
          {data.map((i) => {
            const reason = describeWhatsAppDownReason(i.last_error);
            const downFor = describeDownFor(i.last_connected_at);
            return (
              <li key={i.id}>
                <strong>{i.display_name || i.phone_number || "Conexão"}</strong>
                {downFor ? ` está fora do ar ${downFor}` : " está fora do ar"}:{" "}
                {reason.text}. Leia o QR-Code novamente para voltar a enviar e
                receber mensagens.
              </li>
            );
          })}
        </ul>
        {anyRefused && (
          <p>
            Quando o WhatsApp recusa um número, quase sempre a causa é o ritmo
            de envio.{" "}
            <Link to="/guides/whatsapp" className="underline font-medium">
              Veja as boas práticas de envio
            </Link>{" "}
            antes de tentar de novo.
          </p>
        )}
        <div>
          <Button asChild size="sm" variant="outline">
            <Link to="/settings/integrations?wa=1">Reconectar</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
