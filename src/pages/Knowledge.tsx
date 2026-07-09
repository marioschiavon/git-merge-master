import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useImportKickoff } from "@/hooks/useImportKickoff";
import {
  useKnowledgeItems,
  useCreateKnowledge,
  useDeleteKnowledge,
  useUpdateKnowledge,
  useExtractUrl,
  useUploadKnowledgeDoc,
  useHighlights,
  useSaveHighlights,
  useAiInstructions,
  useSaveAiInstructions,
} from "@/hooks/useKnowledge";
import {
  BookOpen,
  FileText,
  Globe,
  Plus,
  Trash2,
  Upload,
  Loader2,
  Save,
  Pencil,
  Star,
  Sparkles,
  Lock,
  Trophy,
  ClipboardPaste,
} from "lucide-react";

const typeLabels: Record<string, string> = {
  text: "Texto",
  document: "Documento",
  url: "URL",
};

const typeIcons: Record<string, any> = {
  text: BookOpen,
  document: FileText,
  url: Globe,
};


export default function Knowledge() {
  const { data: items = [], isLoading } = useKnowledgeItems();
  const { isMasterAdmin } = useAuth();
  const importKickoff = useImportKickoff();
  const createKnowledge = useCreateKnowledge();
  const deleteKnowledge = useDeleteKnowledge();
  const updateKnowledge = useUpdateKnowledge();
  const extractUrl = useExtractUrl();
  const uploadDoc = useUploadKnowledgeDoc();
  const { data: highlightsItem } = useHighlights();
  const saveHighlights = useSaveHighlights();
  const { data: aiInstructionsItem } = useAiInstructions();
  const saveAiInstructions = useSaveAiInstructions();

  const [kickoffOpen, setKickoffOpen] = useState(false);
  const [kickoffText, setKickoffText] = useState("");
  const [kickoffTitle, setKickoffTitle] = useState("");
  const hasKickoff = (items || []).some((i: any) => i.origin === "kickoff");
  const canImportKickoff = isMasterAdmin || !hasKickoff;


  // Highlights state
  const [highlightsText, setHighlightsText] = useState("");
  const [highlightsLoaded, setHighlightsLoaded] = useState(false);

  // AI Instructions state
  const [aiInstructionsText, setAiInstructionsText] = useState("");
  const [aiInstructionsLoaded, setAiInstructionsLoaded] = useState(false);

  // Load highlights when data arrives
  if (highlightsItem && !highlightsLoaded) {
    setHighlightsText(highlightsItem.content || "");
    setHighlightsLoaded(true);
  }
  if (aiInstructionsItem && !aiInstructionsLoaded) {
    setAiInstructionsText(aiInstructionsItem.content || "");
    setAiInstructionsLoaded(true);
  }

  // Text form
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");

  // URL form
  const [urlInput, setUrlInput] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  // File ref
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAddText = async () => {
    if (!textTitle.trim() || !textContent.trim()) return;
    await createKnowledge.mutateAsync({
      title: textTitle,
      content: textContent,
      type: "text",
    });
    setTextTitle("");
    setTextContent("");
  };

  const handleExtractUrl = async () => {
    if (!urlInput.trim()) return;
    const result = await extractUrl.mutateAsync(urlInput);
    if (result?.title && result?.content) {
      await createKnowledge.mutateAsync({
        title: result.title,
        content: result.content,
        type: "url",
        source_url: urlInput,
      });
    }
    setUrlInput("");
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const filePath = await uploadDoc.mutateAsync(file);
    // Call parse edge function
    const { data, error } = await (await import("@/integrations/supabase/client")).supabase.functions.invoke(
      "parse-knowledge-doc",
      { body: { file_path: filePath, file_name: file.name } }
    );
    if (!error && data?.content) {
      await createKnowledge.mutateAsync({
        title: data.title || file.name,
        content: data.content,
        type: "document",
        file_path: filePath,
      });
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSaveEdit = async (id: string) => {
    await updateKnowledge.mutateAsync({ id, content: editContent });
    setEditingId(null);
  };

  const nonHighlightItems = items.filter((i: any) => i.type !== "highlights" && i.type !== "ai_instructions");
  const textItems = nonHighlightItems.filter((i: any) => i.type === "text");
  const docItems = nonHighlightItems.filter((i: any) => i.type === "document");
  const urlItems = nonHighlightItems.filter((i: any) => i.type === "url");

  const handleSaveHighlights = async () => {
    await saveHighlights.mutateAsync({
      content: highlightsText,
      existingId: highlightsItem?.id,
    });
  };

  const handleSaveAiInstructions = async () => {
    await saveAiInstructions.mutateAsync({
      content: aiInstructionsText,
      existingId: aiInstructionsItem?.id,
    });
  };

  const handleImportKickoff = async () => {
    if (!kickoffText.trim() || kickoffText.trim().length < 100) return;
    await importKickoff.mutateAsync({ transcript: kickoffText, title: kickoffTitle || undefined });
    setKickoffOpen(false);
    setKickoffText("");
    setKickoffTitle("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Base de Conhecimento</h1>
          <p className="text-muted-foreground">
            Treine a IA com informações do seu produto para gerar mensagens personalizadas
          </p>
        </div>
        {canImportKickoff && (
          <Dialog open={kickoffOpen} onOpenChange={setKickoffOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <ClipboardPaste className="mr-2 h-4 w-4" />
                Colar transcrição de kickoff
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Importar transcrição de kickoff</DialogTitle>
                <DialogDescription>
                  Cole a transcrição completa da reunião de kickoff. A IA extrairá proposta de valor, ICP, dores, histórico e tom. O item resultante fica <strong>protegido</strong> — só o admin da Liderei pode editá-lo depois.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Título (opcional)</Label>
                  <Input value={kickoffTitle} onChange={(e) => setKickoffTitle(e.target.value)} placeholder="Kickoff — [Cliente]" />
                </div>
                <div>
                  <Label>Transcrição</Label>
                  <Textarea value={kickoffText} onChange={(e) => setKickoffText(e.target.value)} rows={12} placeholder="Cole aqui a transcrição da reunião…" />
                  <p className="mt-1 text-xs text-muted-foreground">{kickoffText.length} caracteres (mínimo 100).</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setKickoffOpen(false)}>Cancelar</Button>
                <Button onClick={handleImportKickoff} disabled={importKickoff.isPending || kickoffText.trim().length < 100}>
                  {importKickoff.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardPaste className="mr-2 h-4 w-4" />}
                  Importar e proteger
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>


      {/* AI Instructions Card */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Instruções de Abordagem da IA
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Diga em linguagem natural como a IA deve se posicionar, quando criar ganchos com o
            prospect, qual tom usar e o que NUNCA fazer. Use isso para evitar conexões sem sentido
            (ex: ligar shampoo a problema de articulação).
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder={`Ex:
- Vendemos shampoo profissional para cabelo cacheado. Só faça gancho quando o prospect for salão de beleza, distribuidora de cosméticos ou e-commerce do segmento.
- NUNCA conecte nosso produto a problemas que não sejam de cuidado capilar.
- Se o site do prospect não tiver relação com beleza/cosmético, NÃO force gancho — faça uma abordagem neutra de apresentação e pergunte se faz sentido conversar.
- Tom: brasileiro, descontraído, próximo. Pode usar 1 emoji discreto no WhatsApp.
- Sempre se referir ao produto como "nossa linha", nunca "shampoo X".`}
            value={aiInstructionsText}
            onChange={(e) => setAiInstructionsText(e.target.value)}
            rows={8}
          />
          <Button
            onClick={handleSaveAiInstructions}
            disabled={saveAiInstructions.isPending}
            size="sm"
          >
            {saveAiInstructions.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Salvar Instruções
          </Button>
        </CardContent>
      </Card>

      {/* Highlights Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="h-4 w-4 text-primary" />
            Destaques para Prospecção
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Informações-chave que a IA usará como argumentos de autoridade nos emails (matérias de jornal, patentes, prêmios, origem da empresa...)
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Ex: Empresa de origem americana, possuidora de patente mundial. Matéria no Jornal X: https://link.com. Prêmio Y recebido em 2024..."
            value={highlightsText}
            onChange={(e) => setHighlightsText(e.target.value)}
            rows={4}
          />
          <Button
            onClick={handleSaveHighlights}
            disabled={saveHighlights.isPending || !highlightsText.trim()}
            size="sm"
          >
            {saveHighlights.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Salvar Destaques
          </Button>
        </CardContent>
      </Card>

      <Tabs defaultValue="text">
        <TabsList>
          <TabsTrigger value="text">
            <BookOpen className="mr-2 h-4 w-4" />
            Texto ({textItems.length})
          </TabsTrigger>
          <TabsTrigger value="documents">
            <FileText className="mr-2 h-4 w-4" />
            Documentos ({docItems.length})
          </TabsTrigger>
          <TabsTrigger value="urls">
            <Globe className="mr-2 h-4 w-4" />
            URLs ({urlItems.length})
          </TabsTrigger>
        </TabsList>

        {/* TEXT TAB */}
        <TabsContent value="text" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Adicionar Texto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label>Título</Label>
                <Input
                  placeholder="Ex: Proposta de Valor, Diferenciais, FAQ..."
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Conteúdo</Label>
                <Textarea
                  placeholder="Descreva seu produto, serviço, proposta de valor, diferenciais competitivos, cases de sucesso..."
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  rows={6}
                />
              </div>
              <Button
                onClick={handleAddText}
                disabled={createKnowledge.isPending || !textTitle.trim() || !textContent.trim()}
              >
                {createKnowledge.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Adicionar
              </Button>
            </CardContent>
          </Card>

          {textItems.map((item: any) => (
            <KnowledgeCard
              key={item.id}
              item={item}
              editingId={editingId}
              editContent={editContent}
              onEdit={(id, content) => { setEditingId(id); setEditContent(content); }}
              onSave={handleSaveEdit}
              onCancelEdit={() => setEditingId(null)}
              onDelete={(id) => deleteKnowledge.mutate(id)}
              onEditContentChange={setEditContent}
              isSaving={updateKnowledge.isPending}
              isMasterAdmin={isMasterAdmin}
            />
          ))}
        </TabsContent>

        {/* DOCUMENTS TAB */}
        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload de Documento</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Faça upload de PDFs ou documentos de texto. A IA extrairá automaticamente o conteúdo.
              </p>
              <input
                type="file"
                ref={fileRef}
                accept=".pdf,.txt,.doc,.docx"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploadDoc.isPending}
              >
                {uploadDoc.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Selecionar Arquivo
              </Button>
            </CardContent>
          </Card>

          {docItems.map((item: any) => (
            <KnowledgeCard
              key={item.id}
              item={item}
              editingId={editingId}
              editContent={editContent}
              onEdit={(id, content) => { setEditingId(id); setEditContent(content); }}
              onSave={handleSaveEdit}
              onCancelEdit={() => setEditingId(null)}
              onDelete={(id) => deleteKnowledge.mutate(id)}
              onEditContentChange={setEditContent}
              isSaving={updateKnowledge.isPending}
              isMasterAdmin={isMasterAdmin}
            />
          ))}
        </TabsContent>

        {/* URLS TAB */}
        <TabsContent value="urls" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Extrair de URL</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Cole a URL do seu site e a IA extrairá automaticamente as informações relevantes.
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="https://seusite.com.br"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                />
                <Button
                  onClick={handleExtractUrl}
                  disabled={extractUrl.isPending || !urlInput.trim()}
                >
                  {extractUrl.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Globe className="mr-2 h-4 w-4" />
                  )}
                  Extrair
                </Button>
              </div>
            </CardContent>
          </Card>

          {urlItems.map((item: any) => (
            <KnowledgeCard
              key={item.id}
              item={item}
              editingId={editingId}
              editContent={editContent}
              onEdit={(id, content) => { setEditingId(id); setEditContent(content); }}
              onSave={handleSaveEdit}
              onCancelEdit={() => setEditingId(null)}
              onDelete={(id) => deleteKnowledge.mutate(id)}
              onEditContentChange={setEditContent}
              isSaving={updateKnowledge.isPending}
              isMasterAdmin={isMasterAdmin}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KnowledgeCard({
  item,
  editingId,
  editContent,
  onEdit,
  onSave,
  onCancelEdit,
  onDelete,
  onEditContentChange,
  isSaving,
  isMasterAdmin,
}: {
  item: any;
  editingId: string | null;
  editContent: string;
  onEdit: (id: string, content: string) => void;
  onSave: (id: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  onEditContentChange: (v: string) => void;
  isSaving: boolean;
  isMasterAdmin: boolean;
}) {
  const Icon = typeIcons[item.type] || BookOpen;
  const isEditing = editingId === item.id;
  const isKickoff = item.origin === "kickoff";
  const isHistoricalWins = item.knowledge_type === "historical_wins";
  const isProtected = (item.locked || isKickoff || isHistoricalWins) && !isMasterAdmin;

  return (
    <Card className={isProtected ? "border-amber-200/60 bg-amber-50/30" : undefined}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">{item.title}</h3>
            <Badge variant="outline" className="text-xs">
              {typeLabels[item.type]}
            </Badge>
            {isKickoff && (
              <Badge variant="outline" className="text-xs bg-amber-100 text-amber-900 border-amber-300 gap-1">
                <Lock className="h-3 w-3" /> Kickoff (protegido)
              </Badge>
            )}
            {isHistoricalWins && (
              <Badge variant="outline" className="text-xs bg-emerald-100 text-emerald-900 border-emerald-300 gap-1">
                <Trophy className="h-3 w-3" /> Aprendizados
              </Badge>
            )}
          </div>
          <div className="flex gap-1">
            {isEditing ? (
              <>
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>Cancelar</Button>
                <Button size="sm" onClick={() => onSave(item.id)} disabled={isSaving}>
                  <Save className="mr-1 h-3 w-3" /> Salvar
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="icon" variant="ghost"
                  onClick={() => onEdit(item.id, item.content)}
                  disabled={isProtected}
                  title={isProtected ? "Item protegido — apenas admin da Liderei pode editar" : "Editar"}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  onClick={() => onDelete(item.id)}
                  disabled={isProtected}
                  title={isProtected ? "Item protegido — apenas admin da Liderei pode excluir" : "Excluir"}
                >
                  <Trash2 className={`h-4 w-4 ${isProtected ? "text-muted-foreground" : "text-destructive"}`} />
                </Button>
              </>
            )}
          </div>
        </div>
        {item.source_url && (
          <p className="text-xs text-muted-foreground mb-2">Fonte: {item.source_url}</p>
        )}
        {isEditing ? (
          <Textarea value={editContent} onChange={(e) => onEditContentChange(e.target.value)} rows={6} />
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">{item.content}</p>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          {new Date(item.created_at).toLocaleDateString("pt-BR")}
        </p>
      </CardContent>
    </Card>
  );
}

