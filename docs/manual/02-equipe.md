# 02. Equipe

**Quando usar:** para ver quem tem acesso ao workspace da sua empresa, mudar o papel de alguém ou remover um membro.
**Pré-requisitos:** [01](./01-configuracoes-gerais.md).

## O que é

Gerencia quem tem acesso ao workspace da sua empresa e com qual papel.

## Papéis

- **Admin da empresa** (`company_admin`) — pode tudo dentro da sua empresa (configurar integrações, criar cadências, ver relatórios, gerenciar equipe).
- **Usuário** (`user`) — opera a inbox humana, responde conversas, aprova mensagens. Não configura integrações nem gerencia equipe.
- **Suporte Leaderei** (`master_admin`) — reservado à equipe Leaderei. Só ele pode editar itens **protegidos** (kickoff, aprendizados históricos). Aparece na lista mas não é gerenciável pela empresa.

## Convidar novo membro

Só **Admin da empresa** (ou Suporte Leaderei) consegue gerar convites.

1. Vá em **Configurações → Equipe** e clique em **Convidar membro**.
2. Escolha o **papel** que o convidado terá (Admin da empresa ou Usuário) e clique em **Gerar link**.
3. O sistema mostra o link do convite. Clique em **Copiar** e envie ao convidado pelo canal que preferir — WhatsApp, email pessoal, Slack, Teams, etc.
   - Se o botão Copiar não funcionar (ex.: navegador antigo), o link aparece selecionado no campo: use **Ctrl+C** (ou **Cmd+C** no Mac) para copiar manualmente.
4. O convidado abre o link e vê uma página com o nome da sua empresa e o papel definido. Ele preenche **nome completo, email e senha** (o email é o que ele vai usar para logar).
5. Ao concluir, aparece a mensagem de sucesso e um botão **Ir para login**. A conta já fica vinculada à sua empresa com o papel escolhido — não precisa de aprovação extra.

### Convites pendentes

Logo abaixo da lista de membros aparece o card **Convites pendentes** com todos os links ativos:

- **Papel** — papel que o convidado receberá ao aceitar.
- **Criado em / Expira em** — cada link vale **7 dias**. Depois disso, some da lista automaticamente e para de funcionar.
- **Copiar link** — pega o mesmo link de novo (útil se você perdeu a mensagem original).
- **Cancelar** — invalida o link na hora. Se a pessoa tentar abrir depois, vê "Convite cancelado". Para reenviar, gere um novo.

Convites já aceitos ou cancelados deixam de aparecer na lista — o membro passa para a tabela de **Membros** acima.

> Ainda não existe reenviar automático: se precisar de outro link, cancele o antigo e gere um novo.

> O envio automático do convite por email ou WhatsApp entra depois. Por enquanto o link é sempre compartilhado manualmente por você, independente de ter configurado [Email (03b)](./03b-email-resend.md) ou [WhatsApp (03a)](./03a-whatsapp-hook7.md).

## Gerenciar membros existentes

Vá em **Configurações → Equipe**. Você verá uma tabela com Nome, Email, Telefone, Papel e data em que a pessoa entrou.

### Mudar o papel de alguém

1. Na linha do membro, clique no seletor da coluna **Papel**.
2. Escolha **Admin da empresa** ou **Usuário**.
3. A mudança é salva imediatamente.

Você **não pode** mudar:

- Seu próprio papel (peça a outro admin ou à Leaderei).
- O papel do Suporte Leaderei.
- O último Admin da empresa para Usuário — a empresa precisa ter no mínimo um admin ativo.

### Remover um membro

1. Clique no ícone de lixeira na linha do membro.
2. Confirme na janela que abrir.

O acesso é revogado na hora. Você **não pode** remover:

- A si mesmo.
- O Suporte Leaderei.
- O último Admin da empresa.

## Dicas

- Deixe pelo menos **2 admins** para não ficar refém de um único acesso.
- Para clientes finais atendidos pela Leaderei, o Suporte Leaderei é da Leaderei; o cliente entra como Admin da empresa.

**Próximo passo →** [03. Integrações](./03-integracoes.md)
