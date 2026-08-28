# Migração do motor de WhatsApp para o novo padrão da Hook7 (Evolution API v2)

A Hook7 trocou o motor por trás de `api.hook7.com.br`. As rotas antigas (`/instance/create`, `/instance/qr`, `/send/text`, `/user/check`) não existem mais no formato atual — o novo padrão usa rotas com o nome da instância na URL (`/instance/connect/{instance}`, `/message/sendText/{instance}`, `/chat/whatsappNumbers/{instance}`, `/webhook/set/{instance}`) e um formato de eventos totalmente diferente (`MESSAGES_UPSERT`, `CONNECTION_UPDATE`, etc.).

Objetivo: reescrever a camada de integração para o novo motor mantendo a mesma URL base e sem expor nome de motor/fornecedor para o cliente. Para o usuário final, a experiência é: a conexão aparece como desconectada e ele lê o QR-Code de novo — nada além disso.

## O que muda para o cliente

- As conexões atuais passam a aparecer como **Desconectado**, com um aviso: "Atualizamos o serviço de WhatsApp. Reconecte lendo o QR-Code novamente."
- Ao clicar em Conectar, uma conexão nova é criada no novo motor e o QR-Code aparece normalmente.
- Nenhuma menção a "Hook7", "Evolution" ou qualquer motor na interface — apenas "WhatsApp".

## Escopo técnico

### 1. Nova camada de cliente (`_shared/whatsapp-engine.ts`)

Substitui `_shared/hook7.ts` nas chamadas de instância, mantendo base URL de `platform_settings` e o token por instância criptografado (modelo atual continua válido: `token` enviado no `/instance/create` vira a apikey daquela instância).

Mapa de rotas novo:

```text
criar        POST /instance/create            { instanceName, token, qrcode:true, integration:"WHATSAPP-BAILEYS", webhook:{ enabled, url, events, base64:true } }
conectar/QR  GET  /instance/connect/{instance}      → { base64 | code | pairingCode }
estado       GET  /instance/connectionState/{inst}  → { instance:{ state: open|close|connecting } }
logout       DELETE /instance/logout/{instance}
excluir      DELETE /instance/delete/{instance}
listar       GET  /instance/fetchInstances
webhook      POST /webhook/set/{instance}
enviar       POST /message/sendText/{instance}      { number, text }  (fallback textMessage:{text})
checar nº    POST /chat/whatsappNumbers/{instance}  { numbers:[...] } → [{ number, exists, jid }]
mídia        POST /chat/getBase64FromMediaMessage/{instance}
```

Erros: normalizar 401/403 ("credencial inválida"), 404 ("conexão não existe mais" → marca desconectado no banco).

### 2. Instâncias: criação, QR e status

`hook7-instance-manage` reescrita sobre a nova camada:
- `create`: cria no motor já com webhook e eventos, salva token cifrado, guarda `external_id` retornado.
- `connect`/`qr`: usa `/instance/connect/{instance}` (retorna QR base64 direto; deixa de existir a rota `/instance/qr`).
- `status`: traduz `open → connected`, `connecting → pending`, `close → disconnected`.
- `disconnect`: `logout`; `delete`: `logout` + `delete` (mantém a regra atual de logout antes de excluir).
- Instâncias legadas (motor antigo) não são chamadas no motor novo: são marcadas como desconectadas/arquivadas.

Banco: adicionar coluna `engine text default 'evolution_api'` em `hook7_instances` e marcar as existentes como `legacy`, para nunca misturar chamadas dos dois formatos.

### 3. Webhook

Nova função `whatsapp-webhook` (path com secret + slug da empresa, igual hoje) tratando o formato novo:

```text
MESSAGES_UPSERT   → mensagem recebida/enviada (data.key.remoteJid, data.key.fromMe, data.message..., data.messageTimestamp)
MESSAGES_UPDATE   → status delivered/read
CONNECTION_UPDATE → state open/close/connecting → status da instância
QRCODE_UPDATED    → atualiza last_qr_at
SEND_MESSAGE      → ignorado (coberto por fromMe)
```

Toda a lógica de negócio já existente (achar lead pelo telefone, ignorar grupos/broadcast, criar conversa, transcrever áudio, disparar o agente) é reaproveitada — só muda o parser de payload. `hook7-webhook` continua no ar por um período apenas para não perder eventos residuais; deixa de ser registrada em conexões novas.

Áudio: `_shared/hook7-media.ts` passa a usar `/chat/getBase64FromMediaMessage/{instance}` com o corpo novo (`{ message: { key: { id } }, convertToMp4:false }`).

### 4. Envio e verificação de números

- `_shared/hook7-whatsapp.ts` → envio por `/message/sendText/{instance}`; extração do `sid` de `key.id`.
- Verificação de números passa a usar só `/chat/whatsappNumbers/{instance}` (remove a descoberta de rota e o cache `hook7_number_check_path`).
- Sem mudanças em cadências, fila de envio, pacer ou limites de warm-up.

### 5. Interface e textos

- `WhatsAppManagerDialog` e o card de Integrações: remover "Hook7" dos textos; banner de reconexão para conexões legadas.
- `EnrichmentSettingsCard`: "Validar se o número tem WhatsApp" sem citar motor.
- Painel master: card renomeado para "WhatsApp (provedor)"; teste de conexão passa a criar/apagar instância no formato novo.
- Manual (`docs/manual/03a-whatsapp-hook7.md`): revisar passos e acrescentar nota sobre a reconexão obrigatória.

### 6. Versão e patch log

`APP_VERSION` → `beta 0.45` e entrada em `docs/patch-logs/` com a data do dia descrevendo a atualização do serviço de WhatsApp e a necessidade de reconectar.

## Validação

- Criar uma conexão de teste, ler o QR, confirmar status "Conectado".
- Enviar uma mensagem de teste e conferir o registro na conversa.
- Responder pelo celular e confirmar a chegada via webhook (texto e áudio).
- Rodar verificação de números em lote em alguns leads.
