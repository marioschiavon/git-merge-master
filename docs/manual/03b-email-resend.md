# 03b. Email (domínio próprio)

**Quando usar:** você vai enviar emails de prospecção usando **o seu domínio** (`atendimento@suaempresa.com.br`) em vez de um Gmail genérico.
**Pré-requisitos:** acesso ao painel de DNS do seu domínio (Registro.br, GoDaddy, Cloudflare, cPanel, HostGator, etc.).

## Como funciona (em linguagem simples)

Para o Leaderei mandar email **em nome da sua empresa**, os servidores do mundo inteiro precisam saber que você autorizou isso. Essa autorização é feita adicionando algumas linhas no **DNS** do seu domínio.

DNS é como a "lista telefônica" da internet. Você vai copiar 3 a 5 linhas do Leaderei e colar dentro dessa lista — pronto, o mundo passa a aceitar seus emails como legítimos.

Cada linha se chama **registro** e tem um tipo. Você vai encontrar três tipos:

| Tipo | O que faz (analogia) |
|---|---|
| **TXT (SPF)** | Uma "declaração escrita": "Autorizo o Leaderei a mandar email pelo meu domínio." |
| **CNAME (DKIM)** | Uma "assinatura oficial": prova que o email foi realmente enviado pelo Leaderei, e não por um golpista. |
| **MX (inbound)** | O "endereço da caixa postal": diz para onde as **respostas** dos prospects devem voltar. |

Sem os três, os emails caem no spam — ou nem chegam.

## Passo a passo em 4 etapas

### 1. Preencher os dados de envio

Em **Configurações → Integrações → Email**:

- **Nome do remetente:** o que aparece na caixa de entrada do prospect. Recomendamos **Atendimento**, **Comercial** ou **Equipe [Sua Empresa]**. **Evite "SDR"** — o cliente comum não sabe o que significa e pode desconfiar.
- **Prefixo do email:** a parte antes do `@`. Recomendamos **atendimento**. Evite `no-reply` — reduz muito a taxa de resposta.
- **Domínio de envio:** o ideal é usar um **subdomínio** (ex.: `envio.suaempresa.com.br` em vez de `suaempresa.com.br`). Isso protege sua reputação de email principal.

Um **preview** aparece na tela: `Atendimento <atendimento@envio.suaempresa.com.br>` — é assim que o prospect vai ver.

### 2. Cadastrar o domínio

Clique **Cadastrar domínio**. O Leaderei devolve uma lista de 3 a 5 **registros DNS** para você copiar.

### 3. Copiar os registros para o painel do seu provedor

Cada linha tem um botão **Copiar**. Você vai até o painel do seu provedor de DNS e cola cada registro lá.

Onde encontrar em cada provedor:

| Provedor | Caminho |
|---|---|
| **Registro.br** | Login → seu domínio → **DNS** → **Editar zona** |
| **GoDaddy** | **Meus produtos** → clique no domínio → **DNS** → **Adicionar** |
| **Cloudflare** | Clique no site → **DNS** → **Add record** |
| **cPanel** (HostGator, Locaweb, etc.) | **Zone Editor** → **+ Add Record** |

Para cada registro, você vai preencher **três campos**:

- **Tipo:** copie exatamente (TXT, CNAME ou MX).
- **Host / Nome:** apenas o subdomínio (ex.: `envio`), **não** o domínio inteiro. Se o Leaderei mostrar `envio.suaempresa.com.br`, você digita só `envio`.
- **Valor / Conteúdo:** cole o texto grande — **sem aspas** e sem quebras de linha.

Salve cada registro e passe para o próximo.

### 4. Verificar

Volte à tela do Leaderei e clique **Verificar DNS**. Em poucos segundos o status muda para **Verificado ✅** (o app fica checando sozinho a cada 15s, então às vezes muda antes mesmo de você clicar).

## Dicas

- A propagação do DNS pode levar de **5 minutos a 1 hora**. Se falhar na primeira, aguarde e tente de novo.
- Não cadastre o mesmo domínio em duas empresas Leaderei diferentes — gera conflito e nenhum funciona.
- Se aparecer erro sobre limite atingido, contate o suporte.

## Problemas comuns

- **Colar o valor com aspas (`"..."`).** Remova as aspas antes de colar.
- **Colocar o domínio inteiro no campo "Host".** Se o Leaderei mostra `envio.suaempresa.com.br`, você digita **só `envio`** no Host.
- **Esquecer o registro MX.** Sem ele, as respostas dos prospects não voltam para dentro do Leaderei.

**Próximo passo →** [03c. Apollo](./03c-apollo.md)
