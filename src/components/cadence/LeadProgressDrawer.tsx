import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mail, Phone, Linkedin, Globe, MessageCircle, RotateCcw, ExternalLink, Bot, User } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLeadDrawerData } from "@/hooks/useCadenceLeadProgress";
import { useCadenceSteps, useResetEnrollment } from "@/hooks/useCadences";
import { LeadTimeline } from "./LeadTimeline";
import { LeadDetailContent } from "@/components/LeadDetailContent";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const initials = (name?: string | null) =>
  (name || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const intentColor: Record<string, string> = {
  interesse: "bg-green-100 text-green-800 border-green-200",
  agendar: "bg-blue-100 text-blue-800 border-blue-200",
  objecao: "bg-amber-100 text-amber-800 border-amber-200",
  duvida: "bg-purple-100 text-purple-800 border-purple-200",
  rejeicao: "bg-red-100 text-red-800 border-red-200",
  nao_interessado: "bg-red-100 text-red-800 border-red-200",
};

const statusLabel: Record<string, string> = {
  active: "Ativo",
  completed: "Concluído",
  replied: "Respondeu",
  bounced: "Bounce",
  paused: "Pausado",
};

export function LeadProgressDrawer({
  open,
  onOpenChange,
  row,
  cadenceId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: any | null;
  cadenceId: string | null;
}) {
  const navigate = useNavigate();
  const lead = row?.lead;
  const enrollment = row?.enrollment;
  const { data: steps } = useCadenceSteps(cadenceId);
  const { data: drawerData } = useLeadDrawerData(lead?.id || null, cadenceId);
  const resetEnrollment = useResetEnrollment();

  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="border-b p-6 pb-4 space-y-3">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                {initials(lead?.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg truncate">{lead?.name || "Sem nome"}</SheetTitle>
              <p className="text-sm text-muted-foreground truncate">
                {lead?.title ? `${lead.title} · ` : ""}
                {lead?.company_name || "—"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="text-xs">
                  Step {enrollment?.current_step}/{row.totalSteps}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {statusLabel[enrollment?.status] || enrollment?.status}
                </Badge>
                {row.lastIntent?.category && (
                  <Badge
                    variant="outline"
                    className={cn("text-xs border", intentColor[row.lastIntent.category] || "")}
                  >
                    {row.lastIntent.category}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {lead?.email && (
              <a href={`mailto:${lead.email}`} className="flex items-center gap-1 hover:text-foreground">
                <Mail className="h-3 w-3" /> {lead.email}
              </a>
            )}
            {lead?.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3" /> {lead.phone}
              </span>
            )}
            {lead?.website && (
              <a href={lead.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
                <Globe className="h-3 w-3" /> site
              </a>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate(`/conversations?lead=${lead?.id}`)}
            >
              <MessageCircle className="h-3 w-3 mr-1" /> Abrir conversa
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => resetEnrollment.mutate(enrollment.id)}
              disabled={resetEnrollment.isPending}
            >
              <RotateCcw className="h-3 w-3 mr-1" /> Re-testar
            </Button>
          </div>
        </SheetHeader>

        <Tabs defaultValue="timeline" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-3 grid w-auto grid-cols-4">
            <TabsTrigger value="timeline">Cadência</TabsTrigger>
            <TabsTrigger value="conversation">Conversa</TabsTrigger>
            <TabsTrigger value="activity">Atividades</TabsTrigger>
            <TabsTrigger value="profile">Cadastro</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1">
            <div className="p-6">
              <TabsContent value="timeline" className="mt-0">
                <LeadTimeline
                  steps={(steps || []) as any}
                  currentStep={enrollment?.current_step || 1}
                  execLogs={drawerData?.execLogs || []}
                />
              </TabsContent>

              <TabsContent value="conversation" className="mt-0 space-y-2">
                {!drawerData?.messages?.length && (
                  <p className="text-sm text-muted-foreground">Nenhuma mensagem.</p>
                )}
                {drawerData?.messages.map((m: any) => {
                  const isInbound = m.direction === "inbound";
                  const simulated = m.metadata?.simulated;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-lg border p-3 text-sm",
                        isInbound ? "bg-muted/40" : "bg-primary/5 border-primary/20",
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        {isInbound ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                        <span className="font-medium">{isInbound ? "Lead" : "Você/IA"}</span>
                        <Badge variant="outline" className="text-[10px] py-0">
                          {m.channel}
                        </Badge>
                        {m.ai_suggested && <Badge className="text-[10px] py-0">AI</Badge>}
                        {simulated && (
                          <Badge variant="outline" className="text-[10px] py-0 bg-amber-50 text-amber-800 border-amber-200">
                            🧪 Simulado
                          </Badge>
                        )}
                        <span className="ml-auto">
                          {format(new Date(m.sent_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-foreground">{m.content}</p>
                    </div>
                  );
                })}
              </TabsContent>

              <TabsContent value="activity" className="mt-0 space-y-2">
                {!drawerData?.activities?.length && !drawerData?.decisions?.length && (
                  <p className="text-sm text-muted-foreground">Sem atividade registrada.</p>
                )}
                {drawerData?.decisions?.map((d: any) => (
                  <div key={d.id} className="rounded border p-3 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">{d.action}</Badge>
                      {d.channel && <span>{d.channel}</span>}
                      {d.simulated && <Badge className="text-[10px] bg-amber-100 text-amber-800">🧪</Badge>}
                      <span className="ml-auto">{format(new Date(d.decided_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                    </div>
                    {d.rationale && <p className="mt-1 text-foreground">{d.rationale}</p>}
                  </div>
                ))}
                {drawerData?.activities?.map((a: any) => (
                  <div key={a.id} className="rounded border p-3 text-sm">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">{a.type}</Badge>
                      <span className="ml-auto">{format(new Date(a.created_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                    </div>
                    {a.description && <p className="mt-1 text-foreground">{a.description}</p>}
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="data" className="mt-0 space-y-2 text-sm">
                <DataRow label="Nome" value={lead?.name} />
                <DataRow label="Cargo" value={lead?.title} />
                <DataRow label="Empresa" value={lead?.company_name} />
                <DataRow label="Email" value={lead?.email} />
                <DataRow label="Telefone" value={lead?.phone} />
                <DataRow label="Website" value={lead?.website} />
                <DataRow label="Origem" value={lead?.source} />
                <DataRow label="Status" value={lead?.status} />
                <DataRow label="Score" value={lead?.score?.toString()} />
                <DataRow label="Canal preferido" value={lead?.preferred_channel} />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function DataRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-2 border-b py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground text-right truncate">{value || "—"}</span>
    </div>
  );
}
