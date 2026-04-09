import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings as SettingsIcon } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Configurações</h1>
        <p className="text-muted-foreground">Configure sua conta e preferências</p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <SettingsIcon className="mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">Configurações gerais</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Em breve: perfil, notificações e preferências.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
