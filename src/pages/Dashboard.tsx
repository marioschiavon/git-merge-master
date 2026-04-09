import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, MessageSquare, Calendar, TrendingUp } from "lucide-react";

const stats = [
  { title: "Leads Ativos", value: "0", icon: Target, change: "+0%" },
  { title: "Mensagens Enviadas", value: "0", icon: MessageSquare, change: "+0%" },
  { title: "Reuniões Agendadas", value: "0", icon: Calendar, change: "+0%" },
  { title: "Taxa de Conversão", value: "0%", icon: TrendingUp, change: "+0%" },
];

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral da sua operação de SDR</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.change} vs mês anterior</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cadências Ativas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Nenhuma cadência configurada. Configure sua primeira cadência para começar a automatizar a prospecção.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Atividade Recente</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Nenhuma atividade registrada ainda. As interações com leads aparecerão aqui.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
