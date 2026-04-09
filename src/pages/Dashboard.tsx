import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Target, MessageSquare, Calendar, TrendingUp, Zap, Clock, CheckCircle2, Plug } from "lucide-react";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const activityIcons: Record<string, typeof MessageSquare> = {
  email: MessageSquare,
  call: Calendar,
  whatsapp: MessageSquare,
  linkedin: Zap,
  note: Clock,
  meeting: Calendar,
};

const chartConfig = {
  leads: { label: "Leads", color: "hsl(var(--primary))" },
};

export default function Dashboard() {
  const { leads, weeklyLeads, activeCadences, recentActivities, integration, isLoading } = useDashboardStats();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Visão geral da sua operação de SDR</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    { title: "Total de Leads", value: String(leads?.total || 0), icon: Target, change: `${leads?.new7d || 0} novos esta semana` },
    { title: "Leads Qualificados", value: String(leads?.byStatus?.qualified || 0), icon: CheckCircle2, change: `de ${leads?.total || 0} leads` },
    { title: "Cadências Ativas", value: String(activeCadences?.length || 0), icon: Zap, change: "em execução" },
    { title: "Taxa de Conversão", value: `${leads?.conversionRate || 0}%`, icon: TrendingUp, change: "converted / total" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Visão geral da sua operação de SDR</p>
        </div>
        {integration && (
          <Badge variant={integration.status === "active" ? "default" : "secondary"} className="gap-1">
            <Plug className="h-3 w-3" />
            Pipedrive {integration.status === "active" ? "conectado" : "inativo"}
            {integration.last_synced_at && (
              <span className="ml-1 text-xs opacity-75">
                · sync {formatDistanceToNow(new Date(integration.last_synced_at), { addSuffix: true, locale: ptBR })}
              </span>
            )}
          </Badge>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.change}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Leads por Semana</CardTitle>
          </CardHeader>
          <CardContent>
            {weeklyLeads && weeklyLeads.length > 0 ? (
              <ChartContainer config={chartConfig} className="h-[250px] w-full">
                <BarChart data={weeklyLeads}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="leads" fill="var(--color-leads)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum dado disponível ainda.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cadências Ativas</CardTitle>
          </CardHeader>
          <CardContent>
            {activeCadences && activeCadences.length > 0 ? (
              <div className="space-y-3">
                {activeCadences.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.type}</p>
                    </div>
                    <Badge variant="secondary">{c.enrolledCount} leads</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma cadência ativa. Crie uma cadência para começar.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Atividade Recente</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivities && recentActivities.length > 0 ? (
            <div className="space-y-3">
              {recentActivities.map((a) => {
                const Icon = activityIcons[a.type] || Clock;
                return (
                  <div key={a.id} className="flex items-start gap-3 text-sm">
                    <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1">
                      <p>{a.description || a.type}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(a.created_at), { addSuffix: true, locale: ptBR })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma atividade registrada ainda.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
