import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  useKnowledgeItems,
  useCreateKnowledge,
  useDeleteKnowledge,
  useUpdateKnowledge,
  useExtractUrl,
  useUploadKnowledgeDoc,
  useHighlights,
  useSaveHighlights,
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
  const createKnowledge = useCreateKnowledge();
  const deleteKnowledge = useDeleteKnowledge();
  const updateKnowledge = useUpdateKnowledge();
  const extractUrl = useExtractUrl();
  const uploadDoc = useUploadKnowledgeDoc();
  const { data: highlightsItem } = useHighlights();
  const saveHighlights = useSaveHighlights();

  // Highlights state
  const [highlightsText, setHighlightsText] = useState("");
  const [highlightsLoaded, setHighlightsLoaded] = useState(false);

  // Load highlights when data arrives
  if (highlightsItem && !highlightsLoaded) {
    setHighlightsText(highlightsItem.content || "");
    setHighlightsLoaded(true);
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

  const nonHighlightItems = items.filter((i: any) => i.type !== "highlights");
  const textItems = nonHighlightItems.filter((i: any) => i.type === "text");
  const docItems = nonHighlightItems.filter((i: any) => i.type === "document");
  const urlItems = nonHighlightItems.filter((i: any) => i.type === "url");

  const handleSaveHighlights = async () => {
    await saveHighlights.mutateAsync({
      content: highlightsText,
      existingId: highlightsItem?.id,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Base de Conhecimento</h1>
        <p className="text-muted-foreground">
          Treine a IA com informações do seu produto para gerar mensagens personalizadas
        </p>
      </div>

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
}) {
  const Icon = typeIcons[item.type] || BookOpen;
  const isEditing = editingId === item.id;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-medium text-sm">{item.title}</h3>
            <Badge variant="outline" className="text-xs">
              {typeLabels[item.type]}
            </Badge>
          </div>
          <div className="flex gap-1">
            {isEditing ? (
              <>
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={() => onSave(item.id)} disabled={isSaving}>
                  <Save className="mr-1 h-3 w-3" />
                  Salvar
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onEdit(item.id, item.content)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </>
            )}
          </div>
        </div>
        {item.source_url && (
          <p className="text-xs text-muted-foreground mb-2">
            Fonte: {item.source_url}
          </p>
        )}
        {isEditing ? (
          <Textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            rows={6}
          />
        ) : (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
            {item.content}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          {new Date(item.created_at).toLocaleDateString("pt-BR")}
        </p>
      </CardContent>
    </Card>
  );
}
