# Por que os números caíram — e como reforçar o aviso

## O que aconteceu em cada conexão

| Conexão | Número | Caiu em | Motivo registrado |
|---|---|---|---|
| Renan - Pessoal (Leaderei) | 44 9849-6222 | 15/09 10h07 (último vínculo) | O próprio usuário desconectou pelo app às 15h40 e depois o aparelho deslogou (`reason=401`). Nunca foi reconectado. |
| WhatsApp Andrea novo (Qualé) | 11 93337-1087 | 15/09 20h42 | Aparelho deslogou o dispositivo (`reason=401`) — é o "Sair" nos aparelhos conectados do WhatsApp, ou o celular ficou muito tempo sem internet. |
| Comercial - Arrecadeei2 | 11 97190-2172 | 16/09 10h16 | Recusa do WhatsApp na reconexão (`reason=403`), 1ª ocorrência. Não é banimento: o mesmo número já voltou antes. |
| Sup (interno) | 41 9547-2941 | — | Conectada e saudável. |

Resumo: nenhuma queda foi causada por falha do app. Todas vieram do lado do
celular — sessão encerrada no aparelho — e ninguém leu o QR-Code de novo. Os
três já receberam o e-mail automático de aviso (enviado 30 min após a queda),
mas nada foi feito desde então.

## Reforço proposto nos avisos

1. **Motivo visível no app.** O aviso vermelho no topo e o card da conexão em
   Integrações passam a dizer, em linguagem simples, o que aconteceu:
   "o aparelho encerrou a sessão — leia o QR-Code de novo" (401), ou "o WhatsApp
   recusou a reconexão — tente novamente em alguns minutos" (403), em vez do
   texto genérico atual.
2. **Há quanto tempo está fora.** O aviso mostra "fora do ar há 2 dias", para
   deixar claro que não é uma oscilação momentânea.
3. **E-mail de lembrete.** Hoje o administrador recebe um único e-mail, 30 min
   após a queda. Passa a receber um lembrete a cada 24 h enquanto a conexão
   seguir fora, até no máximo 3 lembretes (depois a conexão é arquivada pela
   regra dos 7 dias).
4. **Botão direto no aviso.** O aviso do topo ganha um botão "Reconectar" que
   abre a tela da conexão já no passo do QR-Code, em vez de só linkar para
   Integrações.

## Detalhes técnicos

- Migração: nova coluna `disconnect_reminder_count` (int, default 0) e
  `disconnect_last_reminder_at` em `hook7_instances`; zeradas ao reconectar
  junto com `disconnect_notified_at`.
- `whatsapp-reconcile-cron`: além do primeiro aviso aos 30 min, dispara
  `send-transactional-email` quando `now() - disconnect_last_reminder_at >= 24h`
  e `disconnect_reminder_count < 3`; `idempotencyKey` passa a incluir o número
  do lembrete.
- Template `whatsapp-disconnected.tsx`: novos props `downSince` e `reason`
  (texto já traduzido) + variação de assunto para lembrete.
- `useWhatsAppConnectionAlert`: passa a devolver `last_error` e
  `last_connected_at`; nova função em `src/lib/whatsapp-status.ts` traduz
  `reason=401/403/LoggedOut` para texto ao cliente.
- `WhatsAppConnectionBanner`: mostra motivo + tempo fora e botão que navega para
  `/settings/integrations?reconnect=<id>`; `Integrations.tsx` lê o parâmetro e
  abre o `WhatsAppManagerDialog` já na conexão indicada.
- Versão beta 0.58 e nova entrada em `docs/patch-logs/`.
