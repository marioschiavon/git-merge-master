import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target } from "lucide-react";

export default function Leads() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
        <p className="text-muted-foreground">Gerencie seus leads importados do Pipedrive</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Target className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">Nenhum lead importado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecte seu Pipedrive em Configurações → Integrações para importar leads.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
