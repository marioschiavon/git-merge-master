# 03e. Cal.com

**Rota:** `/settings/calcom`
**Quando usar:** sempre que sua cadência oferece **reunião** (na prática, quase todas).
**Pré-requisitos:** conta Cal.com com pelo menos 1 tipo de evento configurado.

## O que é

Quando um lead demonstra interesse, o agente IA oferece **2 horários reais** com **hold de 2 horas** — se ele confirmar, a reunião é criada no Cal.com. Se não responder, os horários voltam para o pool.

## Passo a passo

1. Em Cal.com, crie um evento (ex.: "Diagnóstico 30min") e configure disponibilidade.
2. Gere uma **API key** em Cal.com → **Settings → Developer**.
3. No Leaderei: **Configurações → Cal.com → Conectar**, cole a API key.
4. Escolha o **tipo de evento** padrão que a cadência vai oferecer.
5. Salve.

## Dicas

- Deixe **buffers** entre reuniões no Cal.com — evita agenda travada.
- Configure **timezone** no Cal.com igual ao das configurações gerais do Leaderei.
- Reuniões canceladas pelo lead voltam a liberar o horário automaticamente.

## Erros comuns

- Evento **privado** no Cal.com — o agente não consegue oferecer. Deixe público.
- Horário de trabalho de 30 minutos por dia — praticamente nunca vai ter slot livre.

**Próximo passo →** [04. Base de Conhecimento](./04-base-de-conhecimento.md)
