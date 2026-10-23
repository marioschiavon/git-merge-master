# 03d. Pipedrive (opcional)

**Quando usar:** seu time comercial trabalha no Pipedrive e você quer que os negócios dos leads abordados pela Leaderei apareçam e avancem sozinhos no seu funil.
**Pré-requisitos:** conta Pipedrive com permissão para gerar **API token**.

## O que é

O Pipedrive é um CRM. A integração tem dois modos independentes, em abas dentro do mesmo card:

- **Envio de negócios (automático):** quando a Leaderei aborda um lead, ela cria a Pessoa, a Organização e o Negócio no seu Pipedrive. O negócio avança de etapa quando o lead responde, agenda reunião ou passa para atendimento humano.
- **Importação de contatos (manual):** traz as pessoas do Pipedrive para a sua lista de Leads, só quando você clica no botão.

**Não é obrigatório.** Se você não usa Pipedrive, pule este passo.

## Passo a passo

### 1. Pegar o token no Pipedrive

1. Clique na **sua foto/inicial**, no canto superior direito.
2. **Preferências pessoais → API**.
3. Copie o **API token**.

### 2. Conectar

**Configurações → Integrações → Pipedrive**, cole o token e clique **Conectar**.

### 3. Configurar o envio de negócios

Na aba **Envio de negócios**:

1. Ligue **Enviar negócios automaticamente**.
2. Escolha o **Funil** e, se quiser, o **Dono do negócio**.
3. Escolha as etapas:
   - **Ao abordar o lead** (obrigatória) — onde o negócio nasce.
   - **Quando o lead responde** — primeira resposta por WhatsApp ou e-mail.
   - **Quando agenda reunião**.
   - **No atendimento humano** — leva o resumo da conversa como anotação.
   Etapa deixada em "Não mover" é simplesmente ignorada.
4. Opcional: no **De/para**, escolha onde guardar cargo, site, origem, score etc. (na Pessoa ou no Negócio, inclusive campos personalizados). Nome, e-mail e telefone já vão sozinhos.
5. Clique **Salvar**.

### 4. Importar contatos (quando quiser)

Na aba **Importação de contatos**, clique **Importar contatos agora**.

## Regras importantes

- **O negócio só avança, nunca volta.** Se o lead responder depois de já ter reunião marcada, o card continua em Reunião.
- **Sem duplicar:** se a pessoa já existe no Pipedrive (mesmo e-mail ou telefone, ou veio da importação), a Leaderei usa a existente e só preenche campos vazios.
- **Organizações em "Não prospectar"** nunca são enviadas.
- **Nada é apagado** no Pipedrive. Mudanças feitas no Pipedrive não voltam para a Leaderei.
- Leads que já têm negócio enviado não são removidos pela importação manual, mesmo que a pessoa seja apagada no Pipedrive.

## Acompanhamento

No fim da aba aparecem: negócios enviados, itens na fila, falhas e o último aviso. Se o Pipedrive ficar instável, a Leaderei tenta de novo sozinha (até 5 vezes). O botão **Tentar falhas novamente** coloca de volta na fila o que falhou ou foi pulado — útil depois de corrigir a configuração.
