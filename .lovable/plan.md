# Migração Resend para conta master do cliente + gestão no painel Master

## Contexto

Hoje o `RESEND_API_KEY` está vinculado à sua conta pessoal via **connector Resend**. Vamos:
1. Trocar para a conta do cliente (conta master de produção onde ficarão os domínios de todos os clientes finais da plataforma).
2. Expor no painel **Master** um card para visualizar status e trocar essa chave no futuro.

## Parte 1 — Troca da conexão Resend (operacional, sem código)

Ordem correta:

1. **Cliente prepara a conta Resend master**
   - Cria/loga na conta Resend que será a de produção.
   - Gera uma API key com permissão **Full Access** (necessária para `domains.create/verify` usados por `resend-domain-create` / `resend-domain-verify`).
2. **Reconfigurar inbound (se aplicável)**
   - O endpoint `resend-inbound-webhook` e a rota de inbound do Resend devem ser reconfigurados na nova conta master (Inbound → Add route → apontar para a URL da edge function).
   - `RESEND_INBOUND_SECRET` continua o mesmo (é validado por nós, não pelo Resend).
3. **Trocar a connection no workspace**
   - Workspace → Connectors → Resend → desconectar a atual → reconectar informando a nova API key (via fluxo padrão de connector).
   - Isso substitui o valor de `RESEND_API_KEY` que as edge functions leem via gateway.
4. **Sem alterações em código nas edge functions** — todas já usam `Deno.env.get("RESEND_API_KEY")` através de `_shared/resend-gateway.ts` / gateway Lovable. Nada a redeployar manualmente; o Lovable propaga a nova credencial.
5. **Domínios existentes**
   - Domínios que hoje estão verificados na sua conta pessoal **não migram automaticamente**. Cada company que já cadastrou domínio precisará:
     - Ser re-cadastrada na nova conta (o `resend-domain-create` já faz isso ao clicar novamente em "Cadastrar domínio" na tela Email da empresa), ou
     - Ter o mesmo domínio verificado na nova conta e o registro em `company_email_domains` marcado como reprovisionado.
   - Como agora a base é multi-tenant e o cliente ainda está começando, o caminho mais simples é: após a troca, orientar cada company existente a clicar novamente em **Cadastrar domínio** e atualizar DNS se necessário.

## Parte 2 — Card "Resend (Master)" no painel Master

Adicionar em `src/pages/master/PlatformSettings.tsx` uma nova seção que mostra:

- Status: `RESEND_API_KEY` configurado (sim/não), `LOVABLE_API_KEY` configurado (sim/não).
- Texto explicando que a chave é gerenciada via connector do workspace (não é um secret manual).
- Botão **Gerenciar chave Resend** que abre a página de Connectors do workspace (link externo Lovable) — como a chave é connector-managed, a alteração real acontece lá.
- Botão **Testar conexão**: chama uma nova edge function `resend-master-test` que faz `GET /domains` no gateway Resend e retorna 200/erro (não expõe a chave, só status/mensagem).

### Backend

- Nova edge function `resend-master-test` (master_admin only): usa `_shared/tenant-auth.ts` → `requireRole(user.id, "master_admin")`, chama `resendFetch("/domains")`, retorna `{ ok, status, domain_count }` ou erro com body.
- Atualizar `platform-settings-status`: adicionar `resend: { api_key_configured: !!Deno.env.get("RESEND_API_KEY") }` no payload.

### Frontend

- Em `PlatformSettings.tsx`: novo card "Email (Resend)" com status, botões de teste e link para Connectors.
- Nenhum campo de input de API key no painel (chave nunca trafega pelo frontend).

## Parte 3 — Versão

Bumpar `src/lib/version.ts` para `alpha 0.25`.

## Fora de escopo

- Migração automática de domínios verificados entre contas Resend (não há API pública para isso; cada company revalida).
- Troca do `RESEND_INBOUND_SECRET` (permanece).
- Mudança de `GMAIL_*` / connector Google.

## Rollback

Se a troca quebrar envios, reconectar a API key antiga em Workspace → Connectors → Resend. Nenhuma migração de banco é feita.

## Perguntas antes de executar

1. A conta Resend master do cliente já foi criada e a API key com Full Access está em mãos, ou você quer só preparar o painel Master primeiro e trocar a connection depois?
2. Existem hoje domínios de companies **já verificados em produção** que precisam ser preservados? (Se sim, listamos e coordenamos a revalidação; se não, seguimos direto.)
