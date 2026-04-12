import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useScriptVariations, useDeleteVariation } from "@/hooks/useScripts";
import { Sparkles, Trash2, Copy, Send, Pencil, ChevronDown } from "lucide-react";
import { toast } from "sonner";

interface ScriptCardProps {
  script: any;
  segments: { value: string; label: string }[];
  channels: { value: string; label: string }[];
  tones: { value: string; label: string }[];
  onEdit: (script: any) => void;
  onDelete: (id: string) => void;
  onUseCadence: (text: string, channel: string) => void;
  onOpenVariations: (script: any) => void;
}

export function ScriptCard({ script, segments, channels, tones, onEdit, onDelete, onUseCadence, onOpenVariations }: ScriptCardProps) {
  const { data: variations = [] } = useScriptVariations(script.id);
  const deleteVariation = useDeleteVariation();
  const [open, setOpen] = useState(false);

  return (
    <Card>
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
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => onUseCadence(script.base_script, script.channel)}>
            <Send className="mr-1 h-3 w-3" />Usar em Cadência
          </Button>
          <Button size="sm" variant="outline" onClick={() => onOpenVariations(script)}>
            <Sparkles className="mr-1 h-3 w-3" />Variações
          </Button>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(script.base_script); toast.success("Copiado!"); }}>
            <Copy className="mr-1 h-3 w-3" />Copiar
          </Button>
          <Button size="sm" variant="outline" onClick={() => onEdit(script)}>
            <Pencil className="mr-1 h-3 w-3" />Editar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(script.id)}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>

        {variations.length > 0 && (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-xs">
                <span>{variations.length} variação(ões) salva(s)</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 mt-2">
              {variations.map((v: any) => (
                <div key={v.id} className="border rounded p-2 space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">{v.tone}</Badge>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => { navigator.clipboard.writeText(v.variation_text); toast.success("Copiado!"); }}>
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => deleteVariation.mutate(v.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded max-h-28 overflow-y-auto">{v.variation_text}</pre>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
