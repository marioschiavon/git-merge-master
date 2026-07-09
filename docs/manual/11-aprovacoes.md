# 11. Aprovações

**Quando usar:** para revisar mensagens geradas pela IA antes de sair — modo mais seguro no início.
**Pré-requisitos:** cadência configurada em modo "Com aprovação".

## O que é

Fila de mensagens que a IA gerou mas está segurando para revisão humana. Aparece um badge com contador no menu lateral.

## Passo a passo

1. Abra **Aprovações**. Cada card mostra: lead, canal, prévia da mensagem.
2. Você pode:
   - **Aprovar** → mensagem sai imediatamente.
   - **Editar e aprovar** → ajuste texto e libere.
   - **Rejeitar** → mensagem descartada, cadência pula para o próximo passo.
3. Existe também "Aprovar todas" para acelerar.

## Dicas

- Nos **primeiros dias** aprove tudo manualmente para calibrar tom da IA.
- Se as mensagens estão consistentemente boas, mude a cadência para **Automático** com um limite diário (ex.: `auto_approve_max_per_day = 30`).
- Rejeições viram sinal para IA melhorar: sempre escreva uma anotação explicando por que rejeitou (opcional).

**Próximo passo →** [12. Acompanhamento](./12-acompanhamento.md)
