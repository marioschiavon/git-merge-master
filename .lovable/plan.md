# Telefones em formato errado quebram a verificação de WhatsApp

## O que está acontecendo (confirmado nos dados)

Os leads vindos do MunicipIA estão gravados com o telefone exatamente como aparece no site da prefeitura, sem código do país:

- `(11) 4414-3430`
- `(99) 9.9229-3302`
- `(86) 9 9436-6868`
- `(91) 985654319`

Já as importações por planilha (CSV) gravam no padrão certo: `+5511978878830`.

Quando o app vai perguntar ao WhatsApp se o número existe, ele só remove os símbolos e envia `1144143430` — sem o `55` do Brasil e, em muitos casos, sem o `9` do celular. O WhatsApp responde "não existe", e o lead fica marcado como **sem WhatsApp** mesmo tendo. Hoje praticamente todo lead do MunicipIA com telefone está marcado como inválido.

Também há telefones fixos misturados (4 dígitos iniciais tipo `3643-2333`), que realmente não têm WhatsApp — esses continuarão inválidos, e está correto.

## O que será feito

1. **Uma única regra de formatação de telefone** para o app inteiro, aplicada em toda entrada de lead: MunicipIA, planilha CSV, Apollo, Pipedrive, cadastro manual e o que chega pelo WhatsApp. Resultado sempre no padrão internacional `+55DDDNÚMERO`.
   - Remove pontuação, espaços e o `0` de operadora.
   - Sem código de país, assume Brasil (`55`).
   - Celular antigo de 8 dígitos em DDD que exige o nono dígito ganha o `9`.
   - Números já internacionais (outro país) são preservados como estão.
   - Telefone curto/incompleto demais é descartado em vez de gravado torto.
2. **A verificação de WhatsApp passa a formatar antes de perguntar** — assim, mesmo leads antigos gravados torto são consultados corretamente.
3. **Correção do que já está no banco**: os telefones existentes serão regravados no padrão e os leads que foram marcados como "sem WhatsApp" por esse motivo voltam para "não verificado", entrando na próxima varredura automática.
4. **Envio de mensagem** usa a mesma regra, evitando falha de entrega por número mal formatado.

## Detalhes técnicos

- Novo `supabase/functions/_shared/phone-br.ts` com `normalizePhoneBR(raw): string | null` (saída E.164) e `toWhatsAppDigits()`; espelho em `src/lib/phone.ts` para o front.
- Aplicar em: `municipia-ingest` (`phone`, `telefones`, membros de equipe), `_shared/apollo.ts`, `pipedrive-sync`, `src/components/LeadImportDialog.tsx`, `src/components/LeadFormDialog.tsx`.
- `whatsapp-verify-numbers`: substituir `digits()` por `toWhatsAppDigits(normalizePhoneBR(...))`, mantendo o mapa telefone→lead pelo valor normalizado.
- `_shared/hook7-whatsapp.ts`: `normalizePhone` interno passa a delegar para o normalizador BR (envio e checagem).
- Migração de dados: `UPDATE leads` normalizando `phone`, `mobile_phone`, `corporate_phone`, `whatsapp` via função SQL equivalente; `whatsapp_valid = null, whatsapp_checked_at = null` nas linhas cujo telefone mudou de forma.
- Bump para beta `0.55` + entrada em `docs/patch-logs/2026-09-10.md`.
