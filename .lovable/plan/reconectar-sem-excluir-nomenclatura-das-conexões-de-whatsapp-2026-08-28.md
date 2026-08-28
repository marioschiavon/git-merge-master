# Reconectar sem excluir + nomenclatura das conexões de WhatsApp

Hoje as conexões criadas no motor antigo ficam bloqueadas: qualquer ação retorna a mensagem de "conexão antiga" e o único caminho é excluir e criar outra. Isso gera atrito. A conexão pode continuar sendo a mesma linha no sistema — basta reprovisioná-la por baixo e mostrar um QR-Code novo.

## Como fica para o cliente

- A conexão antiga continua na lista, com o aviso "Reconexão necessária" e um botão **Reconectar**.
- Ao clicar em Reconectar, o QR-Code aparece na hora; ele lê pelo celular e o status volta para **Conectado**.
- Nada é excluído: nome da conexão, histórico, conversas, leads e cadências permanecem exatamente como estão.

## Nomenclatura

Nome técnico passa a ser `lead-{empresa}-{nome-da-conexao}`, sem o sufixo aleatório atual.
Se já existir uma conexão com esse mesmo nome na empresa, acrescenta-se um número: `lead-empresa-comercial-2`, `-3`, e assim por diante.

## Escopo técnico

### 1. Nome da instância (`_shared/hook7.ts`)

`buildExternalName(companySlug, displayName, taken: string[])`:
- base = `lead-{slug(empresa)}-{slug(nome)}` (limite de tamanho preservado);
- se a base já estiver em `taken`, tenta `-2`, `-3`… até achar livre.

Quem chama passa a lista de `external_name` já existentes da empresa (consulta em `hook7_instances`). Fallback: em caso de colisão no provedor (erro "already in use"), tenta o próximo número uma vez.

### 2. Ação `reconnect` em `hook7-instance-manage`

Nova ação que opera sobre uma conexão existente (inclusive `engine = 'legacy'`), na mesma linha do banco:

1. Gera novo `external_name` pela regra acima (evita conflito com o nome antigo no provedor).
2. `createInstance` no motor atual, com webhook já configurado e novo token cifrado.
3. Atualiza a linha: `external_name`, `external_id`, `engine = 'evolution_api'`, `status = 'pending'`, limpa `phone_number`, `connected_profile_name`, `user_disconnected_at`, `archived_at`.
4. Retorna o QR-Code (base64) para exibição imediata.
5. Melhor esforço: tenta apagar a instância antiga no provedor (ignora falha — instâncias do motor antigo podem não existir mais).

Idempotência: se a linha já estiver no motor atual, `reconnect` apenas refaz `connect`/QR, sem recriar.

Ações `connect`, `qr` e `status` sobre linhas legadas deixam de retornar erro seco e passam a orientar o uso de `reconnect` (o front chama direto).

### 3. Interface (`WhatsAppManagerDialog`, card de Integrações)

- Substituir o bloqueio atual por um badge "Reconexão necessária" + botão **Reconectar** na própria linha da conexão.
- O botão abre o mesmo painel de QR-Code já usado na criação, com polling de status até "Conectado".
- Remover o texto que pede para excluir e criar de novo.

### 4. Documentação e versão

- `docs/manual/03a-whatsapp-hook7.md`: passo de reconexão (sem excluir nada).
- `docs/patch-logs/2026-08-28.md`: corrigir o item da beta 0.45, que hoje instrui a remover a conexão antiga.
- `APP_VERSION` → `beta 0.46`.

## Validação

- Rodar `reconnect` numa conexão legada: QR aparece, status vai para Conectado, `id` da linha não muda.
- Confirmar que conversas e mensagens antigas dessa conexão continuam visíveis.
- Criar duas conexões com o mesmo nome de exibição e conferir os nomes `...-comercial` e `...-comercial-2`.
- Enviar e receber uma mensagem de teste pela conexão reconectada.
