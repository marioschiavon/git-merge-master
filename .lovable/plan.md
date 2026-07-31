## Diagnóstico do problema imediato

Os 3 disparos de email da cadência **"teste email 2"** foram aprovados mas nenhum email saiu. Causa: a cadência tem `email_channel = 'domain'`, então `send-outbound-email` cai no branch Resend, encontra `company_email_domains.status = 'verifying'` e retorna 412 silenciosamente. Nenhum fallback para o grant Nylas ativo (`mariors07@gmail.com`) foi acionado.

## Decisão de arquitetura

**Nylas passa a ser o único caminho de envio de email.** Resend fica reservado somente para recepção (webhook inbound / MX de subdomínio dedicado) enquanto ainda houver clientes usando; nenhum código novo de envio vai chamar Resend.

## Escopo das mudanças

Só backend + UI de configuração/cadência. Sem quebrar dados existentes.

### 1. `send-outbound-email` — remover branch Resend de saída
- Sempre exigir um grant Nylas ativo da empresa. Se `email_grant_id` vier no body, usar; senão resolver automaticamente pelo `company_id` (preferindo grant do usuário atual quando disponível).
- Se não houver grant ativo, retornar 412 `no_active_email_grant` com mensagem explícita (não silencioso).
- Remover a leitura de `company_email_domains`, `resolveResendKey`, montagem de headers Resend, `List-Unsubscribe`, DMARC etc do caminho outbound.
- Manter escape/HTML→text helpers já existentes.

### 2. Callers deixam de passar/decidir "domain vs personal"
- `approval-execute` e `cadence-executor` (dois blocos ~427 e ~727) param de enviar `email_channel`/`email_grant_id`. Delegam a resolução para `send-outbound-email`.
- Se a cadência tiver `email_grant_id` explícito preenchido, ainda é repassado como preferência.

### 3. Cadências — UI e schema
- Em `Cadences` (form/wizard de canal email), remover a opção "Domínio da empresa (Resend)". Só oferecer "Conta pessoal conectada" com dropdown de grants ativos da empresa.
- `cadences.email_channel` passa a aceitar somente `'personal'` (backfill: qualquer valor `'domain'` vira `'personal'` e, se possível, associa ao primeiro grant ativo da empresa — se não houver, deixa `email_grant_id = null` e a cadência avisa que precisa conectar um email antes de rodar).

### 4. Tela de configuração de email do cliente (`src/pages/settings/Email.tsx`)
- Passa a mostrar **apenas** o card de contas pessoais (Nylas) como fonte de envio.
- A seção "Domínio de envio (Resend)" é ocultada / marcada como legado somente-recepção com um aviso curto ("Envio agora acontece pelas contas conectadas em Emails pessoais").
- Sem remover a tabela `company_email_domains` (a recepção multi-tenant depende dela).

### 5. Reprocessar os 3 approvals travados
Migration idempotente que devolve as approvals `4a285ea0…`, `8ed35e7a…`, `bed26121…` para `status = 'pending'` (limpa `executed_at`, `reviewed_at`, `reviewed_by`, `execution_error`) para o cliente reaprovar e o envio agora sair pelo Nylas.

### 6. Versão
`src/lib/version.ts` → `beta 0.22`.

## O que **não** muda

- Recepção de email continua igual: `resend-inbound-webhook` (MX subdomínio dedicado) + `email-inbound-webhook` (Nylas grants). `company_email_domains`, cron de verificação e backfill de subdomínios de recepção ficam intactos.
- Nada em WhatsApp, cadências não-email, aprovações de outros canais.
- Tabelas `user_email_grants`, `cadences`, `approval_requests` mantêm shape (só valor de `email_channel` normalizado).
- Nenhum secret novo.

## Detalhes técnicos

- Arquivos alterados:
  - `supabase/functions/send-outbound-email/index.ts` (remove branch Resend, sempre Nylas, resolve grant automaticamente).
  - `supabase/functions/approval-execute/index.ts` (não decide mais canal; propaga erro real do invoke).
  - `supabase/functions/cadence-executor/index.ts` (dois blocos de envio email + logging do erro em `lead_activities`).
  - `supabase/functions/cadence-agent-decide/index.ts` (idem, se ainda montar body de envio direto).
  - `src/pages/Cadences.tsx` / componente do wizard de canal email (remover opção "Domínio da empresa").
  - `src/pages/settings/Email.tsx` (esconder/marcar legado o card do domínio de envio).
  - `src/lib/version.ts`.
- Migrations:
  - Backfill: `UPDATE cadences SET email_channel = 'personal' WHERE email_channel = 'domain'` + para cada uma, tentar setar `email_grant_id` com um grant ativo da company se ainda estiver null.
  - Cleanup pontual das 3 approvals travadas.
- Não mexer em `resend-inbound-webhook`, `resend-inbound-backfill`, `resend-domain-*` (recepção).

## Observação para o cliente

Depois do deploy, cadências de email só rodam se a empresa tiver pelo menos uma conta conectada em **Configurações → Email pessoal**. O domínio Resend continua servindo apenas para receber respostas até migração completa da recepção.
