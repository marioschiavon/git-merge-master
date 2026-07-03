## Por que o erro aparece

O erro `supabase.auth.getClaims is not a function` vem da edge function `hook7-instance-manage` **em execução no servidor**. O código fonte no repositório já está correto (usa `supabase.auth.getUser(token)` em `_shared/tenant-auth.ts`), mas a versão **deployada** da função ainda tem o código antigo — o redeploy não ocorreu depois da correção do shared helper.

`getClaims` não existe no SDK `@supabase/supabase-js@2.45.4` que essas functions importam; ele só existe em versões mais novas / no client SSR do Next. Por isso qualquer function que ainda tenha esse call falha em runtime com 500.

Além do `hook7-instance-manage`, existem outras duas functions que ainda chamam `getClaims` diretamente no arquivo (não via helper) e vão explodir do mesmo jeito assim que forem invocadas:

- `supabase/functions/twilio-test-connection/index.ts:25`
- `supabase/functions/zapi-test-connection/index.ts:25`

## Correção proposta

1. **Redeploy `hook7-instance-manage`** para publicar o `tenant-auth.ts` já corrigido (mudança sem edição de código — apenas redeploy). Isso resolve o erro que aparece agora na tela.

2. **Corrigir as duas functions legadas** que ainda usam `supabase.auth.getClaims(...)` diretamente, trocando por:

   ```ts
   const { data: userData, error } = await supabase.auth.getUser(
     authHeader.replace("Bearer ", "")
   );
   if (error || !userData?.user) return 401;
   const userId = userData.user.id;
   ```

   Arquivos:
   - `supabase/functions/twilio-test-connection/index.ts`
   - `supabase/functions/zapi-test-connection/index.ts`

   (Mantém o comportamento — só troca a API que não existe pela que existe.)

3. **Atualizar o comentário** em `_shared/tenant-auth.ts` (linha 6) que ainda menciona `getClaims`, para evitar confusão futura.

## Fora de escopo

- Não vou remover as functions `zapi-*` / `twilio-*` agora (isso é da fase de cleanup pós-validação do Hook7, conforme combinado).
- Não vou mexer no fluxo de envio nem no webhook Hook7.

## Critério de aceite

- Abrir Configurações → Integrações → WhatsApp não gera mais `500 supabase.auth.getClaims is not a function`.
- Listagem de instâncias Hook7 carrega normalmente (mesmo que vazia).
