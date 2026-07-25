## Plano

Vamos transformar o **Executar Agora** em um fluxo de fila, para não depender de uma chamada longa que tenta processar vários leads ao mesmo tempo.

### 1. Criar uma fila de execução de cadência
- Adicionar uma tabela de fila para cada lead inscrito em cadência.
- Cada item terá: empresa, cadência, enrollment/lead, status (`pending`, `processing`, `done`, `failed`), tentativas, erro, horário agendado e trava anti-duplicidade.
- Garantir `GRANT` e RLS corretamente no backend.
- Evitar duplicar o mesmo enrollment na fila quando o usuário clicar várias vezes.

### 2. Mudar o botão “Executar Agora”
- Ao clicar, o app vai **enfileirar todos os leads ativos da cadência**, não executar só o primeiro.
- A resposta para o usuário será algo como: “X leads enfileirados para execução”.
- O botão deixa de depender de todos os envios terminarem dentro da mesma requisição.

### 3. Criar/ajustar worker da fila
- O worker vai buscar itens `pending` da fila em pequenos lotes.
- Cada item será processado de forma controlada:
  - se a cadência for agentic, chama `cadence-agent-decide` para aquele enrollment;
  - se for cadência por steps, usa o fluxo atual do `cadence-executor` para aquele enrollment.
- Ao terminar, marca o item como `done`; em erro, marca como `failed` ou reagenda com tentativa.

### 4. Manter boas práticas de envio
- A fila de cadência será responsável por **orquestrar os leads**.
- O envio final continua respeitando as proteções existentes:
  - WhatsApp passa pela `whatsapp_send_queue`, com gap, caps e warm-up;
  - Email pessoal via Nylas continua usando o grant conectado;
  - HITL/aprovações continuam pausando o enrollment quando necessário.

### 5. Agendamento automático
- Agendar o worker para rodar periodicamente no backend.
- Quando clicar em “Executar Agora”, além de enfileirar, disparar o worker em background para começar imediatamente.

### 6. Observabilidade
- Retornar no frontend quantos leads foram enfileirados.
- Registrar erros por item da fila para sabermos exatamente qual lead falhou e por quê.
- Opcionalmente exibir no futuro uma visão “Fila da cadência”, mas não vou criar tela nova agora para não aumentar o escopo.

### 7. Versão
- Incrementar `APP_VERSION` para a próxima beta após a implementação.

## Resultado esperado

Ao clicar em **Executar Agora**, todos os leads ativos daquela cadência entram em uma fila e são processados um a um/por pequenos lotes, sem travar no primeiro lead e sem depender de uma chamada longa que pode estourar timeout.