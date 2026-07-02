import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import leadereiLogo from "@/assets/brand/leaderei-color.png";

export default function Onboarding() {
  const { session, companyId, loading, user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (!session) return <Navigate to="/auth" replace />;
  if (companyId) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("create_company_and_join", {
      p_name: name.trim(),
      p_slug: null as unknown as string,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Empresa criada!");
    // Force reload so useAuth re-fetches companyId
    window.location.href = "/dashboard";
    void data;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <img src={leadereiLogo} alt="Leaderei" className="mb-2 h-10 w-auto" />
          <CardTitle>Crie sua empresa</CardTitle>
          <CardDescription>
            Olá {user?.email}, vamos configurar seu workspace no Leaderei.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company-name">Nome da empresa</Label>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Minha Empresa"
                autoFocus
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !name.trim()}>
              {submitting ? "Criando..." : "Criar empresa e continuar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
