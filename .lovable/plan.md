# Configurações Globais do Master Admin

Criar uma área de settings exclusiva do `master_admin` para gerenciar integrações e chaves que valem para **toda a plataforma** (todas as empresas usam de forma transparente, sem enxergar nem configurar).

## 1. Tabela `platform_settings` (singleton)

Nova tabela para armazenar configuração global:

```
platform_settings
  id (uuid, singleton — sempre 1 linha)
  apify_enabled (bool)
  apify_api_token (text, secret-like)
  openai_enabled / anthropic / etc. (fase 2)
  metadata (jsonb) — extensível
  updated_by (uuid → auth.users)
  updated_at
```

RLS: `SELECT/UPDATE` apenas para `master_admin`. Edge functions leem via `service_role` (bypassa RLS).

Companies **não** têm acesso direto — nem via API nem via UI.

## 2. Segredos globais reais

Chaves sensíveis (Apify token, futuras chaves globais) continuam guardadas como **secrets do backend** (`APIFY_API_TOKEN`, etc.) via `add_secret`. A tabela `platform_settings` guarda apenas o **estado** (habilitado/desabilitado) e metadados não-sensíveis. Isso mantém as chaves fora do banco e reutilizáveis nas edge functions.

## 3. Nova página `/master/platform-settings`

Página React só acessível para `master_admin` (guard já existe no sidebar). Conteúdo:

- Card "Apify (Enriquecimento)"
  - Toggle habilitar/desabilitar globalmente
  - Botão "Configurar token" → `update_secret('APIFY_API_TOKEN')`
  - Status: chave configurada? sim/não (via edge function `platform-settings-status`)
  - Botão "Testar conexão"
- Slots futuros: OpenAI global, Anthropic global, Cal.com master, etc. (só um deles ativo agora — Apify)

## 4. Item no sidebar do master

Adicionar em `masterItems` em `AppSidebar.tsx`:
- "Integrações da Plataforma" → `/master/platform-settings`

## 5. Migração da lógica atual do Apify

Hoje o Apify está em `EnrichmentSettingsCard.tsx` como integração por empresa (`integrations` table, `provider=apify`). Mudança:

- Remover o campo de token Apify do card por-empresa (ele fica só como toggle "Usar Apify" por empresa, respeitando o master habilitar/desabilitar globalmente).
- `enrich-lead/index.ts` passa a ler `APIFY_API_TOKEN` do env global (não mais de `integrations.api_token` por empresa).
- Se `platform_settings.apify_enabled = false`, a função retorna sem chamar Apify (mesmo que a empresa tenha habilitado).

## 6. Edge function `platform-settings-status`

Endpoint só para `master_admin` que retorna:
```json
{ "apify": { "enabled": true, "token_configured": true } }
```
Verifica JWT + role, e reporta se o env `APIFY_API_TOKEN` existe. Nunca vaza o valor.

## 7. UX

- Master admin: vê o novo menu, configura o token uma vez, toggle liga/desliga.
- Company admin: não vê nem sabe que Apify existe como serviço externo — vê apenas "Enriquecimento avançado (via plataforma)" como um toggle simples no seu próprio settings.
- Se master desabilita globalmente, o toggle da empresa fica desabilitado com aviso "Recurso indisponível — contate o suporte".

## Detalhes técnicos

- Migração cria tabela + grants + RLS + policy `master_admin only` + seed de 1 linha default.
- `platform_settings` NÃO tem `company_id` — é singleton.
- Reaproveitar hook `useAuth` para checar `isMasterAdmin` (já existe).
- Nenhuma mudança em auth.

## Fora do escopo

- Migração de outras integrações globais (OpenAI/Anthropic/etc.) — só Apify agora, estrutura preparada para mais.
- Billing/quotas por empresa em cima do recurso global.
- Auditoria de uso do recurso global por empresa (fase 2, via `execution_logs`).

## Perguntas de confirmação

1. Confirmo que o **token Apify** deve migrar para um secret global (`APIFY_API_TOKEN`) — quer que eu já solicite via `add_secret` neste plano ou você prefere configurar manualmente depois?
2. Além do Apify, existe alguma outra integração que **você já sabe** que deve ser global desde já (ex.: Cal.com centralizado, provider de e-mail transacional)?
