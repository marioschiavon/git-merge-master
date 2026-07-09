
## Objetivo

1. Atualizar `docs/manual/01-configuracoes-gerais.md` para refletir tudo que existe hoje na tela `/settings`.
2. Criar novo capítulo dedicado `docs/manual/01a-qualificacao-leads.md` explicando em detalhe o Score.

## 1. `01-configuracoes-gerais.md` — reestruturação

Quatro blocos, na mesma ordem da tela:

1. **Empresa** — nome, fuso horário, janela de envio (09:00–18:00, dias da semana). Passo a passo curto, dicas e erros comuns.
2. **Meu perfil** — nome completo, telefone, email (readonly).
3. **Qualificação de Leads (Score)** — parágrafo curto explicando o que é (critério que a IA usa para dar nota 0–100 a cada lead, com termos que aumentam ou reduzem o score). Frase final aponta para `01a-qualificacao-leads.md`.
4. **Human-in-the-Loop (revisão humana)** — parágrafo curto explicando que é a chave global que segura mensagens/ações da IA na fila de **Aprovações**, com escopo configurável (primeira mensagem, respostas, passos de cadência, ações sensíveis). Frase final aponta para `11-aprovacoes.md`.

Manter padrão dos outros capítulos: **Quando usar**, **Pré-requisitos**, **Dicas**, **Erros comuns**, **Próximo passo →** apontando para `02-equipe.md`.

## 2. Novo `01a-qualificacao-leads.md`

Capítulo dedicado ao Score, em linguagem simples:

- **O que é**: a IA lê o site (e enriquecimentos) de cada lead e devolve uma nota de 0 a 100 baseada no critério que você escreve. Serve para você priorizar quem trabalhar primeiro e evitar queimar cadência com quem não é ICP.
- **Onde fica**: `/settings` → card "Qualificação de Leads (Score)".
- **Passo a passo**:
  1. Escrever o **critério** (prompt) em formato de lista objetiva: "Critério 1: tem página X…", "Critério 2: publicação recente sobre Y…", etc.
  2. Adicionar termos que **AUMENTAM** o score (palavras que confirmam ICP).
  3. Adicionar termos que **REDUZEM ou ZERAM** o score (palavras que descartam o lead).
  4. Salvar.
- **Como a IA usa**: ao analisar o site, ela gera um breakdown por critério dentro do lead e uma nota consolidada.
- **Exemplos prontos** (2 mini-exemplos ICP diferentes: educação/bolsas e imobiliária popular) para o usuário se guiar.
- **Dicas**: seja específico, evite critérios subjetivos ("ser bacana"), teste em 5–10 leads e ajuste.
- **Erros comuns**: critério vago, termos de exclusão contraditórios, esquecer de reprocessar leads antigos após mudar critério.
- **Próximo passo →** `02-equipe.md`.

## 3. Atualizar `docs/manual/README.md`

Adicionar linha para o novo capítulo `01a` na lista de capítulos, entre `01` e `02`.

## Fora de escopo

- Capítulo dedicado a HITL (só sinaliza no `01` que o fluxo detalhado está em `11-aprovacoes.md`).
- Nenhuma mudança de código, banco ou UI.
