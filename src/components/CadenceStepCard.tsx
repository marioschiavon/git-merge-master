import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScriptTemplates, useGenerateScript } from "@/hooks/useScripts";
import { Trash2, Mail, MessageCircle, Linkedin, Sparkles, Loader2, BookOpen } from "lucide-react";

const channelIcons: Record<string, any> = {
  email: Mail,
  whatsapp: MessageCircle,
  linkedin: Linkedin,
};

const channelLabels: Record<string, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  multi_channel: "Multi-canal",
};

const segments = [
  { value: "advocacia", label: "Advocacia" },
  { value: "odontologia", label: "Odontologia" },
  { value: "contabilidade", label: "Contabilidade" },
  { value: "tecnologia", label: "Tecnologia" },
  { value: "consultoria", label: "Consultoria" },
  { value: "varejo", label: "Varejo" },
  { value: "industria", label: "Indústria" },
  { value: "geral", label: "Geral" },
];

const tones = [
  { value: "formal", label: "Formal" },
  { value: "consultivo", label: "Consultivo" },
  { value: "direto", label: "Direto" },
  { value: "amigavel", label: "Amigável" },
];

interface CadenceStepCardProps {
  step: any;
  cadenceId: string;
  onUpsert: (step: any) => void;
  onDelete: (params: { id: string; cadenceId: string }) => void;
}

export function CadenceStepCard({ step, cadenceId, onUpsert, onDelete }: CadenceStepCardProps) {
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiSegment, setAiSegment] = useState("geral");
  const [aiTone, setAiTone] = useState("consultivo");
  const { data: scripts = [] } = useScriptTemplates();
  const generateScript = useGenerateScript();

  const Icon = channelIcons[step.channel] || Mail;

  const filteredScripts = scripts.filter((s: any) => s.channel === step.channel);

  const handleSelectScript = (scriptText: string) => {
    onUpsert({ ...step, template: scriptText });
    setAiDialogOpen(false);
  };

  const handleGenerateInline = async () => {
    const result = await generateScript.mutateAsync({
      segment: aiSegment,
      channel: step.channel,
      tone: aiTone,
    });
    onUpsert({ ...step, template: result.script });
    setAiDialogOpen(false);
  };

  return (
    <>
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono">#{step.step_order}</Badge>
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{channelLabels[step.channel]}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {step.delay_days === 0 ? "Imediato" : `+${step.delay_days} dia(s)`}
              </span>
              <Button variant="ghost" size="icon" onClick={() => onDelete({ id: step.id, cadenceId })}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Canal</Label>
              <Select value={step.channel} onValueChange={(v) => onUpsert({ ...step, channel: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="linkedin">LinkedIn</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Delay (dias)</Label>
              <Input
                type="number"
                min={0}
                className="h-8 text-xs"
                value={step.delay_days}
                onChange={(e) => onUpsert({ ...step, delay_days: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          {step.channel === "email" && (
            <div className="space-y-1">
              <Label className="text-xs">Assunto</Label>
              <Input
                className="h-8 text-xs"
                placeholder="Assunto do e-mail..."
                value={step.subject || ""}
                onBlur={(e) => onUpsert({ ...step, subject: e.target.value })}
                defaultValue={step.subject || ""}
              />
            </div>
          )}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Template da mensagem</Label>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setAiDialogOpen(true)}>
                <Sparkles className="h-3 w-3" />Preencher com IA
              </Button>
            </div>
            <Textarea
              className="text-xs min-h-[60px]"
              placeholder="Olá {{nome}}, ..."
              defaultValue={step.template}
              onBlur={(e) => onUpsert({ ...step, template: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Preencher Template</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="library">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="library"><BookOpen className="mr-1 h-3 w-3" />Biblioteca</TabsTrigger>
              <TabsTrigger value="generate"><Sparkles className="mr-1 h-3 w-3" />Gerar com IA</TabsTrigger>
            </TabsList>
            <TabsContent value="library" className="space-y-2 mt-3">
              {filteredScripts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum script de {channelLabels[step.channel]} na biblioteca.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {filteredScripts.map((s: any) => (
                    <Card key={s.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => handleSelectScript(s.base_script)}>
                      <CardContent className="p-3">
                        <p className="text-xs font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.base_script}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="generate" className="space-y-3 mt-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Segmento</Label>
                  <Select value={aiSegment} onValueChange={setAiSegment}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{segments.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tom</Label>
                  <Select value={aiTone} onValueChange={setAiTone}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{tones.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleGenerateInline} disabled={generateScript.isPending} className="w-full" size="sm">
                {generateScript.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando...</> : <><Sparkles className="mr-2 h-4 w-4" />Gerar e Aplicar</>}
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
