Plano ajustado com o payload correto do Hook7 (endpoint `/send/text`, não `/message/sendText/{instance}`). Provavelmente é essa a causa principal do WhatsApp não estar enviando.

## 1. WhatsApp: corrigir endpoint Hook7

**Diagnóstico atualizado:** `supabase/functions/_shared/hook7-whatsapp.ts` (linha 81) faz `POST {base}/message/sendText/{external_name}` com body `{ number, text }`. Isso não bate com a API Hook7 real, que é:

```
POST /send/text
Body: { number, text, delay?, id?, mentionAll?, mentionedJid?, quoted? }
```

O `external_name` da instância provavelmente vai no header (`apikey` = token da instância já identifica), então nada de path param. Isso explica por que 0 mensagens WhatsApp saíram em 7 dias — as tentativas devem estar devolvendo 404 e talvez nem estejam sendo logadas em `messages`.

**Fix em `hook7-whatsapp.ts`:**
- `url` passa a ser `${base}/send/text` (sem `external_name` no path).
- Body permanece `{ number, text }`.
- Mesma mudança aplicada ao `checkPhoneExistsOnWhatsApp` (validar endpoint correto do Hook7 para lookup de número — se não houver, remover a checagem ou marcar como sempre `exists=true`).
- Deploy de `send-outbound-message`, `cadence-executor`, `approval-execute`, `cadence-agent-decide`, `slot-expiry-followup`, `execute-action`, `inbound-webhook`, `zapi-webhook` (todos que importam o helper).

**Validação:** enviar mensagem manual pelo Inbox humano → conferir logs de `send-outbound-message` e `messages.metadata.delivery_status='delivered'`.

## 2. Score de qualificação não funciona

**Diagnóstico confirmado:** `analyze-lead-website` grava score em `lead_insights.score`, mas a UI (`src/pages/Leads.tsx`) lê `lead.score` da tabela `leads` — que está zerado nos 688 leads (avg=0).

**Fix:**
- Em `supabase/functions/analyze-lead-website/index.ts`, após o upsert em `lead_insights`, adicionar:
  ```ts
  await supabase.from("leads")
    .update({ score: scorePayload.score, fit_score: scorePayload.fit_score })
    .eq("id", lead.id);
  ```
- Backfill único via SQL: `UPDATE leads l SET score = li.score, fit_score = li.fit_score FROM lead_insights li WHERE li.lead_id = l.id AND li.score IS NOT NULL;` (checar se `leads.fit_score` existe; senão, só `score`).

## 3. Retirar "Edit with Lovable" do rodapé

Chamar `publish_settings--set_badge_visibility` com `hide_badge=true`. Requer plano Pro (o projeto já usa domínio custom, então deve estar OK; se a chamada falhar por plano, aviso).

## 4. Whitelabel: remover "Resend" da UI

Em `src/pages/settings/Integrations.tsx`:
- Linha 333: `// Email (Resend) — status hook` → `// Email — status hook`
- Linha 856: card `name: "Email (Resend)"` → `name: "Email"`

Varrer restante de `src/**` por menções visíveis a "Resend" e trocar por "Email" mantendo nomes só em código de infra que o usuário não vê. Manuais em `docs/manual/03b-email-resend.md` ficam como estão (documentação técnica) salvo pedido explícito.

## Ordem de execução

1. Fix Hook7 endpoint + redeploy das funções que usam.
2. Fix score + backfill.
3. Whitelabel Resend.
4. Ocultar badge Lovable.
