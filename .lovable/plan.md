## Diagnóstico

Olhando o domínio `leaderei.app.br` (status `verified`) e o código de envio/inbound, encontrei **quatro problemas** que juntos explicam o comportamento:

### 1. Falta DMARC (principal causa de spam)
O domínio tem apenas SPF + DKIM. Gmail e Outlook, desde 2024, **exigem DMARC** para remetentes que enviam em volume — sem ele, o email vai direto para spam. Não há registro `_dmarc` publicado.

### 2. Enviando do domínio raiz
O `sending_domain` é `leaderei.app.br` (raiz), quando a própria UI orienta a usar subdomínio (`mail.leaderei.app.br`). Enviar do raiz mistura reputação com o domínio principal e piora entregabilidade.

### 3. Faltam headers anti-spam no `send-outbound-email`
O payload enviado ao Resend não inclui:
- `List-Unsubscribe` e `List-Unsubscribe-Post` (obrigatórios pelo Gmail/Yahoo em 2024 para bulk senders).
- Versão `text/plain` quando só temos HTML (hoje geramos um HTML burro a partir do texto, mas não o contrário).
- `Reply-To` explícito quando o usuário não configurou (deveria cair no `from_email`).

### 4. Inbound do Resend não pode funcionar com a configuração atual
O DNS atual tem MX apontando para `feedback-smtp.us-east-1.amazonses.com` no subdomínio `send.leaderei.app.br` — esse MX é do **SPF/bounce report do Resend**, não é o MX de recebimento de email. Para o Resend Inbound realmente receber emails, é preciso um MX separado (`inbound-smtp.resend.com`) apontando para o domínio inbound. Além disso, hoje não há endpoint de inbound cadastrado no dashboard do Resend apontando para `resend-inbound-webhook`.

## Plano de correção

### A. Adicionar DMARC ao fluxo de cadastro
- Ao criar o domínio (`resend-domain-create`), incluir no `dns_records` retornado uma linha extra de DMARC recomendada: `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:dmarc@<domain>; fo=1`.
- Mostrar essa linha na tabela de DNS em `Email.tsx` com o mesmo botão de copiar.
- Considerar DMARC como parte da checagem de "totalmente configurado": mesmo que o Resend marque `verified` só com SPF+DKIM, exibimos um aviso "DMARC recomendado" enquanto o cliente não publicar.

### B. Recomendar subdomínio (não bloquear, apenas orientar)
- No formulário, se o usuário digitar um domínio sem ponto no primeiro nível (ex.: `leaderei.app.br`), mostrar aviso amarelo sugerindo `mail.leaderei.app.br` antes de cadastrar. Não bloqueia — cliente decide.

### C. Endurecer o `send-outbound-email` contra spam
- Adicionar header `List-Unsubscribe: <mailto:unsubscribe@<sending_domain>>, <https://<app>/unsubscribe?token=...>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Se só `html` foi passado, gerar automaticamente uma versão `text/plain` limpa (strip tags), evitando emails "só HTML" (fator de spam).
- Se `reply_to` da company estiver vazio, cair no próprio `from_email` (garante Reply-To coerente).
- Adicionar header `X-Entity-Ref-ID` com um UUID por envio (Gmail usa para agrupar/reputação).

### D. Corrigir o Resend Inbound
- Adicionar migration/documentação sobre o MX correto para inbound (`inbound-smtp.resend.com` prio 10) num subdomínio dedicado tipo `reply.<domain>`, separando do `send.` do outbound.
- Adicionar coluna/config para "inbound configurado" no `company_email_domains` (opcional) e mostrar na tela de Email um segundo card **"Recebimento de respostas"** com as instruções DNS e o link do webhook a cadastrar no dashboard do Resend.
- Como fallback imediato (sem depender do inbound do Resend): já temos `reply_to` — o cliente pode apontar um Gmail dele como reply-to enquanto o inbound não está pronto.

### E. Diagnóstico de spam para o usuário
- Card informativo no topo da página de Email listando: SPF ✅, DKIM ✅, DMARC ⚠️/✅, subdomínio dedicado ⚠️/✅. Assim o usuário vê exatamente o que falta.

## Escopo desta rodada

Sugiro atacar nesta ordem, uma coisa por vez para poder validar cada mudança:
1. **(A) + (C) + (E)** — DMARC no wizard + hardening dos headers no envio + card de checklist. Isso já reduz drasticamente o spam.
2. **(D)** — depois, em uma segunda rodada, resolvemos o inbound de forma limpa com subdomínio dedicado.

Confirma que posso começar por (1)? Ou prefere que eu inclua já o (D) inbound nesta mesma leva?