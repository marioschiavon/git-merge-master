# 03. Integrações (visão geral)

**Quando usar:** **antes** de qualquer criação de cadência ou lead — sem integrações, cadências não disparam.
**Pré-requisitos:** [02](./02-equipe.md).

## Por que integrações vêm antes dos leads

Não adianta importar 1.000 leads antes de conectar canais: você teria mil contatos parados. A ordem correta é:

1. Conectar canais de saída (**WhatsApp** e/ou **email**).
2. Conectar fonte de leads (**Apollo**) ou preparar CSV.
3. Configurar agendamento (**Cal.com**).
4. Só então importar leads e criar cadências.

## Integrações disponíveis

| Integração | Para quê | Obrigatória? |
|---|---|---|
| [WhatsApp (Hook7)](./03a-whatsapp-hook7.md) | Enviar/receber WhatsApp | Sim, se sua cadência tem passo WhatsApp |
| [Email (domínio próprio)](./03b-email-resend.md) | Enviar/receber email por domínio seu | Sim, se sua cadência tem passo Email |
| [Apollo](./03c-apollo.md) | Buscar e importar leads B2B | Recomendada |
| [Pipedrive](./03d-pipedrive.md) | Sincronizar leads/negócios com seu CRM | Opcional |
| [Cal.com](./03e-calcom.md) | Agendar reuniões automaticamente | Obrigatória se cadência oferece reunião |

## Passo a passo

1. Abra **Configurações → Integrações**.
2. Você verá um card por integração. Verde = conectado, cinza = não conectado.
3. Clique **Conectar** no card e siga o guia específico linkado acima.

## Dica

Se você só vai fazer prospecção por **WhatsApp**, ainda vale configurar o email — a IA usa o email como canal de recuperação quando o número está inativo.

**Próximos passos →** [03a. WhatsApp](./03a-whatsapp-hook7.md) · [03b. Email](./03b-email-resend.md) · [03c. Apollo](./03c-apollo.md) · [03d. Pipedrive](./03d-pipedrive.md) · [03e. Cal.com](./03e-calcom.md)
