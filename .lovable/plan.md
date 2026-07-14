## Resposta curta

**Ninguém está usando Z-API nem Twilio em produção.** O envio e a recepção de WhatsApp hoje passam 100% pelo **Hook7**. O que sobrou são resíduos históricos da migração:

### 1. Webhooks legados que ainda estão publicados (mas não recebem tráfego real)

- `supabase/functions/zapi-webhook/` — webhook antigo da Z-API. Busca `integrations` com `provider = 'zapi_whatsapp'`. Nenhuma integração ativa desse tipo existe hoje.
- `supabase/functions/twilio-whatsapp-webhook/` — webhook antigo do Twilio Sandbox. Mesmo caso, `provider = 'twilio_whatsapp'`.
- `supabase/functions/zapi-test-connection/` e `twilio-test-connection/` — botões de "Testar" da tela antiga.

Eles continuam deployados só porque nunca foram removidos. Como não há integração ativa nesses providers, os webhooks caem no fallback e ignoram — mas ficam expostos publicamente sem necessidade.

### 2. Nomes de função "Z-API" no código do Hook7 (isso é só apelido, pode ignorar)

Em `supabase/functions/_shared/hook7-whatsapp.ts` existem aliases:

```ts
export async function getZApiConfig(...)      // na verdade resolve instância Hook7
export async function sendWhatsAppViaZApi(...) // na verdade envia via Hook7
```

Foram mantidos como **aliases drop-in** para não ter que reescrever todos os call sites (`cadence-executor`, `cadence-agent-decide`, `approval-execute`, `execute-action`, `inbound-webhook`, `send-outbound-message`, `slot-expiry-followup`). Todos esses arquivos importam `getZApiConfig`/`sendWhatsAppViaZApi`, mas por baixo dos panos usam Hook7. **Nenhuma chamada real vai para Z-API.**

O arquivo antigo `_shared/zapi-whatsapp.ts` (que de fato falava com a Z-API) e o `_shared/twilio-whatsapp.ts` também ficaram no repo, mas **não são importados por nenhum lugar** — pode confirmar em `rg`.

### 3. UI de configuração Z-API na tela de Integrações

`src/pages/settings/Integrations.tsx` ainda tem um card "Z-API" (linhas ~561-656) que grava em `integrations` com `provider = 'zapi_whatsapp'`. Também é resíduo — nem o webhook nem o envio olham mais para essa configuração.

---

## O que eu proponho fazer (limpeza)

**Fase 1 — remover código morto sem risco:**

1. Deletar diretórios:
   - `supabase/functions/zapi-webhook/`
   - `supabase/functions/twilio-whatsapp-webhook/`
   - `supabase/functions/zapi-test-connection/`
   - `supabase/functions/twilio-test-connection/`
2. Deletar arquivos compartilhados não usados:
   - `supabase/functions/_shared/zapi-whatsapp.ts`
   - `supabase/functions/_shared/twilio-whatsapp.ts`
3. Remover o card "Z-API" e o de "Twilio" (se existir) de `src/pages/settings/Integrations.tsx`, junto com a constante `ZAPI_WEBHOOK_URL` e as queries `provider = 'zapi_whatsapp'` / `'twilio_whatsapp'`.

**Fase 2 — renomear os aliases (opcional, só cosmético):**

4. Trocar `getZApiConfig` → `getHook7Config` e `sendWhatsAppViaZApi` → `sendWhatsAppViaHook7` em `_shared/hook7-whatsapp.ts` e nos 7 call sites. Ajuda a legibilidade, mas não muda comportamento.

**Fase 3 — banco (deixar para depois):**

5. Os valores `'twilio_whatsapp'` e `'zapi_whatsapp'` continuam no enum `integration_provider` (usado por `public.integrations.provider`). Não removo agora porque:
   - Exige `DROP TYPE` + recriar enum, arriscado em produção.
   - Se não houver linhas com esses providers, dá pra limpar depois em uma migration dedicada.
   - Posso rodar `SELECT provider, count(*) FROM integrations GROUP BY provider` antes para confirmar que está vazio.

## Fora de escopo

- Não vou mexer no fluxo Hook7 nem em nenhum código de envio/recepção que já funciona.
- Não vou remover o enum agora — fica como decisão sua depois da verificação.

## Confirmação que preciso

Você quer que eu faça **Fase 1 (limpar código morto)** só, ou **Fase 1 + Fase 2 (renomear aliases também)**?