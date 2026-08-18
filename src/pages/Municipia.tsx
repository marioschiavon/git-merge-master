import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MUNICIPIA_URL, useMunicipiaEnabled, fetchMunicipiaSession } from "@/hooks/useMunicipia";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const MUNICIPIA_ORIGIN = new URL(MUNICIPIA_URL).origin;

export default function Municipia() {
  const { data: integration, isLoading, refetch } = useMunicipiaEnabled();
  const { companyId } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data }) => setCompanyName(data?.name ?? null));
  }, [companyId]);

  // Handshake com o MunicipIA. O app filho pode ficar pronto antes ou depois de
  // nós, então além de responder ao "municipia:ready" enviamos a sessão de forma
  // proativa e repetida até o filho confirmar ("municipia:session-ok").
  const ackedRef = useRef(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ackedRef.current = false;

    const sendSession = async () => {
      if (cancelled || ackedRef.current) return;
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      const session = await fetchMunicipiaSession();
      if (!session) {
        if (!cancelled) setSessionError("Não foi possível gerar a sessão do MunicipIA.");
        return;
      }
      if (cancelled) return;
      setSessionError(null);
      win.postMessage(
        {
          type: "leaderei:session",
          token: session.token,
          company_id: session.company_id,
          ingest_url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/municipia-ingest`,
        },
        MUNICIPIA_ORIGIN,
      );
    };

    const handler = (event: MessageEvent) => {
      if (event.origin !== MUNICIPIA_ORIGIN) return;
      const type = event.data?.type;
      if (type === "municipia:ready") {
        ackedRef.current = false;
        void sendSession();
      } else if (type === "municipia:session-ok") {
        ackedRef.current = true;
      }
    };
    window.addEventListener("message", handler);

    // Reenvio proativo: cobre o caso do filho ter ficado pronto antes de nós.
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      if (ackedRef.current || attempts > 8) {
        clearInterval(interval);
        return;
      }
      void sendSession();
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("message", handler);
    };
  }, [companyId, integration?.enabled]);

  // If the iframe never loads, assume framing is blocked.
  useEffect(() => {
    const t = setTimeout(() => { if (!loaded) setBlocked(true); }, 8000);
    return () => clearTimeout(t);
  }, [loaded]);

  if (isLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!integration?.enabled) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <h1 className="text-lg font-semibold">MunicipIA</h1>
          <p className="text-sm text-muted-foreground">
            A integração com o MunicipIA não está habilitada para a empresa em que você está conectado
            {companyName ? <> (<strong>{companyName}</strong>)</> : null}.
          </p>
          <p className="text-sm text-muted-foreground">
            Se o acesso acabou de ser liberado, ele aparece automaticamente em alguns segundos. Se você tem mais de uma
            empresa, confirme se entrou com a conta correta — o acesso é liberado por empresa, não por usuário.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Verificar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">MunicipIA</h1>
          <p className="text-xs text-muted-foreground">
            Busque municípios e use "Enviar para o Leaderei" para importar os contatos como leads.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <a href={MUNICIPIA_URL} target="_blank" rel="noopener noreferrer">
            Abrir em nova aba <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>

      {blocked && !loaded ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            O MunicipIA não pôde ser exibido dentro do Leaderei. Abra em uma nova aba para continuar.
          </p>
          <Button asChild>
            <a href={MUNICIPIA_URL} target="_blank" rel="noopener noreferrer">
              Abrir MunicipIA <ExternalLink className="ml-1 h-4 w-4" />
            </a>
          </Button>
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          src={MUNICIPIA_URL}
          title="MunicipIA"
          className="flex-1 w-full border-0"
          onLoad={() => setLoaded(true)}
          allow="clipboard-write"
        />
      )}
    </div>
  );
}
