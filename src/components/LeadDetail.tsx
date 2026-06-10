import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useLeadActivities, useDeleteLead } from "@/hooks/usePipedrive";
import { useLeadInsights, useAnalyzeWebsite } from "@/hooks/useLeadInsights";
import { SlotHoldsCard } from "@/components/SlotHoldsCard";
import { BookingCard } from "@/components/BookingCard";
import { LeadSocialCard } from "@/components/LeadSocialCard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Phone, Building2, User, Calendar, Globe, MapPin, Search, Lightbulb, Target, Package, Star, MessageSquare, Loader2, Trash2, CalendarClock, MessageCircle, Sparkles } from "lucide-react";


const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  contacted: "bg-yellow-100 text-yellow-800",
  qualified: "bg-green-100 text-green-800",
  unqualified: "bg-red-100 text-red-800",
  converted: "bg-purple-100 text-purple-800",
};

const statusLabels: Record<string, string> = {
  new: "Novo",
  contacted: "Contatado",
  qualified: "Qualificado",
  unqualified: "Desqualificado",
  converted: "Convertido",
};

const activityLabels: Record<string, string> = {
  email: "Email",
  call: "Ligação",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  note: "Nota",
  meeting: "Reunião",
  referral: "Indicação",
};

const referralStageLabels: Record<string, string> = {
  novo_indicado: "Novo indicado",
  encaminhado_para_decisor: "Encaminhado ao decisor",
  aguardando_contato_decisor: "Aguardando contato do decisor",
  aguardando_encaminhamento_interno: "Aguardando encaminhamento",
  contato_errado: "Contato errado",
  tentando_identificar_decisor: "Identificando decisor",
  sem_acesso_decisor: "Sem acesso ao decisor",
};

interface Lead {
  id: string;
  company_id?: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp?: string | null;
  company_name: string | null;
  title: string | null;
  website: string | null;
  address: string | null;
  status: string;
  score: number | null;
  source: string | null;
  last_synced_at: string | null;
  created_at: string;
  pipedrive_data: any;
  enrichment_status?: string | null;
  referral_source_lead_id?: string | null;
  referral_role?: string | null;
  referral_stage?: string | null;
  referral_context?: string | null;
  referral_permission_to_mention?: boolean | null;
  preferred_channel?: string | null;
  handoff_required?: boolean | null;
  handoff_reason?: string | null;
  handoff_at?: string | null;
  call_requested_at?: string | null;
}



interface LeadDetailProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadDetail({ lead, open, onOpenChange }: LeadDetailProps) {
  const { data: activities = [] } = useLeadActivities(lead?.id ?? null);
  const { data: insightData, isLoading: insightsLoading } = useLeadInsights(lead?.id ?? null);
  const analyzeWebsite = useAnalyzeWebsite();
  const deleteLead = useDeleteLead();

  if (!lead) return null;

  const insights = insightData?.insights as any;


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 flex-wrap">
              {lead.name}
              <Badge className={statusColors[lead.status] || ""}>
                {statusLabels[lead.status] || lead.status}
              </Badge>
              {lead.referral_role === "indicador" && (
                <Badge variant="outline" className="border-amber-300 text-amber-800">Indicador</Badge>
              )}
              {lead.referral_role === "gatekeeper" && (
                <Badge variant="outline" className="border-slate-300 text-slate-700">Gatekeeper</Badge>
              )}
              {lead.referral_role === "decisor" && (
                <Badge variant="outline" className="border-emerald-300 text-emerald-800">Indicado</Badge>
              )}
              {lead.handoff_required && (
                <Badge variant="destructive" title={lead.handoff_reason || undefined}>🚨 Handoff humano</Badge>
              )}
              {lead.call_requested_at && (
                <Badge variant="outline" className="border-blue-300 text-blue-800">📞 Pediu ligação</Badge>
              )}
            </span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" title="Excluir lead">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir lead?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Isso removerá <strong>{lead.name}</strong>, suas inscrições em cadências, conversas, mensagens e todo o histórico. Esta ação não pode ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={async () => {
                      await deleteLead.mutateAsync(lead.id);
                      onOpenChange(false);
                    }}
                  >
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Contact info */}
          <div className="space-y-2">
            {lead.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${lead.email}`} className="text-primary hover:underline">{lead.email}</a>
              </div>
            )}
            {lead.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{lead.phone}</span>
              </div>
            )}
            {lead.company_name && (
              <div className="flex items-center gap-2 text-sm">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <span>{lead.company_name}</span>
              </div>
            )}
            {lead.title && (
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>{lead.title}</span>
              </div>
            )}
            {lead.website && (
              <div className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{lead.website.replace(/^https?:\/\//, "")}</a>
              </div>
            )}
            {lead.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{lead.address}</span>
              </div>
            )}
          </div>

          <Separator />

          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Origem</span>
              <p className="font-medium">{lead.source || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Score</span>
              <p className="font-medium">{lead.score ?? "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Criado em</span>
              <p className="font-medium">{new Date(lead.created_at).toLocaleDateString("pt-BR")}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Última sync</span>
              <p className="font-medium">
                {lead.last_synced_at ? new Date(lead.last_synced_at).toLocaleDateString("pt-BR") : "—"}
              </p>
            </div>
          </div>

          {(lead.referral_role || lead.referral_source_lead_id || lead.referral_stage) && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Indicação</h3>
                {lead.referral_stage && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Estágio: </span>
                    <span className="font-medium">{referralStageLabels[lead.referral_stage] || lead.referral_stage}</span>
                  </div>
                )}
                {lead.referral_source_lead_id && (
                  <div className="text-sm text-muted-foreground">
                    Indicado por outro lead da mesma empresa.
                  </div>
                )}
                {lead.referral_context && (
                  <p className="text-sm italic text-muted-foreground">"{lead.referral_context}"</p>
                )}
                {lead.referral_permission_to_mention !== null && lead.referral_permission_to_mention !== undefined && (
                  <div className="text-xs text-muted-foreground">
                    Permissão para citar indicador: {lead.referral_permission_to_mention ? "Sim" : "Não"}
                  </div>
                )}
              </div>
            </>
          )}

          <Separator />


          {/* Insights Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Lightbulb className="h-4 w-4" />
                Insights do Prospect
              </h3>
              {lead.website && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => analyzeWebsite.mutate(lead.id)}
                  disabled={analyzeWebsite.isPending}
                >
                  {analyzeWebsite.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Search className="h-3.5 w-3.5 mr-1" />
                  )}
                  {insights ? "Reanalisar" : "Analisar Website"}
                </Button>
              )}
            </div>

            {!lead.website && (
              <p className="text-sm text-muted-foreground">
                Preencha o website do lead para gerar insights automáticos.
              </p>
            )}

            {lead.website && insightsLoading && (
              <p className="text-sm text-muted-foreground">Carregando insights...</p>
            )}

            {lead.website && !insightsLoading && !insights && !analyzeWebsite.isPending && (
              <p className="text-sm text-muted-foreground">
                Clique em "Analisar Website" para gerar insights sobre este prospect.
              </p>
            )}

            {insights && (
              <div className="space-y-3">
                {/* Resumo */}
                {insights.resumo && (
                  <div className="rounded-md border p-3 bg-muted/30">
                    <p className="text-sm">{insights.resumo}</p>
                  </div>
                )}

                {/* Proposta de valor */}
                {insights.proposta_valor && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Target className="h-3 w-3" /> Proposta de Valor
                    </p>
                    <p className="text-sm">{insights.proposta_valor}</p>
                  </div>
                )}

                {/* Produtos */}
                {insights.produtos?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Package className="h-3 w-3" /> Produtos/Serviços
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {insights.produtos.map((p: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">{p}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Diferenciais */}
                {insights.diferenciais?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <Star className="h-3 w-3" /> Diferenciais
                    </p>
                    <ul className="text-sm list-disc list-inside space-y-0.5">
                      {insights.diferenciais.map((d: string, i: number) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Pain Points */}
                {insights.pain_points?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">🎯 Possíveis Dores</p>
                    <ul className="text-sm list-disc list-inside space-y-0.5">
                      {insights.pain_points.map((p: string, i: number) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Sugestões de abordagem */}
                {insights.oportunidades_abordagem?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> Sugestões de Abordagem
                    </p>
                    {insights.oportunidades_abordagem.map((o: any, i: number) => (
                      <div key={i} className="rounded-md border p-2.5 space-y-1">
                        <p className="text-xs font-medium text-primary">{o.gancho}</p>
                        <p className="text-sm text-muted-foreground italic">"{o.mensagem_sugerida}"</p>
                      </div>
                    ))}
                  </div>
                )}

                {insightData?.analyzed_at && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Analisado em {new Date(insightData.analyzed_at).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Agendamento */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4" />
              Agendamento
            </h3>
            <BookingCard leadId={lead.id} />
            <SlotHoldsCard leadId={lead.id} />
          </div>

          <Separator />

          {/* Redes sociais */}
          {lead.company_id && (
            <LeadSocialCard leadId={lead.id} companyId={lead.company_id} enrichmentStatus={lead.enrichment_status} />
          )}

          <Separator />


          {/* Activities */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Atividades</h3>
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma atividade registrada.</p>
            ) : (
              <div className="space-y-3">
                {activities.map((act: any) => (
                  <div key={act.id} className="flex gap-3 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="font-medium">{activityLabels[act.type] || act.type}</p>
                      {act.description && <p className="text-muted-foreground">{act.description}</p>}
                      <p className="text-xs text-muted-foreground">
                        {new Date(act.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
