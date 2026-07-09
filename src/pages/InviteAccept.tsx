import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import leadereiLogo from "@/assets/brand/leaderei-color.png";

type Status = "loading" | "pending" | "expired" | "accepted" | "cancelled" | "not_found" | "success";

interface InviteInfo {
  company_id: string;
  company_name: string;
  role: "company_admin" | "user";
  status: string;
}

const roleLabel = (r: string) =>
  r === "company_admin" ? "Admin da empresa" : r === "user" ? "Usuário" : r;

const formSchema = z
  .object({
    full_name: z.string().trim().min(2, "Nome muito curto").max(100),
    email: z.string().trim().email("Email inválido").max(255),
    password: z.string().min(6, "Senha deve ter ao menos 6 caracteres").max(72),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "As senhas não conferem",
    path: ["confirm"],
  });

export default function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("not_found");
      return;
    }
    (async () => {
      const { data, error } = await (supabase as any).rpc("get_invite_by_token", { _token: token });
      if (error) {
        setStatus("not_found");
        return;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.status === "not_found") {
        setStatus("not_found");
        return;
      }
      setInvite(row as InviteInfo);
      setStatus(row.status as Status);
    })();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = formSchema.safeParse({ full_name: fullName, email, password, confirm });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0].message);
      return;
    }
    if (!token) return;
    setSubmitting(true);
    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          data: { full_name: parsed.data.full_name },
          emailRedirectTo: `${window.location.origin}/auth`,
        },
      });
      if (signUpError) throw signUpError;
      const userId = signUpData.user?.id;
      if (!userId) throw new Error("Não foi possível criar o usuário");

      const { error: acceptError } = await (supabase as any).rpc("accept_company_invite", {
        _token: token,
        _user_id: userId,
      });
      if (acceptError) throw acceptError;

      // Sign out so user goes through normal login (in case session was auto-created)
      await supabase.auth.signOut();
      setStatus("success");
    } catch (err: any) {
      toast.error(err?.message ?? "Erro ao aceitar convite");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 items-center justify-center">
            <img src={leadereiLogo} alt="Leaderei" className="h-10 w-auto" />
          </div>
          {status === "loading" && <CardDescription>Validando convite...</CardDescription>}
          {status === "pending" && invite && (
            <>
              <CardTitle>Você foi convidado</CardTitle>
              <CardDescription>
                Para <strong>{invite.company_name}</strong> como{" "}
                <Badge variant="secondary">{roleLabel(invite.role)}</Badge>
              </CardDescription>
            </>
          )}
          {status === "success" && (
            <>
              <CardTitle className="flex items-center justify-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                Conta criada!
              </CardTitle>
              <CardDescription>Agora faça login para acessar sua empresa</CardDescription>
            </>
          )}
        </CardHeader>
        <CardContent>
          {status === "loading" && (
            <div className="flex justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {status === "not_found" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Convite inválido</AlertTitle>
              <AlertDescription>
                Este link não é válido. Peça um novo convite ao administrador.
              </AlertDescription>
            </Alert>
          )}

          {status === "expired" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Convite expirado</AlertTitle>
              <AlertDescription>
                Este convite expirou. Peça um novo ao administrador da empresa.
              </AlertDescription>
            </Alert>
          )}

          {status === "cancelled" && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Convite cancelado</AlertTitle>
              <AlertDescription>
                Este convite foi cancelado. Fale com o administrador da empresa.
              </AlertDescription>
            </Alert>
          )}

          {status === "accepted" && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Convite já utilizado</AlertTitle>
              <AlertDescription>
                Esta conta já foi criada. Faça login para continuar.
              </AlertDescription>
            </Alert>
          )}

          {(status === "accepted" || status === "success") && (
            <Button className="mt-4 w-full" onClick={() => navigate("/auth")}>
              Ir para login
            </Button>
          )}

          {status === "pending" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="full_name">Nome completo</Label>
                <Input
                  id="full_name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmar senha</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Criando conta..." : "Criar conta e entrar na empresa"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
