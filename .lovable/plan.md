Diagnóstico
- A mensagem nova “Dia 22” entrou em `messages` às 14:50:39, mas o `inbound-webhook` não enfileirou o SDR.
- O log mostra `INBOUND_DEDUP_SKIP race lead=a6ba77a3...` logo depois da entrada.
- Causa: existe um índice único em `processed_inbound_messages` por `(lead_id, content_hash)` sem janela de tempo. Como o mesmo lead já tinha enviado “Dia 22” às 14:36, a nova mensagem com o mesmo texto foi tratada como duplicada para sempre.
- Resultado: `pending_inbound_runs` ficou `done`, não houve novo `sdr_agent_runs` após 14:49:55, e o SDR não respondeu à escolha do dia 22.

Plano de correção
1. Ajustar a deduplicação de mensagens repetidas
   - Manter dedup forte por `provider_message_id` da Z-API.
   - Trocar a dedup por texto de “para sempre” para uma janela curta real, como 2 minutos.
   - Assim, duas mensagens iguais em momentos diferentes (“Dia 22” depois de novas opções) serão processadas normalmente.

2. Migração no banco
   - Adicionar um campo de bucket temporal em `processed_inbound_messages` para representar a janela de dedup.
   - Remover o índice único global atual por `(lead_id, content_hash)`.
   - Criar um índice único por `(lead_id, content_hash, content_bucket)`, impedindo corrida apenas dentro da mesma janela curta.
   - Manter índice auxiliar para consulta rápida por lead/hash recente.

3. Atualizar `inbound-webhook`
   - Calcular `content_bucket` no momento do processamento.
   - Inserir `content_bucket` no marcador de dedup.
   - Continuar checando duplicata por conteúdo nos últimos 2 minutos antes de processar.
   - Tratar violação única como duplicata somente quando for dentro do mesmo bucket temporal, não por mensagens antigas.

4. Reprocessar o lead afetado
   - Depois do deploy, disparar o SDR para o lead `a6ba77a3-10d8-4431-acdf-358691acf173` usando a conversa existente.
   - O agente deverá considerar a última mensagem “Dia 22” e as últimas opções oferecidas:
     - segunda-feira, 22 de junho, às 17:45
     - quinta-feira, 25 de junho, às 09:45
   - Esperado: confirmar/remarcar para 22/06 às 17:45 BRT ou responder com erro útil, nunca ficar em silêncio.

5. Validação
   - Conferir `messages` para uma nova resposta outbound entregue.
   - Conferir `sdr_agent_runs` com execução posterior à mensagem de 14:50:39.
   - Conferir `calendar_actions` se houve reschedule/book bem-sucedido ou erro estruturado.
   - Testar cenário de regressão: o mesmo lead enviar “Dia 22” duas vezes com mais de 2 minutos de diferença deve disparar o SDR na segunda vez.