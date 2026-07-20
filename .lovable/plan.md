## Objetivo

Criar uma página de **Logs de Auditoria** no Master Admin para acompanhar em tempo real o que clientes e usuários estão fazendo (login, criação de leads, envio de mensagens, mudanças de configuração, erros de edge functions etc.) — inspirado no padrão do Leaderei Foundation, mas com melhorias.

## Como o Foundation faz (referência)

O Foundation grava uma linha por ação em uma tabela `audit_logs` com: quem (user_id + email), qual empresa, tipo de evento, entidade afetada, payload em JSON, IP/user-agent e severidade. Uma página `/admin/logs` mostra tudo com filtros por empresa, usuário, severidade e período.

## Melhorias sobre o Foundation

1. **Unificar 3 fontes num só painel**: eventos de negócio (audit), erros de edge functions (via `supabase.analytics_query`) e eventos de auth (login/logout já disponíveis nos logs do Cloud).
2. **Severidade explícita** (`info` | `warn` | `error` | `critical`) com destaque visual.
3. **Filtro rápido "só erros"** — atalho mais usado no dia-a-dia.
4. **Retenção 90 dias** com limpeza automática via cron (evita tabela inflar).
5. **Contexto rico**: cada log guarda `entity_type` + `entity_id` (lead, cadence, booking…) para clicar e ir direto ao recurso.
6. **Logging não-bloqueante**: gravação assíncrona nas edges (fire-and-forget) para não impactar latência.

## Escopo

### 1. Backend — tabela e helper

- Migração cria `public.audit_logs`:
  - `id`, `created_at`, `company_id`, `user_id`, `user_email`, `event_type` (ex.: `lead.created`, `cadence.launched`, `auth.login`, `integration.connected`, `edge.error`), `severity`, `entity_type`, `entity_id`, `message` (curto), `metadata` (jsonb), `ip`, `user_agent`.
  - Índices por `created_at desc`, `company_id`, `severity`, `event_type`.
  - RLS: `SELECT` só para `master_admin`; `INSERT` só `service_role`. GRANTs corretos.
- Helper `_shared/audit-log.ts` com `logAudit({ companyId, userId, eventType, severity, entityType?, entityId?, message, metadata? })` que insere via service_role sem bloquear.
- Instrumentar pontos-chave (não precisa ser tudo agora): login (via trigger no `useAuth`), criação/exclusão de leads, disparo de cadência, envio de mensagem WhatsApp/email, conexão/desconexão de integrações (Cal.com, Resend, Apollo, Pipedrive, Hook7), erros capturados nas edges principais (`hook7-webhook`, `cadence-executor`, `send-outbound-*`, `resend-domain-*`).
- Job diário no `pg_cron` limpando registros > 90 dias.

### 2. Frontend — página Master → Logs

- Nova rota `/master/logs` protegida por `RequireMasterAdmin`.
- Item "Logs" no `masterItems` do `AppSidebar`.
- Página `src/pages/master/AuditLogs.tsx`:
  - Filtros: período (últimas 1h/24h/7d/30d/custom), empresa (select), severidade (chips info/warn/error/critical), tipo de evento (multi-select), busca por email/entidade, atalho "só erros".
  - Tabela paginada (50/pág, load more): timestamp (BRT), severidade colorida, empresa, usuário, evento, mensagem, botão "Ver detalhes" que abre drawer com `metadata` JSON formatado + link para a entidade quando aplicável.
  - Tab secundária "Edge Function Errors" consultando logs analytics do Cloud (últimas 24h) via nova edge `master-edge-errors` que usa a mesma API que a ferramenta interna já usa.
  - Contadores no topo (últimas 24h): total, erros, warnings, empresas ativas.
  - Auto-refresh a cada 30s (toggle).

### 3. Detalhes técnicos

- Logs escritos com service_role usando `logAudit` — nunca do cliente (evita spoofing).
- `event_type` como texto livre padronizado com prefixo (`lead.*`, `cadence.*`, `auth.*`, `integration.*`, `edge.error.*`) para agrupar via `LIKE` nos filtros.
- Retenção configurável em constante compartilhada; padrão 90 dias.

## Não incluído nesta entrega

- Export CSV (fica para próxima iteração se pedirem).
- Alertas por email quando `critical` — depende de configurar destinatário.
- Instrumentação de 100% das edges — começamos pelas mais críticas listadas acima e vamos ampliando conforme necessidade.
