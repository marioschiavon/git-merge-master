import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const integrations = [
  { name: "Pipedrive", description: "Importe leads e sincronize atividades", connected: false },
  { name: "WhatsApp Business", description: "Envie mensagens via WhatsApp", connected: false },
  { name: "LinkedIn", description: "Conecte e envie mensagens no LinkedIn", connected: false },
  { name: "Email (SMTP)", description: "Configure o envio de emails", connected: false },
  { name: "Twilio (Ligações)", description: "Faça e receba ligações VoIP", connected: false },
  { name: "Google Calendar", description: "Agende reuniões automaticamente", connected: false },
];

export default function Integrations() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Integrações</h1>
        <p className="text-muted-foreground">Conecte suas ferramentas para automação completa</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {integrations.map((i) => (
          <Card key={i.name}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{i.name}</CardTitle>
                <Badge variant={i.connected ? "default" : "secondary"}>
                  {i.connected ? "Conectado" : "Desconectado"}
                </Badge>
              </div>
              <CardDescription>{i.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" disabled>
                {i.connected ? "Configurar" : "Conectar"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
