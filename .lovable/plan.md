# Agendar e remarcar direto do painel do operador

Hoje o `HumanCopilotPanel` só tem "Sugerir 2 horários" + "Cancelar". Vamos transformar a seção **Agenda** em um mini-cockpit Cal.com embutido no chat, com 3 ações de primeira classe:

1. **Sugerir horários** (já existe, refinado)
2. **Agendar agora** — escolher data + horário disponível + convidados extras, sem deixar o /inbox
3. **Remarcar reunião ativa** — mesma UX, pré-carregando a reunião atual

## UX (dentro do `HumanCopilotPanel`)

Nova seção "Agenda" com 3 botões/abas: `Sugerir` · `Agendar` · `Remarcar`.

### Agendar (novo)
- DatePicker (shadcn Calendar em Popover, dia ≥ hoje+24h)
- Ao escolher a data, chamamos `calcom-slots` para aquele dia e renderizamos chips com os horários reais disponíveis
- Campo "Convidados (e-mails)" — input com chips, valida formato, opcional
- Toggle "Avisar lead pelo chat" (default ligado)
- Botão "Confirmar agendamento" → confirma e fecha a UI inline, mantendo o operador na conversa

### Remarcar (novo)
- Mostra a reunião ativa do lead (data atual + UID) buscada via `bookings`
- Mesma UI de data + chips de horário do dia escolhido
- Campo "Motivo" (opcional) e toggle de aviso ao lead
- Botão "Remarcar" → chama `human-reschedule-booking`

### Sugerir (mantido)
- Continua oferecendo 2 holds prontos para o operador inserir no compositor

## Backend (mudanças mínimas)

- **`human-book-slot`**: aceitar `guests: string[]` e `notes?: string`; quando vier `start` (caminho 2), repassar para `calcom-booking-create` que já suporta `guests`. Quando vier `hold_id` + `guests`, após confirmar chamar `calcom-add-guests` com o `booking_uid` retornado.
- **`human-reschedule-booking`**: já aceita `start`; adicionar passagem opcional de `guests` (chama `calcom-add-guests` após reschedule).
- **Novo endpoint leve `human-day-slots`** (ou parâmetro `day` em `human-offer-slots` sem criar holds): recebe `conversation_id` + `date` (YYYY-MM-DD) e retorna a lista bruta de horários do Cal.com daquele dia, sem reservar holds (para preencher os chips). Usa o mesmo `calcom-slots` com `start_after`/`end_before` cobrindo o dia, mas com flag `no_hold: true`.
  - Para não mexer no fluxo de holds existente, a opção mais segura é fazer o `human-day-slots` chamar a API do Cal.com diretamente (reusa `resolveEventTypeId`) e devolver apenas `[{ start, label }]`, sem persistir.
- **Buscar reunião ativa**: novo endpoint `human-active-booking` que devolve `{ booking_uid, scheduled_at, attendees }` do lead da conversa — usado pela aba Remarcar.

## Frontend (arquivos)

- **Editar** `src/components/inbox/HumanCopilotPanel.tsx`:
  - Substituir bloco "Agenda" por sub-componente `<ScheduleTabs />` com as 3 abas
  - Adicionar estado de date, slots-do-dia, guests, notes, reason
- **Novo** `src/components/inbox/GuestsInput.tsx` — input com chips de e-mail
- **Novo** `src/components/inbox/DaySlotPicker.tsx` — DatePicker + grid de chips de horário (fetch via `human-day-slots`)
- **Novo hook** `src/hooks/useActiveBooking.ts` — busca a reunião ativa via `human-active-booking`

## Detalhes técnicos

- DatePicker: shadcn `Calendar` em `Popover`, com `pointer-events-auto` (regra do projeto). `disabled={(d) => d < addHours(now,24)}`.
- Chips de horário renderizados em grid de 3 colunas, formatados em pt-BR com `formatBRTLong`.
- Validação de e-mail no `GuestsInput`: regex `/^[\w.+-]+@[\w-]+\.[\w.-]+$/`, dedupe com o e-mail do lead.
- Toast de sucesso/erro mantém padrão `sonner` já usado no painel.
- Estado controlado: ao confirmar, limpamos date/slots/guests; copilot continua aberto na conversa.

## Fora de escopo

- Editar duração da reunião / event type (continua usando o default da company).
- Conflitos de calendário do operador — confiamos no Cal.com.
- Drag-and-drop de horários, calendário tipo timeline.
- Histórico de tentativas de agendamento nesta tela (já existe na timeline do lead).
