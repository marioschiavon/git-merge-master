## Objetivo
Replicar a identidade visual do **Leaderei Foundation** neste projeto — cores, tipografia, logos, favicon — e renomear "SDR Auto/Automation" para **Leaderei** nos textos visíveis.

## Assets que vou copiar do Leaderei
- `public/favicon.ico`, `favicon-512.png`, `apple-touch-icon.png`
- `public/fonts/ibrand.otf`
- `src/assets/brand/leaderei-color.png` (auth/light)
- `src/assets/brand/leaderei-white.png` (sidebar dark)

## Arquivos que vou editar

1. **`src/index.css`** — substituir tokens HSL pela paleta Leaderei (laranja `#e04e01` primary, off-white bg, sidebar near-black, muted `#606060`, deep `#313131`), adicionar `@font-face` Ibrand, importar Poppins, e novos tokens `--brand`, `--brand-soft`, `--success`, `--warning`. Variante `.dark` equivalente.

2. **`tailwind.config.ts`** — `fontFamily.sans` = Poppins; adicionar `display` e `brand` (Ibrand); registrar cores `brand`, `brand-soft`, `success`, `warning`.

3. **`index.html`** — `<title>Leaderei</title>`, meta description, favicon/apple-touch-icon, preconnect Google Fonts (Poppins).

4. **`src/components/AppSidebar.tsx`** — substituir ícone `Zap` + "SDR Auto" pelo `leaderei-white.png`.

5. **`src/pages/Auth.tsx`** — substituir `Zap` pelo `leaderei-color.png`; trocar "SDR Automation" por "Leaderei".

6. **Outras menções textuais** — buscar e renomear "SDR Auto" / "SDR Automation" em pages e copy visível (sem mexer em IDs, rotas ou nomes de tabelas).

## Tradução de cores principais

| Token | Origem oklch | HSL aplicado |
|---|---|---|
| primary / brand | `#e04e01` | `18 99% 44%` |
| background | off-white | `60 14% 97%` |
| foreground | near-black | `0 0% 11%` |
| secondary | `#313131` | `0 0% 19%` |
| muted-fg | `#606060` | `0 0% 38%` |
| sidebar | near-black | `0 0% 8%` |

## Fora do escopo
- Lógica de negócio, rotas, hooks, edge functions, schema do banco — intactos.
- Sem mudar a Ibrand de licença/uso além de servir o `.otf` já presente no Leaderei.