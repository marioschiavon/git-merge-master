## Diagnóstico

Confirmei via API do Resend que o domínio `mail.hook7.com.br` está **verified** (todos os 3 registros DNS `verified`). Porém no banco `company_email_domains` ainda consta `status = "verifying"`.

**Causa raiz:** o clique em "Verificar DNS" na tela foi feito antes do Resend concluir a checagem (o toast "Ainda propagando" apareceu). O Resend terminou de verificar depois, mas a nossa tela não faz um novo polling automático — o usuário precisaria clicar de novo, e a UX não deixa isso claro.

Além disso, mesmo agora, se o usuário clicar de novo, o botão funciona uma vez só; se ele saiu da página, ao voltar precisa clicar de novo.

## Plano

**1. Corrigir o registro atual (imediato)**
- Invocar `resend-domain-verify` uma vez agora (via edge function) para sincronizar `mail.hook7.com.br` → `verified`.

**2. Auto-polling no frontend (`src/pages/settings/Email.tsx`)**
Quando o domínio existe e `status ∈ {"pending", "verifying"}`:
- Ao montar a página, disparar `resend-domain-verify` automaticamente (1x silenciosamente).
- Iniciar polling: chamar `resend-domain-verify` a cada 15s, por até 5 min, parando quando `status === "verified"` ou `failed`.
- Mostrar indicador visual sutil ("Verificando automaticamente...") ao lado do badge, sem toast a cada iteração.
- Manter o botão manual "Verificar DNS" para o usuário forçar.

**3. Melhorar o texto**
- Trocar o toast "Ainda propagando" por "Estamos verificando em segundo plano — vamos atualizar automaticamente" quando o polling estiver ativo.

## Detalhes técnicos

- Hook novo `useAutoVerifyDomain(domain)` que:
  - Retorna cedo se `status === "verified"` ou `failed` ou não há domínio.
  - Usa `useEffect` + `setInterval(15000)` com contador de tentativas (máx 20).
  - Em cada tick, `supabase.functions.invoke("resend-domain-verify")` e `queryClient.invalidateQueries(["company_email_domain_full"])`.
  - Limpa o interval no unmount e ao chegar em estado terminal.

## Escopo excluído
- Webhook do Resend (fora de escopo — o polling resolve o caso do usuário).
- Mudança na edge function `resend-domain-verify` (já está correta).
