

## Pausar Cadência Automaticamente ao Receber Resposta

### Problema
A cadência continua executando steps mesmo que o prospect já tenha respondido. Isso gera mensagens automáticas após uma interação real, prejudicando a relação com o lead.

### Solução

Duas frentes:

#### 1. No webhook de resposta (`inbound-email-webhook` / `inbound-webhook`)
Quando uma mensagem `inbound` é registrada numa conversa vinculada a um `cadence_enrollment_id`:
- Buscar o enrollment associado
- Atualizar o status para `paused` e registrar o motivo (`paused_reason: 'lead_replied'`)

#### 2. No executor (`cadence-executor/index.ts`)
Já está filtrado por `status = 'active'`, então enrollments pausados são automaticamente ignorados. Nenhuma mudança necessária aqui.

#### 3. UI: indicação visual + ação manual
Na tela de cadência/enrollments, mostrar um badge "Pausado - Lead respondeu" e um botão para retomar manualmente caso o SDR queira continuar a sequência.

### Detalhes técnicos

**Migração**: Adicionar coluna `paused_reason` (text, nullable) na tabela `cadence_enrollments` para registrar por que foi pausado.

**Arquivo: `supabase/functions/inbound-webhook/index.ts`** (e/ou `inbound-email-webhook`)
- Após inserir a mensagem inbound, verificar se a conversa tem `cadence_enrollment_id`
- Se sim, fazer update no enrollment: `status = 'paused'`, `paused_reason = 'lead_replied'`

**Arquivo: `src/components/CadenceDetail.tsx`** (ou onde enrollments são listados)
- Mostrar badge visual quando `status === 'paused'` e `paused_reason === 'lead_replied'`
- Botão "Retomar cadência" que volta o status para `active`

### Escopo
- 1 migração (adicionar coluna `paused_reason`)
- 2 edge functions alteradas (webhooks de inbound)
- 1 componente UI atualizado (lista de enrollments)

### Resultado
Quando um prospect responde em qualquer step, a cadência pausa automaticamente. O SDR vê a indicação visual e decide se retoma ou encerra a sequência.

