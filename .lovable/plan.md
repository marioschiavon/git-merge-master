## O que encontrei

Consultei o registro do domínio `hook7.com.br` (empresa `c09b6bab…`, status `verifying` desde ontem). Dois pontos:

### 1. Bug real no cálculo do nome DMARC (afeta todos os `.com.br`, `.co.uk`, etc.)

Em `supabase/functions/resend-domain-create/index.ts` (linhas 87-89):

```ts
const parts = sending_domain.split(".");
const dmarcName = parts.length > 2 ? `_dmarc.${parts.slice(-2).join(".")}` : `_dmarc`;
```

Para `hook7.com.br` → `parts = ["hook7","com","br"]` → `_dmarc.com.br`.
Isso é um **public suffix** (ninguém pode publicar registro em `com.br`), então o DMARC foi gerado apontando para um nome que o cliente não consegue criar. O `rua` também virou `dmarc@com.br` (inválido).

O correto para `hook7.com.br` (que já é o eTLD+1) seria simplesmente `_dmarc.hook7.com.br` (ou seja, `_dmarc` publicado na própria zona).

Observação: esse registro está com status `pending_manual` e **não bloqueia** a verificação SPF/DKIM pelo Resend — mas é confuso pro cliente e piora a deliverability (DMARC nunca vai validar).

### 2. Por que "não propagou" (SPF/DKIM/MX ainda `pending`)

Os registros SPF/DKIM/MX-envio continuam `pending` porque o Resend ainda não os enxerga na consulta DNS. Isso normalmente é uma destas 3 causas — precisa checagem externa:

- Cliente ainda não adicionou os registros no painel DNS do `hook7.com.br`.
- Adicionou, mas colocou o **nome errado** (ex.: colou `send.hook7.com.br` inteiro no campo Host quando o provedor já concatena o domínio, virando `send.hook7.com.br.hook7.com.br`).
- Adicionou com **aspas** no valor TXT, quebrando o parse do lado do Resend.

O cron roda 1x/hora e o botão "Verificar DNS agora" chama o Resend na hora — se o Resend não vê, é DNS lá fora, não é o app.

## Proposta de ajuste

**Parte A — corrigir o bug de DMARC (código):**

1. Em `resend-domain-create/index.ts`, trocar o cálculo por uma lista mínima de sufixos multi-label conhecidos (`com.br`, `com.mx`, `co.uk`, `com.ar`, `com.co`, `co.jp`, `com.au`, `net.br`, `org.br`, etc.). Se os 2 últimos labels formam sufixo conhecido **e** existem 3+ labels, a raiz é os 3 últimos; senão, os 2 últimos. Domínios simples (`empresa.com`) continuam funcionando.
2. Aplicar a mesma raiz no `rua=mailto:dmarc@<root>`.
3. Adicionar backfill idempotente: na próxima execução de `resend-domain-verify` e do cron, se detectar um registro DMARC com nome começando por `_dmarc.<public-suffix>`, recalcular e sobrescrever pelo nome correto (não republica no Resend — é registro manual do cliente; só corrige o que aparece na UI).

**Parte B — ajudar o cliente a diagnosticar (sem código):**

Consigo (via edge function existente `resend-domain-verify`) pedir ao Resend o status atual dos records de `hook7.com.br`. Se quiser, posso também rodar uma consulta pública de DNS (`dig`/DoH) desses nomes específicos pra confirmar se eles existem ou não do lado de fora — assim a gente sabe se o problema é "cliente não adicionou" vs "Resend não enxerga". Isso não requer mudança no app, é diagnóstico único agora.

**Parte C — versão:** bump `APP_VERSION` para `beta 1.0`... **não** — regra é nunca chegar a 1.0. Vai para `beta 1.0` violaria; então **`beta 0.10`**.

## Escopo

- Arquivos alterados: `supabase/functions/resend-domain-create/index.ts`, `supabase/functions/resend-domain-verify/index.ts`, `supabase/functions/resend-domain-verify-cron/index.ts` (helper compartilhado para calcular a raiz + backfill do nome), `src/lib/version.ts`.
- Sem migrations, sem mudança de UI.
- Deploy das 3 edge functions ao final.

Quer que eu já rode o diagnóstico DNS público do `hook7.com.br` antes de aplicar a correção, ou aplico direto?
