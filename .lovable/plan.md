Diagnóstico

- O webhook do WhatsApp está chegando e o modo agente está ativo.
- O agente entendeu corretamente a mensagem do Juliano: decidiu `book_slot` para `03/jul 16:00`.
- A falha aconteceu na execução do agendamento: o agente chamou a função de criação de booking com o campo errado (`slot_start`), mas a função espera `start` ou, melhor ainda, a confirmação por `slot_hold`.
- Como o erro ficou só gravado em `sdr_agent_runs`, o lead não recebeu resposta de fallback. Por isso pareceu que o sistema parou.

Plano de correção

1. Corrigir o agendamento no modo agente
   - Em `sdr-agent`, quando a decisão for `book_slot`, localizar o `slot_holds` aberto que corresponde ao horário escolhido pelo lead.
   - Confirmar o agendamento usando o fluxo existente de `calcom-confirm-booking`, passando `selected_slot_hold_id`.
   - Isso reaproveita a lógica já pronta que confirma o hold, cancela os outros horários, registra atividade, atualiza cadência e mostra mensagem de sistema.

2. Adicionar fallback para não ficar em silêncio
   - Se o booking falhar, o agente deve enviar uma mensagem curta ao lead, por WhatsApp, dizendo que vai verificar o horário e já retorna.
   - Também marcar `handoff_required` no lead para humano revisar, em vez de deixar o erro invisível.

3. Garantir canal correto na resposta de confirmação
   - Após booking confirmado, enviar a confirmação pelo canal da conversa atual, preservando WhatsApp quando o inbound veio pela Z-API.

4. Reparar este caso específico do Juliano
   - Confirmar o horário que ele escolheu (`03/jul às 16:00`, correspondente ao hold existente), se ainda estiver disponível.
   - Enviar a confirmação para ele no WhatsApp.
   - Se o hold já tiver expirado, oferecer uma alternativa clara em vez de não responder.

Verificação

- Conferir que um novo inbound como “Pode ser dia 3 às 16h” resulta em:
  - um booking criado;
  - o `slot_hold` selecionado como confirmado;
  - outros holds cancelados;
  - uma única mensagem outbound via WhatsApp;
  - `sdr_agent_runs.final_output.live.ok = true`.