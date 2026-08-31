# Manual dentro do app

Criar uma página de manual completa e navegável dentro do Leaderei, usando o conteúdo que já existe em `docs/manual/`, e adicionar o link na sidebar em **Guias**, logo abaixo de "Boas práticas WhatsApp".

## Como vai funcionar

- Nova rota `/guides/manual` com layout de documentação:
  - Coluna esquerda: índice das 26 páginas do manual, agrupado nas 4 fases (Configuração inicial, Operação, Relacionamento, Análise), com destaque do capítulo ativo.
  - Coluna central: conteúdo do capítulo selecionado, renderizado a partir dos arquivos markdown reais (sempre em sincronia com `docs/manual/`).
  - Campo de busca no topo que filtra capítulos por título e por texto do conteúdo.
  - Rodapé com "← Anterior" / "Próximo →" seguindo a ordem recomendada do manual.
  - Capítulo selecionado refletido na URL (`/guides/manual/03f-bitrix24`), permitindo link direto e compartilhamento.
- Responsivo: em telas pequenas o índice vira um seletor recolhível acima do conteúdo.
- Sidebar: item "Manual" em Guias, abaixo de "Boas práticas WhatsApp".

## Detalhes técnicos

- Carregar os `.md` com `import.meta.glob('/docs/manual/*.md', { query: '?raw', eager: true })` — nada é duplicado, a fonte continua sendo `docs/manual/`.
- Adicionar `react-markdown` + `remark-gfm` para renderizar (suporte a tabelas, usadas em `03-integracoes.md`), com estilos via tokens do design system (headings, listas, tabelas, blocos de código) — sem cores hardcoded.
- Ordem e títulos derivados do nome do arquivo (prefixo numérico) e do primeiro `#` de cada arquivo; `README.md` usado apenas como página de visão geral inicial.
- Links relativos entre capítulos (`./08-leads.md`) reescritos para navegação interna da página.
- Arquivos: novo `src/pages/Manual.tsx` (+ componentes auxiliares se necessário), rota em `src/App.tsx`, item em `guideItems` de `src/components/AppSidebar.tsx`.
- Bump de versão em `src/lib/version.ts` e entrada no patch log do dia.
