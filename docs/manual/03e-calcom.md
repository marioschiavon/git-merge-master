# 03e. Cal.com

**Quando usar:** sempre que sua cadência oferecer **reunião** ao lead (na prática, praticamente todas oferecem).
**Pré-requisitos:** conta no Cal.com com **pelo menos 1 tipo de evento** configurado (ex.: "Diagnóstico de 30 minutos").

## O que é

Cal.com é uma agenda online (parecido com o Calendly). Cada empresa do Leaderei conecta **sua própria conta Cal.com** — as reuniões vão para a agenda da sua equipe, não para uma central compartilhada. Quando conectado, o agente IA passa a **oferecer 2 horários reais** ao lead interessado, com **hold de 2 horas** (segura o horário). Se o lead confirmar, a reunião é criada automaticamente na sua agenda. Se ele não responder, o horário volta a ficar disponível para outro prospect.

## Passo a passo

### 1. Preparar seu evento no Cal.com

Se ainda não tiver, crie um tipo de evento:

1. No Cal.com, menu à esquerda → **Event Types** → **New**.
2. Nome sugerido: **Diagnóstico 30min**.
3. Duração: 30 minutos (ou o que fizer sentido).
4. Deixe-o **público** (não privado) — se for privado, o agente não consegue oferecer.
5. Configure sua **disponibilidade** (dias e horários que aceita reuniões).

### 2. Gerar a API key no Cal.com

Uma **API key** é a senha longa que autoriza o Leaderei a criar reuniões em sua agenda.

1. No Cal.com, canto inferior esquerdo, clique **Settings**.
2. No menu, vá em **Developer** → **API Keys**.
3. Clique **Add** → dê um nome (ex.: "Leaderei") → **Save**.
4. **Copie a chave** — o Cal.com só mostra uma vez.

### 3. Conectar no Leaderei

1. **Configurações → Integrações → Cal.com** → **Configurar**.
2. Cole a API key no campo indicado.
3. (Opcional) Cole o link público de agendamento (`https://cal.com/seunome/30min`).
4. Clique **Testar conexão** para validar. Se OK, clique **Conectar**.
5. Após conectar, a tela mostra:
   - **URL do webhook** (única desta empresa, com seu slug no final).
   - **Secret HMAC** (32 bytes aleatórios, único desta empresa).

### 4. Cadastrar o webhook no Cal.com

1. No Cal.com, **Settings → Developer → Webhooks → New**.
2. Cole a **URL do webhook** copiada do Leaderei.
3. Cole o **Secret** copiado do Leaderei em "Secret".
4. Marque os eventos:
   - `BOOKING_CREATED`
   - `BOOKING_RESCHEDULED`
   - `BOOKING_CANCELLED`
   - `BOOKING_NO_SHOW_UPDATED`
   - `MEETING_ENDED`
5. Salve.

### 5. Escolher tipo de evento padrão (opcional)

Em **Configurações → Cal.com → Team & Round-Robin**, você pode definir qual tipo de evento o agente deve usar por padrão. Se deixar em branco, o Leaderei usa o primeiro tipo público da conta.

## Dicas

- Cada empresa tem **sua própria conexão** — a API key da empresa A nunca é usada pela empresa B.
- Configure **buffers** entre reuniões no Cal.com (ex.: 10 min antes/depois). Evita reuniões coladas.
- O **timezone** do Cal.com precisa bater com o das Configurações Gerais do Leaderei. Diferença de fuso gera confusão de horários.
- Se o lead cancela pelo Cal.com, o horário volta a ficar livre automaticamente — o Leaderei percebe via webhook.
- Para trocar a API key, desconecte e conecte novamente. O secret do webhook é regenerado.

## Problemas comuns

- **"Cal.com não conectado para esta empresa"** → vá em Integrações → Cal.com → Configurar e cole a API key.
- **Webhook inválido** → confira se o secret cadastrado no Cal.com é exatamente o mesmo mostrado no Leaderei.
- **Evento privado no Cal.com** → o agente não consegue oferecer. Deixe público.
- **Disponibilidade curta demais** (ex.: só 30 min por dia) → quase nunca terá slot livre para oferecer.
- **API key revogada** → gere nova no Cal.com, desconecte no Leaderei e conecte de novo com a nova key.

**Próximo passo →** [04. Base de Conhecimento](./04-base-de-conhecimento.md)
