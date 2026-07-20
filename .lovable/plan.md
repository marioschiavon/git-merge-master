## Diagnóstico

O usuário `ca0fccee` pertence à empresa **Leaderei** (`b9876b4c...`). O domínio cadastrado é `leaderei.app.br` e está no status **`verifying`** desde **16/07** (4 dias parado).

Verifiquei o DNS público via `dig` e **os três registros que o Resend pediu estão publicados corretamente**:

| Registro | Esperado | Publicado |
|---|---|---|
| `resend._domainkey` TXT | `p=MIGf...QIDAQAB` | ✅ idêntico |
| `send` TXT (SPF) | `v=spf1 include:amazonses.com ~all` | ✅ idêntico |
| `send` MX 10 | `feedback-smtp.us-east-1.amazonses.com` | ✅ idêntico |

Ou seja, o problema **não é DNS ausente/errado** — o Resend simplesmente não fechou a verificação do lado dele (nos `dns_records` salvos os três seguem `status: "pending"`).

### Causas prováveis

1. **Polling só roda com a página aberta.** `src/pages/settings/Email.tsx` faz auto-verify a cada 15s, mas para em 20 tentativas (5 min) e some quando o usuário sai da tela. Se o DNS propagou depois, ninguém dispara `POST /domains/{id}/verify` de novo — e o Resend não vai marcar sozinho.
2. **Registro no cadastrador do `.app.br`.** Alguns registradores publicam o TXT com quebra/aspas escapadas que o `dig` mostra normalmente mas o checker do Resend rejeita.
3. **Backoff do lado do Resend** após muitas tentativas seguidas naquele domain_id específico. A cura padrão é ficar algumas horas sem chamar `verify` e disparar de novo — ou recriar o domínio.

### Fato colateral confirmado

- Outra empresa (`mail.hook7.com.br`) verificou normalmente com o mesmo fluxo, então o código de criação/verify em si funciona; é específico do leaderei.app.br.

## O que fazer

### 1. Ação manual imediata para desbloquear a Leaderei
Não dá para resolver 100% via código sem tocar no domínio dele. Duas opções para eu executar quando você aprovar:

- **A. Forçar re-verify agora** chamando `POST /domains/{id}/verify` no Resend via a função `resend-domain-verify` (com service role, sem depender da sessão do usuário). Se destravar → status vira `verified`.
- **B. Se A não destravar**, apagar o registro (função `resend-domain-delete` já existe) e recriar. Isso gera um novo `domain_id` no Resend e reseta qualquer backoff. O usuário só precisa re-colar os mesmos registros (na maior parte dos casos os valores DKIM/SPF continuam os mesmos, mas conferir).

### 2. Prevenir isso para todos os clientes: cron de verificação em background

Criar `supabase/functions/resend-domain-verify-cron/index.ts` que:

- Roda de hora em hora via `pg_cron`.
- Busca em `company_email_domains` todos com `status IN ('pending','verifying')` cujo `updated_at` seja mais recente que 7 dias (para não bater à toa em domínios abandonados).
- Para cada um chama `POST /domains/{id}/verify` e depois `GET /domains/{id}` no Resend usando `resendFetch` (chave master).
- Atualiza `status` e `dns_records` no banco.
- Se ficar 72h em `verifying` sem sucesso → grava `last_error` explicando "DNS propagado mas Resend não confirmou; tente remover e recadastrar".

Isso resolve o cenário "usuário fechou a página antes do DNS propagar" para sempre.

### 3. Ajuste pequeno de UX em `settings/Email.tsx`

- Quando o domínio estiver em `verifying` há **> 24h** e todos os registros DNS **estiverem publicados** (podemos inferir pela última resposta do Resend), mostrar um aviso amigável: *"O DNS já está publicado, mas o Resend ainda não fechou a verificação. Isso costuma resolver sozinho em algumas horas. Se persistir, remova o domínio e cadastre de novo."*
- Adicionar botão **"Remover e cadastrar de novo"** (só um atalho para o fluxo já existente).

## Ordem de execução

1. Rodar A (força verify agora no leaderei.app.br) e reportar o resultado.
2. Se persistir → executar B com aprovação do usuário.
3. Criar o cron `resend-domain-verify-cron` + agendamento pg_cron.
4. Aplicar o ajuste de UX em `settings/Email.tsx`.

## Detalhes técnicos

- Nada muda em `_shared/resend-gateway.ts`, `resend-domain-create` ou `resend-domain-verify`.
- Novo edge function chama `resendJson` que já usa a chave master criptografada em `platform_settings`.
- Agendamento via `cron.schedule('resend-domain-verify-cron', '0 * * * *', ...)` chamando a função com service role.
- Nenhuma mudança de schema no banco.
