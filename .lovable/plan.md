

# Fluxo Completo: Email + Auto-resposta + Follow-ups Multi-canal + Execução Manual

## Resumo

Fechar o ciclo completo de automação: o sistema envia o primeiro email, recebe respostas, continua a conversa automaticamente pelo mesmo canal, e quando não há resposta, escala para outros canais (WhatsApp, ligação) nos follow-ups. Inclui botões na interface para gerar cadência completa com IA e executar manualmente para testes.

## O que será feito

### 1. Envio real de auto-respostas por email no `inbound-webhook`
Quando o lead responde e a IA decide `action: "reply"`, o sistema hoje salva a mensagem no banco mas **não envia de volta**. Vamos substituir o `// TODO` por uma chamada ao `send-transactional-email`, fechando o loop da conversa por email.

### 2. Nova edge function `inbound-email-webhook`
Recebe respostas de email via webhook (formato padrão de forwarding), identifica o lead pelo email do remetente, e encaminha para o `inbound-webhook` existente para análise pela IA.

### 3. Cadence executor com suporte multi-canal
O `cadence-executor` já envia email. Vamos adicionar:
- **WhatsApp**: quando o step for `whatsapp` e o Twilio estiver conectado, envia via Twilio Gateway
- **Ligação/Phone**: registra a tarefa de ligação e cria atividade no lead (para o SDR humano executar)
- **LinkedIn**: registra mensagem como tarefa manual (LinkedIn não tem API aberta)

Isso permite cadências multi-canal onde o primeiro contato é por email e os follow-ups escalam para WhatsApp e ligação.

### 4. Botão "Gerar cadência completa com IA" na interface
No `CadenceDetail.tsx`, um botão que gera automaticamente 5 steps multi-canal com delays progressivos:
- Step 1: Email (dia 0)
- Step 2: Email follow-up (dia 3)
- Step 3: WhatsApp (dia 5)
- Step 4: Email reforço (dia 7)
- Step 5: Ligação (dia 10)

Usa a IA para gerar os templates de cada step.

### 5. Botão "Executar agora" para teste
Na aba de Leads da cadência, botão para disparar o `cadence-executor` manualmente sem esperar o cron de 5 minutos.

### 6. Conectar Twilio (pré-requisito para WhatsApp)
Usar o conector Twilio para habilitar envio de WhatsApp. Se não conectado, os steps de WhatsApp ficam como "pendente de configuração".

## Arquivos modificados/criados

| Arquivo | Ação |
|---------|------|
| `supabase/functions/inbound-webhook/index.ts` | Adicionar envio real de auto-resposta via `send-transactional-email` |
| `supabase/functions/inbound-email-webhook/index.ts` | Novo — recebe respostas de email e encaminha para análise |
| `supabase/functions/cadence-executor/index.ts` | Adicionar envio WhatsApp via Twilio Gateway e registro de ligação |
| `src/components/CadenceDetail.tsx` | Botões "Gerar cadência com IA" e "Executar agora" |
| `src/hooks/useCadences.ts` | Hook para execução manual da cadência |
| `supabase/config.toml` | Configurar `verify_jwt = false` para `inbound-email-webhook` |

## Fluxo final

```text
1. Usuário cria cadência → clica "Gerar com IA" → 5 steps multi-canal criados
2. Associa leads → clica "Executar agora" (ou espera cron)
3. Step 1 (email): IA gera mensagem → envia via send-transactional-email
4. Lead responde email → inbound-email-webhook → inbound-webhook → IA analisa
   4a. Objeção/dúvida → IA responde automaticamente pelo mesmo canal (email)
   4b. Interesse em reunião → marca meeting_scheduled, para cadência
   4c. Rejeição → pausa cadência
5. Sem resposta → cron avança para próximo step:
   Step 2 (email follow-up, dia 3)
   Step 3 (WhatsApp, dia 5) → envia via Twilio
   Step 4 (email reforço, dia 7)
   Step 5 (ligação, dia 10) → cria tarefa para SDR humano
6. Cadência completa sem resposta → status "completed"
```

