## Objetivo
Conectar este projeto Lovable ao GitHub e preparar o fluxo para substituir o código-fonte pelo do repositório externo `marioschiavon/outreach-ace-squad`.

## Passo a passo

### 1. Conectar ao GitHub (ação do usuário na interface do Lovable)
- Acessar o menu **Plus (+)** no input de chat → **GitHub** → **Connect project**
- Autorizar o app Lovable no GitHub
- Selecionar a conta/organização e criar o repositório

### 2. Sincronização inicial
- Aguardar o Lovable fazer o push inicial do projeto atual para o repositório GitHub criado
- Confirmar que o código base está no GitHub

### 3. Substituir pelo repositório externo
- O usuário clona localmente o repositório recém-criado pelo Lovable
- Adiciona o remote do `outreach-ace-squad` como upstream
- Faz fetch do código do upstream
- Executa `git reset --hard upstream/main` (ou branch principal equivalente) para substituir completamente o código
- Faz push force para o repositório do Lovable: `git push origin main --force`

### 4. Sincronização de volta ao Lovable
- O Lovable detecta o push no GitHub e sincroniza o novo código automaticamente
- Verificar se o projeto compila corretamente no preview do Lovable

## Notas técnicas
- O repo `marioschiavon/outreach-ace-squad` não está no workspace do Lovable, portanto não é acessível via cross-project tools
- A substituição deve ser feita via Git (push force) após a conexão inicial
- Recomendado verificar se o `outreach-ace-squad` já é um projeto Lovable compatível antes do push force