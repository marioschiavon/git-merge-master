## Problema

Na conversa com Kiko:
1. SDR: "Perfeito! Para eu te enviar o convite com o link da reunião, qual o seu melhor e-mail?" (após "Dia 12")
2. Lead respondeu: `Melhoremaol@julianocarneiro.com.br`
3. SDR: "Poderia me dizer o dia e horário exato de sua preferência?" ❌

O fluxo de pedir email já grava `leads.pending_email_slot_hold_id` apontando para o slot que está em hold (linha 878 do `inbound-webhook/index.ts`), mas **nada** consome esse campo quando o lead responde com o email. A IA recebe só "Melhoremaol@...", não identifica como `confirm_slot` e cai em `check_availability` → fallback para perguntar horário.

## Solução

Adicionar um **fast-path determinístico** no `supabase/functions/inbound-webhook/index.ts`, logo após salvar a mensagem inbound (≈ linha 260, antes da chamada à IA `classify-intent`):

1. Verificar se `leadData.pending_email_slot_hold_id` está preenchido.
2. Extrair email da `cleanContent` via regex `/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i`.
3. Se ambos existirem:
   - Buscar o `slot_hold` correspondente e validar que ainda está `status='held'` e `hold_expires_at > now()`.
   - Se o hold ainda é válido:
     - `UPDATE leads SET email = <email>` (apenas se lead ainda não tem email).
     - Invocar `calcom-confirm-booking` com `{ lead_id, selected_slot_hold_id: pending_hold_id }`.
     - Em caso de sucesso: enviar reply de confirmação (`Combinado! Reunião marcada para <data formatada brt>. Até lá!`) via o mesmo caminho de outbound já existente (inserir em `messages` + invocar o canal), pular toda a parte de IA, e retornar.
     - A função `calcom-confirm-booking` já limpa `pending_email_slot_hold_id` (linha 235).
   - Se o hold expirou/foi cancelado: limpar `pending_email_slot_hold_id`, salvar o email mesmo assim, e **deixar o fluxo normal seguir** (a IA vai reabrir negociação de horário com contexto correto).
4. Se não houver email no texto: seguir fluxo normal (a IA já lida).

## Detalhes técnicos

- Local exato: dentro de `inbound-webhook/index.ts`, após o bloco de `skip_insert` (≈ linha 259) e antes da preparação do prompt para `classify-intent`.
- Reaproveitar o helper `formatDateTimeBrt` já usado no arquivo.
- Reaproveitar o mesmo mecanismo de envio outbound já usado nos outros caminhos (insert em `messages` + dispatch pelo canal correto — WhatsApp/Email — seguindo o padrão atual do arquivo).
- Não alterar `classify-intent`, prompt da IA, nem `calcom-confirm-booking`.
- Logs: `console.log("Pending email fulfilled — confirming held slot <uid>")` e variantes para hold expirado.

## Risco de regressão

Baixo: o branch só dispara quando `pending_email_slot_hold_id` está setado E há email no texto. Casos antigos (sem email pendente) seguem o caminho de IA inalterado.
