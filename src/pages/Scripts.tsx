import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useScriptTemplates, useCreateScript, useDeleteScript, useGenerateScript, useGenerateVariations, useSaveVariations, useScriptVariations } from "@/hooks/useScripts";
import { Sparkles, Plus, Trash2, Copy, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";

const segments = [
  { value: "advocacia", label: "Advocacia" },
  { value: "odontologia", label: "Odontologia" },
  { value: "contabilidade", label: "Contabilidade" },
  { value: "tecnologia", label: "Tecnologia" },
  { value: "consultoria", label: "Consultoria" },
  { value: "varejo", label: "Varejo" },
  { value: "industria", label: "Indústria" },
  { value: "saude", label: "Saúde" },
  { value: "educacao", label: "Educação" },
  { value: "geral", label: "Geral" },
];

const tones = [
  { value: "formal", label: "Formal" },
  { value: "consultivo", label: "Consultivo" },
  { value: "direto", label: "Direto" },
  { value: "amigavel", label: "Amigável" },
];

const channels = [
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "linkedin", label: "LinkedIn" },
];

export default function Scripts() {
  const { data: scripts = [], isLoading } = useScriptTemplates();
  const createScript = useCreateScript();
  const deleteScript = useDeleteScript();
  const generateScript = useGenerateScript();
  const generateVariations = useGenerateVariations();
  const saveVariations = useSaveVariations();

  const [generateOpen, setGenerateOpen] = useState(false);
  const [segment, setSegment] = useState("geral");
  const [channel, setChannel] = useState("email");
  const [tone, setTone] = useState("consultivo");
  const [companyContext, setCompanyContext] = useState("");
  const [generatedScript, setGeneratedScript] = useState<{ name: string; subject: string | null; script: string } | null>(null);

  const [variationsOpen, setVariationsOpen] = useState(false);
  const [variationsTemplateId, setVariationsTemplateId] = useState<string | null>(null);
  const [variationsBase, setVariationsBase] = useState("");
  const [generatedVariations, setGeneratedVariations] = useState<{ tone: string; text: string }[]>([]);

  const [filterSegment, setFilterSegment] = useState("all");

  const handleGenerate = async () => {
    const result = await generateScript.mutateAsync({ segment, channel, tone, companyContext: companyContext || undefined });
    setGeneratedScript(result);
  };

  const handleSaveGenerated = async () => {
    if (!generatedScript) return;
    await createScript.mutateAsync({
      name: generatedScript.name,
      segment,
      channel,
      tone,
      base_script: generatedScript.script,
      is_ai_generated: true,
    });
    setGeneratedScript(null);
    setGenerateOpen(false);
  };

  const handleGenerateVariations = async () => {
    const result = await generateVariations.mutateAsync({
      baseScript: variationsBase,
      count: 3,
      segment: undefined,
      channel: undefined,
    });
    setGeneratedVariations(result.variations);
  };

  const handleSaveVariations = async () => {
    if (!variationsTemplateId || generatedVariations.length === 0) return;
    await saveVariations.mutateAsync({ templateId: variationsTemplateId, variations: generatedVariations });
    setGeneratedVariations([]);
    setVariationsOpen(false);
  };

  const filtered = filterSegment === "all" ? scripts : scripts.filter((s: any) => s.segment === filterSegment);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Scripts IA</h1>
          <p className="text-muted-foreground">Biblioteca de scripts de abordagem por segmento</p>
        </div>
        <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
          <DialogTrigger asChild>
            <Button><Sparkles className="mr-2 h-4 w-4" />Gerar com IA</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Gerar Script com IA</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Segmento</Label>
                  <Select value={segment} onValueChange={setSegment}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{segments.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Canal</Label>
                  <Select value={channel} onValueChange={setChannel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{channels.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tom</Label>
                  <Select value={tone} onValueChange={setTone}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{tones.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Contexto adicional (opcional)</Label>
                <Input placeholder="Ex: empresa de software para clínicas..." value={companyContext} onChange={e => setCompanyContext(e.target.value)} />
              </div>
              <Button onClick={handleGenerate} disabled={generateScript.isPending} className="w-full">
                {generateScript.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando...</> : <><Sparkles className="mr-2 h-4 w-4" />Gerar Script</>}
              </Button>
              {generatedScript && (
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <p className="text-sm font-medium">{generatedScript.name}</p>
                    {generatedScript.subject && <p className="text-xs text-muted-foreground">Assunto: {generatedScript.subject}</p>}
                    <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded-md max-h-48 overflow-y-auto">{generatedScript.script}</pre>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveGenerated} disabled={createScript.isPending}>
                        <Plus className="mr-1 h-3 w-3" />Salvar na Biblioteca
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(generatedScript.script); toast.success("Copiado!"); }}>
                        <Copy className="mr-1 h-3 w-3" />Copiar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge variant={filterSegment === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilterSegment("all")}>Todos</Badge>
        {segments.map(s => (
          <Badge key={s.value} variant={filterSegment === s.value ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilterSegment(s.value)}>
            {s.label}
          </Badge>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">Nenhum script encontrado. Use "Gerar com IA" para criar seu primeiro!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((script: any) => (
            <Card key={script.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-sm">{script.name}</CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {segments.find(s => s.value === script.segment)?.label || script.segment} · {channels.find(c => c.value === script.channel)?.label || script.channel}
                    </CardDescription>
                  </div>
                  <div className="flex gap-1">
                    {script.is_ai_generated && <Badge variant="secondary" className="text-xs"><Sparkles className="mr-1 h-3 w-3" />IA</Badge>}
                    <Badge variant="outline" className="text-xs">{tones.find(t => t.value === script.tone)?.label || script.tone}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded max-h-32 overflow-y-auto">{script.base_script}</pre>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => {
                    setVariationsTemplateId(script.id);
                    setVariationsBase(script.base_script);
                    setGeneratedVariations([]);
                    setVariationsOpen(true);
                  }}>
                    <Sparkles className="mr-1 h-3 w-3" />Variações
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(script.base_script); toast.success("Copiado!"); }}>
                    <Copy className="mr-1 h-3 w-3" />Copiar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteScript.mutate(script.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={variationsOpen} onOpenChange={setVariationsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gerar Variações</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded-md max-h-32 overflow-y-auto">{variationsBase}</pre>
            <Button onClick={handleGenerateVariations} disabled={generateVariations.isPending} className="w-full">
              {generateVariations.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando...</> : <><Sparkles className="mr-2 h-4 w-4" />Gerar 3 Variações</>}
            </Button>
            {generatedVariations.length > 0 && (
              <div className="space-y-3">
                {generatedVariations.map((v, i) => (
                  <Card key={i}>
                    <CardContent className="p-3">
                      <Badge variant="outline" className="text-xs mb-2">{v.tone}</Badge>
                      <pre className="text-xs whitespace-pre-wrap">{v.text}</pre>
                    </CardContent>
                  </Card>
                ))}
                <Button size="sm" onClick={handleSaveVariations} disabled={saveVariations.isPending}>
                  <Plus className="mr-1 h-3 w-3" />Salvar Variações
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
