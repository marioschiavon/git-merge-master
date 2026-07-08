# Versionamento discreto na sidebar

Exibir a versão atual do app de forma discreta, começando em `alpha 0.17`.

## O que muda

1. **Nova constante em `src/lib/version.ts`**
   - Exporta `APP_VERSION = "alpha 0.17"` (fonte única da verdade).
   - Comentário no topo do arquivo com a regra de bump.

2. **Exibição em `src/components/AppSidebar.tsx`**
   - Local: logo abaixo da logo da Leaderei, dentro do `SidebarHeader` (junto do badge da empresa).
   - Estilo discreto: `text-[10px]`, `text-sidebar-foreground/50`, `font-mono`, sem borda/badge.
   - Só aparece quando a sidebar está expandida (`!collapsed`).

## Regra de bump (que eu vou seguir)

- **Fase alpha (atual):** a cada alteração que eu fizer no app, incremento `+0.01` automaticamente (0.17 → 0.18 → 0.19 …) editando `src/lib/version.ts` no mesmo commit da alteração.
- **Salto para 1.XX:** só quando você me avisar explicitamente que entrou em produção real. A partir daí, bumps `1.XX` também acontecem automaticamente a cada alteração (+0.01).
- Se em uma resposta eu fizer múltiplas alterações agrupadas, conto como **um único bump** (+0.01) para não estourar a numeração.

## Detalhes técnicos

- Arquivo novo: `src/lib/version.ts`.
- Edit em `src/components/AppSidebar.tsx`: import da constante + `<span>` no `SidebarHeader` após o bloco do `companyName`.
- Sem mudanças em backend, rotas ou lógica de auth.
