import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Instagram, Linkedin, Facebook, RefreshCw, Building2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function LeadSocialCard({ leadId, companyId, enrichmentStatus }: { leadId: string; companyId: string; enrichmentStatus?: string | null }) {
  const qc = useQueryClient();
  const { data: profiles = [] } = useQuery({
    queryKey: ["lead_social_profiles", leadId],
    queryFn: async () => {
      const { data } = await supabase.from("lead_social_profiles").select("*").eq("lead_id", leadId);
      return data || [];
    },
  });

  const reEnqueue = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lead_enrichment_jobs").insert({ lead_id: leadId, company_id: companyId });
      if (error && !String(error.message).includes("duplicate")) throw error;
      await supabase.from("leads").update({ enrichment_status: "pending" }).eq("id", leadId);
    },
    onSuccess: () => {
      toast({ title: "Reprocessamento agendado", description: "Vai rodar em até 1 min." });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead_social_profiles", leadId] });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const iconFor = (n: string) => {
    if (n === "instagram") return <Instagram className="h-4 w-4" />;
    if (n === "facebook") return <Facebook className="h-4 w-4" />;
    if (n === "linkedin_company") return <Building2 className="h-4 w-4" />;
    return <Linkedin className="h-4 w-4" />;
  };
  const label: Record<string, string> = {
    instagram: "Instagram", facebook: "Facebook",
    linkedin_person: "LinkedIn (pessoa)", linkedin_company: "LinkedIn (empresa)",
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Redes sociais & enriquecimento</h4>
          <div className="flex items-center gap-2">
            {enrichmentStatus && <Badge variant="secondary" className="text-[10px]">{enrichmentStatus}</Badge>}
            <Button size="sm" variant="ghost" onClick={() => reEnqueue.mutate()} disabled={reEnqueue.isPending}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${reEnqueue.isPending ? "animate-spin" : ""}`} />
              Reprocessar
            </Button>
          </div>
        </div>
        {profiles.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum perfil social raspado ainda.</p>
        ) : (
          <div className="space-y-2">
            {profiles.map((p: any) => (
              <div key={p.id} className="flex items-start gap-2 text-sm border rounded p-2">
                <div className="mt-0.5">{iconFor(p.network)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{label[p.network] || p.network}</span>
                    {p.followers != null && <Badge variant="outline" className="text-[10px]">{p.followers} seguidores</Badge>}
                  </div>
                  {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate block">{p.url}</a>}
                  {p.bio && <p className="text-xs text-muted-foreground line-clamp-3 mt-1">{p.bio}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
