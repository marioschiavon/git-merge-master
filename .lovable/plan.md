## Renomeação para "Leaderei"

A maior parte já foi feita em turno anterior (sidebar, tela de auth, `index.html` title/meta, favicons, logos). Falta apenas pequenos ajustes residuais.

### Mudanças
1. **`index.html`** — texto das meta descriptions ainda diz "plataforma de SDR e automação comercial". Atualizar para algo alinhado à marca Leaderei (ex.: "Leaderei — plataforma de prospecção e automação comercial").
2. **`package.json`** — campo `name` ainda é `vite_react_shadcn_ts`. Renomear para `leaderei`.
3. **Varredura final** — confirmar que nenhum outro texto visível (toasts, títulos de página, emails de boas-vindas em edge functions, etc.) ainda usa "SDR Auto" / "SDR Automation". A busca atual não encontrou nada além das meta tags; se aparecer algo durante a edição, ajusto junto.

### Fora de escopo
- Não mexer no termo "SDR" quando se refere ao cargo (ex.: `"editado pelo SDR"` em `useSimulateCadence.ts`) — é função/role, não nome do produto.
- Não tocar em logos/cores (já aplicados).
