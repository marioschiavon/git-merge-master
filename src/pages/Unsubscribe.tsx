import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

type Status = "loading" | "valid" | "already" | "invalid" | "success" | "error";

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setStatus("invalid"); return; }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    fetch(`${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${token}`, {
      headers: { apikey: anonKey },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.valid === false && d.reason === "already_unsubscribed") setStatus("already");
        else if (d.valid) setStatus("valid");
        else setStatus("invalid");
      })
      .catch(() => setStatus("invalid"));
  }, [token]);

  const handleUnsubscribe = async () => {
    setSubmitting(true);
    try {
      const { data } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
      setStatus(data?.success ? "success" : "error");
    } catch { setStatus("error"); }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle className="text-center">Cancelar inscrição</CardTitle></CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "loading" && <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />}
          {status === "valid" && (
            <>
              <p className="text-muted-foreground">Deseja parar de receber nossos e-mails?</p>
              <Button onClick={handleUnsubscribe} disabled={submitting}>
                {submitting ? "Processando..." : "Confirmar cancelamento"}
              </Button>
            </>
          )}
          {status === "success" && (
            <div className="space-y-2">
              <CheckCircle className="mx-auto h-10 w-10 text-green-500" />
              <p className="text-muted-foreground">Inscrição cancelada com sucesso.</p>
            </div>
          )}
          {status === "already" && (
            <div className="space-y-2">
              <CheckCircle className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">Você já cancelou a inscrição anteriormente.</p>
            </div>
          )}
          {(status === "invalid" || status === "error") && (
            <div className="space-y-2">
              <XCircle className="mx-auto h-10 w-10 text-destructive" />
              <p className="text-muted-foreground">Link inválido ou expirado.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
