import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import logo from "@/assets/brand/leaderei-color.png";
import termos from "@/content/legal/termos.md?raw";
import privacidade from "@/content/legal/privacidade.md?raw";

export const LEGAL_VERSION = "Versão 1.0 · Vigente a partir de 01/10/2026";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const textOf = (children: React.ReactNode): string =>
  Array.isArray(children) ? children.map(textOf).join("") : typeof children === "string" ? children : (children as any)?.props ? textOf((children as any).props.children) : "";

export default function LegalPage({ kind }: { kind: "termos" | "privacidade" }) {
  const md = kind === "termos" ? termos : privacidade;
  const title = kind === "termos" ? "Termos de Uso" : "Política de Privacidade";

  useEffect(() => {
    document.title = `${title} — Leaderei`;
    window.scrollTo(0, 0);
  }, [title]);

  const toc = useMemo(
    () => md.split("\n").filter((l) => /^#{1,2} /.test(l)).map((l) => {
      const level = l.startsWith("## ") ? 2 : 1;
      const text = l.replace(/^#+ /, "").replace(/\*/g, "");
      return { level, text, id: slugify(text) };
    }),
    [md],
  );

  const H = (Tag: "h1" | "h2" | "h3") => ({ children }: { children?: React.ReactNode }) => (
    <Tag id={slugify(textOf(children).replace(/\*/g, ""))} className="scroll-mt-20">{children}</Tag>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/"><img src={logo} alt="Leaderei" className="h-7 w-auto" /></Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/termos" className={kind === "termos" ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}>Termos de Uso</Link>
            <Link to="/privacidade" className={kind === "privacidade" ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}>Política de Privacidade</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <details className="rounded-md border p-3 lg:border-0 lg:p-0" open>
            <summary className="cursor-pointer text-sm font-semibold lg:pointer-events-none lg:list-none">Nesta página</summary>
            <ul className="mt-3 space-y-1.5 text-sm">
              {toc.map((t) => (
                <li key={t.id} className={t.level === 1 ? "pt-2 font-semibold" : "pl-2"}>
                  <a href={`#${t.id}`} className="text-muted-foreground hover:text-foreground">{t.text}</a>
                </li>
              ))}
            </ul>
          </details>
        </aside>

        <main>
          <p className="text-sm text-muted-foreground">Plataforma Leaderei — app.leaderei.com.br</p>
          <p className="mb-8 text-sm text-muted-foreground">{LEGAL_VERSION}</p>
          <article className="prose prose-neutral max-w-none dark:prose-invert prose-headings:text-foreground prose-a:text-primary prose-table:text-sm prose-th:bg-muted prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-table:border">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: H("h1"), h2: H("h2"), h3: H("h3") }}>
              {md}
            </ReactMarkdown>
          </article>
          <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground">
            NICO TREINAMENTO DE VENDAS LTDA – ME · CNPJ 55.121.521/0001-99 · Encarregado (DPO): Nicolas Marcio — <a className="text-primary" href="mailto:nico@leaderei.com.br">nico@leaderei.com.br</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
