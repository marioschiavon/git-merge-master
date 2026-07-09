# 10. Cadências

**Rota:** `/cadences`
**Quando usar:** criar a sequência de mensagens que a IA vai enviar a cada lead.
**Pré-requisitos:** [09](./09-listas.md), integrações prontas, base de conhecimento preenchida.

## O que é

Uma cadência é uma sequência de **passos** (WhatsApp/Email), com intervalos entre eles e regras de parada quando o lead responde. A IA gera a **primeira mensagem** de cada lead na hora, usando a Base de Conhecimento.

## Passo a passo

1. **Cadências → Nova cadência**.
2. Preencha nome, canal principal e objetivo (ex.: agendar reunião).
3. Adicione **passos**:
   - Passo 1 — WhatsApp — dia 0 — apresentação.
   - Passo 2 — Email — dia 2 — follow-up com case.
   - Passo 3 — WhatsApp — dia 5 — quebra-gelo curto.
4. Escolha **modo**:
   - **Simulação** — não envia nada, só mostra o que enviaria (ótimo para calibrar).
   - **Automático** — envia sem aprovação humana.
   - **Com aprovação** — a primeira mensagem cai em [Aprovações](./11-aprovacoes.md) antes de sair.
5. Ative reengajamento (opcional): se o lead não responder em N dias, retoma.
6. Salve como **Rascunho** ou **Ativa**.

## Como inscrever leads

Três formas:
1. **Automático via lista** — se a lista tem cadência padrão, novos leads entram sozinhos.
2. **Em lote pela tela de Leads** — selecione + "Enviar para cadência".
3. **Manual** — no detalhe do lead, botão "Inscrever em cadência".

## Dicas

- Comece **sempre em Simulação** por 1 dia. Revise as mensagens geradas. Só então ative.
- Máximo 4-5 passos. Cadências longas irritam.
- Deixe **intervalos maiores em fim de semana** (o motor já respeita janela comercial, mas evite spamar segunda cedo).

**Próximo passo →** [11. Aprovações](./11-aprovacoes.md)
