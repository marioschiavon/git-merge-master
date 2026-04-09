import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";

export default function Team() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Equipe</h1>
        <p className="text-muted-foreground">Gerencie os membros da sua equipe</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Users className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">Gestão de equipe</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Em breve você poderá convidar membros para sua empresa.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
