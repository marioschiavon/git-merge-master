import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function Reports() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Relatórios</h1>
        <p className="text-muted-foreground">Acompanhe a performance das suas cadências</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <BarChart3 className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">Sem dados ainda</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Os relatórios aparecerão quando houver cadências em execução.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
