import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useLeadActivities } from "@/hooks/usePipedrive";
import { Mail, Phone, Building2, User, Calendar, Globe, MapPin } from "lucide-react";

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
};

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
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
}

interface LeadDetailProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadDetail({ lead, open, onOpenChange }: LeadDetailProps) {
  const { data: activities = [] } = useLeadActivities(lead?.id ?? null);

  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {lead.name}
            <Badge className={statusColors[lead.status] || ""}>
              {statusLabels[lead.status] || lead.status}
            </Badge>
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
