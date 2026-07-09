# 03. Integrações (visão geral)

**Quando usar:** **antes** de importar leads ou criar cadências. Sem integrações conectadas, o app não consegue enviar mensagens nem agendar reuniões.
**Pré-requisitos:** [02. Equipe](./02-equipe.md).

## O que é uma "integração"?

É a ponte entre o Leaderei e outra ferramenta que você já usa (seu WhatsApp, seu email, seu CRM, sua agenda). Conectar uma integração é como dar uma chave para o Leaderei entrar naquela ferramenta em seu nome — para enviar uma mensagem, criar uma reunião ou buscar um contato.

Você conecta uma vez e o Leaderei cuida do resto.

## Integrações disponíveis hoje

| Integração | Serve para | É obrigatória? |
|---|---|---|
| [WhatsApp (Hook7)](./03a-whatsapp-hook7.md) | Enviar e receber mensagens no WhatsApp | Sim, se sua cadência tem passo de WhatsApp |
| [Email (domínio próprio)](./03b-email-resend.md) | Enviar e receber emails com o **seu** domínio (`atendimento@suaempresa.com.br`) | Sim, se sua cadência tem passo de email |
| [Apollo](./03c-apollo.md) | Buscar e importar leads B2B (nome, cargo, empresa, LinkedIn, telefone) | Recomendada |
| [Pipedrive](./03d-pipedrive.md) | Sincronizar leads e negócios com seu CRM | Opcional |
| [Cal.com](./03e-calcom.md) | Deixar o agente IA marcar reuniões automaticamente na sua agenda | Obrigatória se a cadência oferece reunião |

## Ordem recomendada de conexão

Faz diferença conectar nessa ordem:

1. **Canal de saída primeiro** — WhatsApp e/ou Email. Sem canal, nada sai.
2. **Fonte de leads** — Apollo (ou prepare um CSV).
3. **Agenda** — Cal.com, para o agente saber quais horários oferecer.
4. **CRM** (se usar) — Pipedrive, para tudo aparecer também no seu funil.

Só **depois** disso vale a pena importar leads e criar cadências. Fazer o contrário só gera lista parada.

## Como conectar

1. No menu lateral, abra **Configurações → Integrações**.
2. Você vai ver um card para cada integração:
   - **Verde / Conectado** → tudo certo, pode usar.
   - **Cinza / Não conectado** → ainda falta configurar.
3. Clique **Conectar** no card desejado. Cada integração tem seu próprio guia detalhado (links na tabela acima).

## Dica

Mesmo que sua estratégia principal seja WhatsApp, vale conectar o email. Quando um número fica sem resposta, o agente IA tenta pelo email como plano B — e isso costuma recuperar 10-20% dos leads.

**Próximos passos →** [03a. WhatsApp](./03a-whatsapp-hook7.md) · [03b. Email](./03b-email-resend.md) · [03c. Apollo](./03c-apollo.md) · [03d. Pipedrive](./03d-pipedrive.md) · [03e. Cal.com](./03e-calcom.md)
