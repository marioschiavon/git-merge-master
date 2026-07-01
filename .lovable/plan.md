## Ajuste na tela /auth

**Verificação TS2304**: A importação `leadereiLogo` já existe corretamente em `Auth.tsx` (linha 10) e `AppSidebar.tsx` (linha 23), e os arquivos `leaderei-color.png` e `leaderei-white.png` estão em `src/assets/brand/`. Não há erro real de TS2304 no código atual — se aparecer no editor, é cache de tipos e some no próximo build.

**Alteração solicitada em `src/pages/Auth.tsx`**:
- Remover a linha `<CardTitle className="text-2xl">Leaderei</CardTitle>`
- Manter apenas a logo (`leaderei-color.png`) e a `CardDescription` ("Acesse sua conta" / "Crie sua conta" / "Redefinir senha")

Nenhuma outra alteração de layout, estilo ou lógica.