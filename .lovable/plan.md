# Data e hora em cada mensagem de Conversas

## O que muda para o cliente
- Cada mensagem em Conversas mostra o dia e a hora do envio (ex.: "29/09 às 14:32"), no horário de Brasília, logo abaixo do texto.
- Mensagens de anos anteriores também mostram o ano (ex.: "12/12/2025 às 09:10").
- Um separador por dia ("Hoje", "Ontem", "seg., 28/09") divide a conversa, para facilitar a leitura e a investigação.
- Nas mensagens enviadas pelo app, o status aparece ao lado da hora quando existir: "Entregue", "Na fila" ou "Falhou".
- Passando o mouse sobre a hora, aparece a data completa com segundos.

## Detalhes técnicos
- Arquivo: `src/pages/Conversations.tsx`, bloco das mensagens.
- Usar `sent_at` (com fallback para `created_at`), formatado em America/Sao_Paulo; novos helpers em `src/lib/datetime.ts` (`formatBRTMessage`, `formatBRTDayLabel`, `formatBRTFull`).
- Status a partir de `metadata.delivery_status`.
- Mensagens de sistema passam a usar o mesmo helper (hoje usam o fuso do navegador).
- Subir versão para beta 0.67 e registrar no patch log e em `docs/manual/13-conversas.md`.
