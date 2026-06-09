# Edição de Leads + campo WhatsApp dedicado

## Objetivo
Permitir editar todas as informações de um lead a partir da página **Leads**, incluindo um campo dedicado de **WhatsApp** separado do telefone tradicional.

## Passos

### 1. Schema — coluna WhatsApp
Adicionar `whatsapp text` (nullable) à tabela `leads`. Migração curta — apenas `ALTER TABLE`.

### 2. Hook `useUpdateLead`
Em `src/hooks/usePipedrive.ts` (onde já vivem `useCreateLead`, `useDeleteLead`), adicionar mutation `useUpdateLead` que faz `update` em `leads` por `id` e invalida a query da lista.

### 3. Reaproveitar `LeadFormDialog` para edição
Atualmente o componente só cria. Vou estender:
- Nova prop opcional `lead?: Lead`
- Quando presente, preenche `defaultValues` com os dados do lead, troca o título para "Editar Lead" e chama `useUpdateLead` em vez de `useCreateLead`
- Adicionar campo **WhatsApp** ao schema/form (logo abaixo de Telefone)

### 4. Botão "Editar" em `Leads.tsx`
Na coluna de ações da tabela (mesma célula do excluir), adicionar ícone de lápis que abre o `LeadFormDialog` no modo edição. Estado local `editingLead`.

### 5. Integração WhatsApp (Twilio) usa `whatsapp || phone`
Atualizar `cadence-executor` e `twilio-whatsapp-webhook` para preferir `lead.whatsapp` quando preenchido, com fallback para `phone`. Mantém compatibilidade com leads existentes.

## Detalhes técnicos

**Validação (zod):**
- `whatsapp`: opcional, máx 50 chars, mesma máscara livre de `phone` (E.164 sugerido no placeholder, ex: `+5511999998888`)
- Demais campos mantêm validação atual

**RLS:** já coberta — política `Members can manage their company leads` permite UPDATE para a empresa.

## Fora do escopo
- Histórico de alterações
- Edição inline na tabela (apenas via dialog)
- Validação rígida do formato E.164 (apenas placeholder informativo)

## Resultado esperado
Botão de edição em cada linha de Leads abre o mesmo dialog usado para criar, com os dados preenchidos, incluindo campo WhatsApp dedicado. Cadências e webhook do Twilio passam a usar o WhatsApp do lead quando informado.
