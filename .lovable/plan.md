## Objetivo

Quando o lead não tiver telefone cadastrado, descobrir automaticamente um número de WhatsApp a partir do site e das redes sociais já analisadas no enriquecimento, e salvar para uso no primeiro contato. Validação real (se é mesmo WhatsApp) fica para uma próxima etapa.

## O que muda

### 1. Banco — novo campo `leads.whatsapp`
- Adicionar coluna `whatsapp text` em `public.leads`.
- Adicionar `whatsapp_source text` (ex.: `website`, `instagram_bio`, `linkedin`, `wa.me`) para rastreabilidade.
- Sem mudanças de RLS (herda das políticas existentes).

### 2. Utilitário compartilhado de extração
Criar um helper em `supabase/functions/_shared/extract-whatsapp.ts` com:
- Regex para links diretos: `wa.me/<num>`, `api.whatsapp.com/send?phone=`, `whatsapp.com/send?phone=`.
- Regex para telefones BR em texto (com/sem `+55`, com/sem parênteses, celular 9 dígitos).
- Normalização para formato E.164 (`+55DDDNNNNNNNNN`); descarta fixos (sem o 9) por padrão.
- Retorna `{ number, source, confidence }` priorizando `wa.me` > telefone próximo a "WhatsApp"/"Zap" > telefone genérico.

### 3. `analyze-lead-website`
- Após obter markdown/HTML do site via Firecrawl, rodar o extrator.
- Se achar um número e o lead não tiver `phone` nem `whatsapp`, gravar:
  - `leads.whatsapp` = número
  - `leads.whatsapp_source` = `website` (ou `wa.me`)
  - `leads.phone` = mesmo número, **somente se `phone` estiver vazio**
- Registrar em `lead_activities` (`type: 'whatsapp_discovered'`).

### 4. `enrich-lead` / fluxo Apify Instagram
- Após salvar `lead_social_profiles`, rodar o extrator sobre `bio`, `posts_summary` e `recent_posts` (Instagram, LinkedIn).
- Mesma regra de gravação: só preenche `whatsapp`/`phone` se estiverem vazios. Não sobrescreve número já cadastrado.
- `whatsapp_source` recebe a rede (ex.: `instagram_bio`).

### 5. UI mínima
- `LeadDetail.tsx`: exibir o campo WhatsApp (quando preenchido) com badge da origem e link `https://wa.me/<num>` para abrir conversa.
- Sem novo formulário; edição manual continua via campos existentes do lead.

## Fora de escopo (próxima etapa)
- Validar via API se o número realmente tem WhatsApp (Twilio Lookup, Evolution, Z-API). Hoje assumimos válido quando vem de `wa.me`; demais números ficam marcados com `whatsapp_source` para o SDR conferir.
- Reprocessar leads antigos em massa (pode ser feito depois com um job manual).

## Ordem de execução
1. Migration `leads.whatsapp` + `whatsapp_source`.
2. Criar helper `_shared/extract-whatsapp.ts`.
3. Integrar em `analyze-lead-website` e `enrich-lead`.
4. Atualizar `LeadDetail.tsx` para exibir o WhatsApp + link.
