## Objetivo
Simplificar telefone/WhatsApp, filtrar leads elegíveis por canal ao inscrever em cadência, e mostrar o **ícone oficial do WhatsApp (enviado pelo usuário)** + ícone de e-mail ao lado do nome do lead.

## 1. Unificar WhatsApp e telefone (UI)

Manter as duas colunas no banco (`leads.whatsapp` e `leads.phone`), mas na UI só existe um campo principal.

- Campo principal: **"WhatsApp / Celular"** — grava em `whatsapp` e `phone` juntos (comportamento que o `LeadFormDialog` já tem hoje).
- Campo opcional em "Mais opções": **"Telefone fixo"** — grava só em `phone` quando difere do WhatsApp.
- Se o lead veio de importação e tem só `phone`, o sistema copia para `whatsapp` automaticamente.
- **Backfill único** (migration): `UPDATE leads SET whatsapp = phone WHERE whatsapp IS NULL AND phone IS NOT NULL` e o inverso — resolve os 13 leads do cliente que caíram nesse buraco.

**Arquivos:** `src/components/LeadFormDialog.tsx`, `src/components/LeadDetailContent.tsx`, uma migration para o backfill.

## 2. Filtrar leads por canal ao inscrever

- Cadência `type='whatsapp'` → só oferece leads com `whatsapp` (ou `phone`, após o backfill).
- Cadência `type='email'` → só oferece leads com `email`.
- Cadência multi-canal continua aceitando qualquer lead com pelo menos um canal.

**Arquivos:**
- `src/components/CadenceDetail.tsx` (`availableLeads`): aplicar filtro conforme `cadence.type`.
- `src/pages/Leads.tsx` (dialog de bulk enroll): esconder leads incompatíveis e mostrar contagem "X leads sem canal serão pulados".
- `supabase/functions/leads-bulk-action/index.ts`: validar servidor-side e retornar `skipped_no_channel` no payload.

## 3. Ícones de canal ao lado do nome do lead

- **WhatsApp** → usar o `.ico` enviado pelo usuário como asset (upload via `lovable-assets` no modo build). Componentizar em `src/components/lead/ChannelBadges.tsx` como `<img src={whatsappIcon.url} className="h-4 w-4" />` com tooltip mostrando o número.
- **E-mail** → ícone `Mail` do lucide-react, cor azul (`text-blue-600`), tooltip com o e-mail.
- Mostrar ambos quando o lead tiver os dois.

**Arquivos:**
- Novo asset: `src/assets/whatsapp.ico.asset.json` (upload do `.ico` enviado pelo cliente).
- Novo componente: `src/components/lead/ChannelBadges.tsx`.
- `src/pages/Leads.tsx` (linhas 344-346): renderizar o componente junto aos badges já existentes ("🏢 Empresa" / "🤖 Agente").
- Reaproveitar no picker de "Adicionar leads" em `src/components/CadenceDetail.tsx`.

## Fora de escopo
- Não muda motor de cadência, agent-decide, SDR, HITL, transcrição de áudio.
- Não remove colunas `whatsapp`/`phone` do banco.
- Sem validação Hook7 no digitar (continua async).

## Detalhes técnicos
- Backfill idempotente, roda uma vez, seguro.
- Filtro de canal (front e back) usa a regra: `hasEmail = !!lead.email`, `hasWpp = !!(lead.whatsapp || lead.phone)`.
- Ícone WhatsApp servido via CDN Lovable (`/__l5e/assets-v1/...`), tamanho `h-4 w-4`, sem alterar cor (mantém identidade visual do WhatsApp).
- Sem mudanças em `types.ts` nem em RLS.
