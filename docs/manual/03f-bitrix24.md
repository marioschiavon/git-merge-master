# 03f. Bitrix24 (opcional)

**Quando usar:** seu time comercial já trabalha no Bitrix24 e você quer que os leads abordados pelo Leaderei apareçam automaticamente como **negócios** no seu funil.
**Pré-requisitos:** conta Bitrix24 com permissão para criar um **webhook de entrada** (Inbound Webhook) no CRM.

## O que é

Quando conectado, o Leaderei sincroniza em **mão única** (Leaderei → Bitrix24):

- Quando um lead é **abordado** pela primeira vez, nasce um **negócio** no Bitrix24 (com contato e empresa vinculados), na etapa que você escolher.
- Quando a IA **passa a conversa para um humano**, o negócio **avança de etapa** automaticamente, com o resumo da conversa.

**Nada é importado do Bitrix e nada é apagado.** Se você não usa Bitrix24, pule este passo.

## Passo a passo

### 1. Criar o webhook dentro do Bitrix24

O webhook é a "chave" que autoriza o Leaderei a criar negócios em nome do seu usuário.

No Bitrix24:

1. No menu lateral, vá em **Aplicativos (Market) → Desenvolvedor** (ou busque por **Webhooks**).
2. Clique em **Webhook de entrada** (*Inbound webhook*).
3. Dê um nome, por exemplo `Leaderei`.
4. Em **Permissões de acesso**, marque **CRM (crm)**.
5. Salve e **copie a URL completa** gerada. Ela tem este formato:

   ```
   https://seuportal.bitrix24.com.br/rest/1/abcd1234xyz/
   ```

> **Importante:** copie a URL inteira, incluindo o código no final. É ela que será colada no Leaderei.

### 2. Conectar no Leaderei

1. **Configurações → Integrações → Bitrix24** → **Conectar**.
2. Cole a URL do webhook e confirme.
3. O Leaderei valida a chave com o Bitrix e confirma o portal e o usuário conectado.

> **Atenção:** apenas **administradores da empresa** conseguem conectar ou desconectar o CRM.

### 3. Configurar o funil e o de/para de campos

Depois de conectado, ainda na tela de Integrações:

1. **Funil:** escolha em qual funil do CRM os negócios serão criados.
2. **Etapa de criação:** etapa onde o negócio nasce quando o lead é abordado (ex.: "Novo lead").
3. **Etapa de handoff:** etapa para onde o negócio vai quando a IA passa para um humano (ex.: "Qualificado").
4. **Fonte:** de onde o lead veio (ex.: "WhatsApp").
5. **De/para de campos:** à esquerda, os campos do Leaderei (nome, e-mail, telefone, whatsapp, cargo, empresa, site, endereço, origem, status e score); à direita, o campo do Bitrix24 que deve recebê-los — incluindo **campos personalizados** que você criou no CRM.
6. Salve a configuração. A partir daí, tudo é automático.

## Acompanhando a fila de sincronização

No card do Bitrix24, em **Configurações → Integrações**, você acompanha o painel da fila:

- **Pendentes:** itens aguardando envio (a fila roda a cada 2 minutos).
- **Falhas:** itens que não conseguiram ser enviados, com o **último erro** exibido para diagnóstico.
- Tentativas com erro são refeitas automaticamente algumas vezes antes de falhar de vez.

## Dicas

- Se o negócio não apareceu no Bitrix, primeiro olhe o painel da fila — o erro costuma indicar a causa (ex.: funil não configurado).
- O webhook é do usuário que o criou: se essa pessoa sair da empresa, gere um novo webhook com outro usuário e reconecte aqui.
- A sincronização é de mão única: o que o vendedor move dentro do Bitrix **não** altera o lead no Leaderei.

**Próximo passo →** [04. Base de Conhecimento](./04-base-de-conhecimento.md)
