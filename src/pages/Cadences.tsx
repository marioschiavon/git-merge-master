import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";

export default function Cadences() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Cadências</h1>
        <p className="text-muted-foreground">Configure sequências automáticas de contato</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <MessageSquare className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">Nenhuma cadência configurada</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie sua primeira cadência para automatizar a prospecção.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
