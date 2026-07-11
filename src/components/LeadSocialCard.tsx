import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Instagram, Linkedin, Facebook, RefreshCw, Building2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function LeadSocialCard({ leadId, companyId, enrichmentStatus, hasEnrichableSource = true }: { leadId: string; companyId: string; enrichmentStatus?: string | null; hasEnrichableSource?: boolean }) {
  const qc = useQueryClient();
  const isEnriching = enrichmentStatus === "pending" || enrichmentStatus === "processing";
  const { data: profiles = [] } = useQuery({
    queryKey: ["lead_social_profiles", leadId],
    queryFn: async () => {
      const { data } = await supabase.from("lead_social_profiles").select("*").eq("lead_id", leadId);
      return data || [];
    },
    refetchInterval: isEnriching ? 5000 : false,
  });
  const { data: insights } = useQuery({
    queryKey: ["lead_insights_summaries", leadId],
    queryFn: async () => {
      const { data } = await supabase.from("lead_insights")
        .select("linkedin_summary, instagram_summary").eq("lead_id", leadId).maybeSingle();
      return data || null;
    },
    refetchInterval: isEnriching ? 5000 : false,
  });

  const reEnqueue = useMutation({
    mutationFn: async () => {
      // Reset any stuck job for this lead, then create a fresh one and invoke immediately
      await supabase.from("lead_enrichment_jobs")
        .update({ status: "failed", error: "manually re-enqueued" })
        .eq("lead_id", leadId)
        .in("status", ["pending", "processing"]);
      const { data: job, error } = await supabase
        .from("lead_enrichment_jobs")
        .insert({ lead_id: leadId, company_id: companyId })
        .select("id").single();
      if (error) throw error;
      await supabase.from("leads").update({ enrichment_status: "pending" }).eq("id", leadId);
      // Kick off immediately (returns 202)
      if (job?.id) {
        supabase.functions.invoke("enrich-lead", { body: { job_id: job.id } }).catch(() => {});
      }
    },
    onSuccess: () => {
      toast({ title: "Reprocessamento iniciado", description: "Atualize em ~1 min." });
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
        {!hasEnrichableSource && profiles.length === 0 && (
          <div className="text-xs rounded border border-amber-300 bg-amber-50 text-amber-900 p-2">
            Nada para enriquecer: adicione ao lead ao menos um site ou uma URL de rede social (Instagram, Facebook, LinkedIn) e clique em <span className="font-medium">Reprocessar</span>.
          </div>
        )}
        {(insights?.linkedin_summary || insights?.instagram_summary) && (
          <div className="space-y-2 rounded-md border bg-muted/30 p-2">
            {insights?.linkedin_summary && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Linkedin className="h-3 w-3" /> Resumo LinkedIn (IA)
                </p>
                <p className="text-xs whitespace-pre-wrap">{insights.linkedin_summary}</p>
              </div>
            )}
            {insights?.instagram_summary && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Instagram className="h-3 w-3" /> Resumo Instagram (IA)
                </p>
                <p className="text-xs whitespace-pre-wrap">{insights.instagram_summary}</p>
              </div>
            )}
          </div>
        )}
        {profiles.length === 0 && hasEnrichableSource ? (
          <p className="text-xs text-muted-foreground">Nenhum perfil social raspado ainda.</p>
        ) : profiles.length === 0 ? null : (
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
                  {p.network === "instagram" && (
                    (() => {
                      const NINETY_D = 90 * 24 * 60 * 60 * 1000;
                      const all = Array.isArray(p.recent_posts) ? p.recent_posts : [];
                      const recent = all.filter((post: any) => {
                        const t = post?.timestamp ? Date.parse(post.timestamp) : NaN;
                        return Number.isFinite(t) && (Date.now() - t) <= NINETY_D;
                      });
                      const latest = all
                        .map((post: any) => (post?.timestamp ? Date.parse(post.timestamp) : NaN))
                        .filter((t: number) => Number.isFinite(t))
                        .sort((a: number, b: number) => b - a)[0];
                      if (recent.length === 0) {
                        return (
                          <div className="mt-2 border-t pt-2">
                            <Badge variant="outline" className="text-[10px]">
                              Sem posts nos últimos 90 dias{latest ? ` · último em ${new Date(latest).toLocaleDateString("pt-BR")}` : ""}
                            </Badge>
                          </div>
                        );
                      }
                      return (
                        <div className="mt-2 space-y-1 border-t pt-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Últimos posts ({recent.length}) · últimos 90 dias
                          </p>
                          {recent.slice(0, 5).map((post: any, i: number) => (
                            <div key={i} className="text-xs">
                              <p className="line-clamp-2 text-foreground/80">{post.caption || "(sem legenda)"}</p>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                {post.timestamp && <span>{new Date(post.timestamp).toLocaleDateString("pt-BR")}</span>}
                                {post.likes != null && <span>♥ {post.likes}</span>}
                                {post.comments != null && <span>💬 {post.comments}</span>}
                                {post.url && <a href={post.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Ver post →</a>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
