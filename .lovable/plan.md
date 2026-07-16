## Diagnóstico

O erro `401 credential not found` vem do **gateway de conectores da Lovable**, não do Resend.

O código atual (`supabase/functions/_shared/resend-gateway.ts` e `resend-master-set/index.ts`) envia toda chamada Resend para `https://connector-gateway.lovable.dev/resend/...` com dois headers:

- `Authorization: Bearer $LOVABLE_API_KEY`
- `X-Connection-Api-Key: <chave salva>`

O gateway só aceita como `X-Connection-Api-Key` uma **chave de conexão emitida pelo conector Resend da Lovable** (aquela que aparece como `RESEND_API_KEY` quando você conecta o Resend em Integrações). Ao colar uma chave `re_...` gerada direto no painel `resend.com/api-keys`, o gateway não encontra credencial registrada e devolve `401 credential not found` — por isso a validação falha e nada é salvo em `platform_settings`.

## Solução

Chamar `https://api.resend.com` diretamente com `Authorization: Bearer <re_...>`. Assim qualquer chave full-access gerada pelo próprio usuário no painel do Resend funciona — sem depender do conector.

## Mudanças

### 1. `supabase/functions/_shared/resend-gateway.ts`
- Trocar `GATEWAY = "https://connector-gateway.lovable.dev/resend"` por `RESEND_API = "https://api.resend.com"`.
- Em `resendFetch` e `resendFetchWithKey`: usar `Authorization: Bearer <resendKey>`, remover `X-Connection-Api-Key` e a dependência de `LOVABLE_API_KEY`.
- `resolveResendKey` continua igual (DB primeiro, connector como fallback) — a chave do connector (`RESEND_API_KEY`) na verdade também é uma `re_...` válida pela Resend direta, então o fallback segue funcionando.
- Mantém cache e `invalidateResendKeyCache`.

### 2. `supabase/functions/resend-master-set/index.ts`
- Nada muda no fluxo, mas agora a validação `GET /domains` bate direto no Resend. Uma chave `re_...` válida passa; uma chave inválida devolve o erro real do Resend (JSON `{ name, message }`).
- Ajustar apenas a mensagem de erro para exibir `message` do Resend quando possível (fica mais claro que "credential not found").

### 3. `supabase/functions/resend-master-test/index.ts`
- Nenhuma mudança de código; passa a testar direto no Resend automaticamente pela mudança em (1).

### 4. `supabase/functions/send-outbound-email/index.ts`
- Trocar `RESEND_GATEWAY = "https://connector-gateway.lovable.dev/resend"` por `https://api.resend.com`.
- No `fetch` de envio: usar `Authorization: Bearer <resendKey>`, remover `X-Connection-Api-Key` e o require de `LOVABLE_API_KEY`.
- Resolver a chave via `resolveResendKey()` do helper compartilhado (hoje ele lê `Deno.env.get('RESEND_API_KEY')` só). Assim, se o master salvou a chave via UI, o envio outbound também usa essa chave (hoje só usa a do connector).

### 5. `supabase/functions/resend-domain-create/index.ts`, `resend-domain-verify/index.ts`, `resend-domain-delete/index.ts`
- Já usam o helper `resendFetch` / `resendJson`. Nenhuma alteração — herdam o fix.

### 6. `src/pages/master/PlatformSettings.tsx` (UI)
- Ajustar o texto de ajuda do card para deixar claro: **cole aqui uma chave "Full access" criada em `resend.com/api-keys`**, e que ela é validada em `api.resend.com/domains` antes de ser gravada.
- Remover a menção residual ao "Connector (legado)" quando o ambiente não tiver mais o `RESEND_API_KEY` do connector, para não confundir.

## Fora do escopo

- Remover o secret `RESEND_API_KEY` do connector: mantém como fallback, sem impacto.
- Migrar chave existente já salva no banco: continua válida (é um `re_...`); só muda o destino da chamada.
- Mudanças em templates ou fluxo de envio de e-mails.

## Como testar após aplicar

1. Abrir `/master/platform-settings` → colar a chave `re_...` full-access → **Salvar**.
2. Toast deve mostrar `Chave salva. N domínio(s) na conta.`.
3. Clicar em **Testar conexão** → deve retornar `Conectado. N domínio(s) na conta Resend.`.
4. Cadastrar/verificar um domínio de envio de uma empresa para confirmar que `resend-domain-create` e `resend-domain-verify` continuam funcionando.
