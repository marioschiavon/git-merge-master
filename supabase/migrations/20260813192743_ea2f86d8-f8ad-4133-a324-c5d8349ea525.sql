update public.conversations
set human_takeover = true,
    human_taken_at = now(),
    human_takeover_reason = 'Reuniao prometida ao lead (sex 21/08 15h) sem booking criado no Cal.com - criar reserva e enviar convite manualmente.'
where lead_id = 'a39a75fb-d5cb-4931-89a9-d3a7ad0096d8'
  and channel = 'email';