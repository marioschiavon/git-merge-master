# 03d. Pipedrive (opcional)

**Quando usar:** seu time comercial já trabalha no Pipedrive e você quer que os leads e reuniões do Leaderei apareçam automaticamente no seu funil.
**Pré-requisitos:** conta Pipedrive com permissão para gerar **API token**.

## O que é

O Pipedrive é um CRM. Quando conectado, o Leaderei mantém a sincronia nos dois sentidos: leads do Leaderei viram **pessoas** no Pipedrive, e reuniões marcadas pelo agente IA viram **negócios** na etapa que você escolher.

**Não é obrigatório.** Se você não usa Pipedrive, pule este passo.

## Passo a passo

### 1. Pegar o token dentro do Pipedrive

O **API token** é a "senha" que autoriza o Leaderei a criar pessoas e negócios em nome do seu usuário.

No Pipedrive:

1. Clique na **sua foto/inicial**, no canto superior direito.
2. Clique em **Preferências pessoais** (*Personal preferences*).
3. No menu à esquerda, vá em **API**.
4. Copie o **API token** exibido.

### 2. Conectar no Leaderei

1. **Configurações → Integrações → Pipedrive** → **Conectar**.
2. Cole o token e salve.
3. Escolha o **funil** (pipeline) e a **etapa inicial** onde os novos negócios devem cair.
4. Opcional: clique **Sincronizar agora** para importar de uma vez as pessoas que já estão no Pipedrive.

## Dicas

- Se você usa outro CRM (HubSpot, RD Station, Salesforce), fale com o time Leaderei — integrações personalizadas podem ser feitas sob demanda.
- O token é pessoal: se o usuário do Pipedrive sair da empresa, gere novo token com outro usuário e atualize aqui.

**Próximo passo →** [03e. Cal.com](./03e-calcom.md)
