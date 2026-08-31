import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, ChevronLeft, ChevronRight, Search, Menu } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const files = import.meta.glob("/docs/manual/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

type Chapter = {
  slug: string;
  title: string;
  content: string;
  phase: string;
};

const PHASES: { label: string; match: (slug: string) => boolean }[] = [
  { label: "Introdução", match: (s) => s === "README" || s.startsWith("00") },
  { label: "Fase 1 — Configuração inicial", match: (s) => /^0[1-6]/.test(s) },
  { label: "Fase 2 — Operação", match: (s) => /^(0[7-9]|1[0-2])/.test(s) },
  { label: "Fase 3 — Relacionamento", match: (s) => /^1[3-6]/.test(s) },
  { label: "Fase 4 — Análise", match: (s) => /^1[7-9]/.test(s) },
];

function phaseOf(slug: string) {
  return PHASES.find((p) => p.match(slug))?.label ?? "Outros";
}

const chapters: Chapter[] = Object.entries(files)
  .map(([path, content]) => {
    const slug = path.split("/").pop()!.replace(/\.md$/, "");
    const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = slug === "README" ? "Visão geral do manual" : heading ?? slug;
    return { slug, title, content, phase: phaseOf(slug) };
  })
  .sort((a, b) => {
    if (a.slug === "README") return -1;
    if (b.slug === "README") return 1;
    return a.slug.localeCompare(b.slug, "pt-BR");
  });

export default function Manual() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  const current = chapters.find((c) => c.slug === slug) ?? chapters[0];
  const index = chapters.findIndex((c) => c.slug === current.slug);
  const prev = chapters[index - 1];
  const next = chapters[index + 1];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter(
      (c) => c.title.toLowerCase().includes(q) || c.content.toLowerCase().includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Chapter[]>();
    for (const c of filtered) {
      if (!map.has(c.phase)) map.set(c.phase, []);
      map.get(c.phase)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const go = (s: string) => {
    setNavOpen(false);
    navigate(`/guides/manual/${s}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toSlug = (href?: string) => {
    if (!href) return null;
    const m = href.match(/^\.?\/?([\w.-]+)\.md(#.*)?$/);
    return m ? m[1] : null;
  };

  const nav = (
    <nav className="space-y-5">
      {grouped.map(([phase, items]) => (
        <div key={phase} className="space-y-1">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {phase}
          </p>
          {items.map((c) => (
            <button
              key={c.slug}
              onClick={() => go(c.slug)}
              className={cn(
                "block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                c.slug === current.slug && "bg-accent font-medium text-accent-foreground",
              )}
            >
              {c.title}
            </button>
          ))}
        </div>
      ))}
      {grouped.length === 0 && (
        <p className="px-2 text-sm text-muted-foreground">Nenhum capítulo encontrado.</p>
      )}
    </nav>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-3">
        <Badge variant="outline" className="gap-1">
          <BookOpen className="h-3 w-3" />
          Guia
        </Badge>
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          Manual do Leaderei
        </h1>
        <p className="text-lg text-muted-foreground">
          Tudo sobre a plataforma, na ordem que um novo usuário deve seguir — da configuração
          inicial à análise dos resultados.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Índice */}
        <aside className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar no manual..."
              className="pl-9"
            />
          </div>

          <Button
            variant="outline"
            className="w-full justify-start lg:hidden"
            onClick={() => setNavOpen((v) => !v)}
          >
            <Menu className="mr-2 h-4 w-4" />
            {navOpen ? "Ocultar capítulos" : "Ver capítulos"}
          </Button>

          <div className={cn("lg:block", navOpen ? "block" : "hidden")}>
            <Card>
              <CardContent className="p-3">
                <ScrollArea className="max-h-[70vh] pr-2 lg:h-[70vh]">{nav}</ScrollArea>
              </CardContent>
            </Card>
          </div>
        </aside>

        {/* Conteúdo */}
        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="p-6 md:p-8">
              <article
                className={cn(
                  "max-w-none text-[15px] leading-relaxed text-foreground",
                  "[&_h1]:mb-4 [&_h1]:text-3xl [&_h1]:font-semibold [&_h1]:tracking-tight",
                  "[&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
                  "[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold",
                  "[&_p]:my-3",
                  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6",
                  "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-6",
                  "[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
                  "[&_strong]:font-semibold",
                  "[&_hr]:my-8 [&_hr]:border-border",
                  "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-muted/40 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:text-muted-foreground",
                  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]",
                  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4",
                  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
                  "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
                  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left",
                  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top",
                )}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children, ...props }) => {
                      const target = toSlug(href as string | undefined);
                      if (target && chapters.some((c) => c.slug === target)) {
                        return (
                          <a
                            href={`/guides/manual/${target}`}
                            onClick={(e) => {
                              e.preventDefault();
                              go(target);
                            }}
                            {...props}
                          >
                            {children}
                          </a>
                        );
                      }
                      return (
                        <a href={href} target="_blank" rel="noreferrer" {...props}>
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {current.content}
                </ReactMarkdown>
              </article>

              <Separator className="my-8" />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {prev ? (
                  <Button variant="outline" onClick={() => go(prev.slug)} className="justify-start">
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    <span className="truncate">{prev.title}</span>
                  </Button>
                ) : (
                  <span />
                )}
                {next && (
                  <Button variant="outline" onClick={() => go(next.slug)} className="justify-end">
                    <span className="truncate">{next.title}</span>
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
