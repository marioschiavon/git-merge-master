# 01. Configurações gerais

**Quando usar:** primeira coisa depois de entrar.
**Pré-requisitos:** conta criada.

## O que é

A tela **Configurações** (menu lateral) reúne quatro áreas:

1. **Empresa** — nome, fuso horário e janela de envio das cadências.
2. **Meu perfil** — seus dados pessoais (nome, telefone, email).
3. **Qualificação de Leads (Score)** — critério que a IA usa para dar nota aos seus leads.
4. **Human-in-the-Loop** — chave que exige revisão humana antes de qualquer envio.

Confira cada bloco abaixo.

---

## 1. Empresa

Dados básicos da sua empresa dentro do Leaderei.

### Passo a passo

1. **Nome da empresa** — é o que aparece no rodapé dos emails, no cabeçalho da sidebar e na apresentação da IA ("Fala, aqui é do time da **[Empresa]**"). Escreva exatamente como quer que apareça.
2. **Fuso horário** — escolha o fuso onde a **maioria dos seus prospects** está (não necessariamente o seu).
3. **Janela de envio** — defina hora de início, hora de fim e os dias da semana em que as cadências podem enviar mensagens (ex.: 09:00–18:00, seg–sex). Fora dessa janela, as cadências pausam automaticamente.
4. Clique em **Salvar empresa**.

### Dicas

- O nome é usado literalmente pela IA — cuidado com caixa alta ("LEADEREI" vira "Fala, aqui é do time da LEADEREI").
- Se você atende clientes em fusos diferentes, use o fuso onde estão os prospects, não o do seu escritório.

### Erros comuns

- Deixar janela 24/7 ou todos os dias marcados: dispara mensagem 3h da manhã e queima o número.
- Fuso errado: cadência que deveria sair 9h da manhã sai às 6h e o prospect ignora.

---

## 2. Meu perfil

Seus dados pessoais dentro da plataforma.

### Passo a passo

1. Preencha **Nome completo** e **Telefone**.
2. O **Email** aparece apenas para conferência (não é editável — para trocar, use o fluxo de conta).
3. Clique em **Salvar perfil**.

---

## 3. Qualificação de Leads (Score)

Critério que a IA usa para dar uma **nota de 0 a 100** a cada lead com base no site dele. Serve para você priorizar quem trabalhar primeiro e evitar queimar cadência com quem claramente não é ICP.

Você escreve:
- Um **prompt** listando os critérios objetivos ("Critério 1: tem página X…").
- Palavras/temas que **AUMENTAM** o score.
- Palavras/temas que **REDUZEM ou ZERAM** o score.

> Como escrever bons critérios, exemplos prontos e boas práticas estão em **[01a. Qualificação de Leads (detalhado)](./01a-qualificacao-leads.md)**.

---

## 4. Human-in-the-Loop (revisão humana)

Chave global que **segura toda mensagem ou ação da IA na fila de Aprovações** antes de sair. Quando ligada, nada é enviado automaticamente — você revisa, edita e aprova cada item.

Pode ser aplicada por **escopo**:
- **Primeira mensagem** — aprovar a primeira mensagem antes de sair em qualquer canal.
- **Respostas do SDR** — aprovar cada resposta gerada pela IA para mensagens recebidas.
- **Passos de cadência** — aprovar cada follow-up subsequente.
- **Ações sensíveis** — aprovar agendamentos, cancelamentos, reagendamentos e remoções.

Recomendação: **deixe ligado nas primeiras semanas** e vá desligando escopos conforme ganha confiança.

> O fluxo completo de revisão está em **[11. Aprovações](./11-aprovacoes.md)**.

---

**Próximo passo →** [01a. Qualificação de Leads](./01a-qualificacao-leads.md)
