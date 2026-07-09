# 03b. Email (domínio próprio)

**Quando usar:** você vai enviar emails de prospecção com o **seu domínio** (`atendimento@suaempresa.com.br`).
**Pré-requisitos:** acesso ao painel DNS do seu domínio (Registro.br, GoDaddy, Cloudflare, cPanel etc.).

## O que é

Cada empresa configura **seu próprio subdomínio de envio** (ex.: `envio.suaempresa.com.br`). Assim sua reputação de entrega fica isolada e você não é afetado por spam de outros clientes.

## Passo a passo em 4 etapas

### 1. Preencher os dados

- **Nome do remetente**: o nome que aparece no email. Padrão: **Atendimento**. Também pode ser "Comercial", "Equipe Leaderei", etc. — **evite "SDR"** (cliente não entende).
- **Prefixo do email**: parte antes do `@`. Padrão: **atendimento**. Evite `no-reply` — reduz respostas.
- **Domínio de envio**: sugerimos um **subdomínio** (`envio.suaempresa.com.br`), não o domínio raiz.

Preview em tempo real: `Atendimento <atendimento@envio.suaempresa.com.br>`.

### 2. Cadastrar

Clique **Cadastrar domínio**. O sistema devolve 3-5 **registros DNS** (SPF, DKIM, MX inbound).

### 3. Copiar registros para o seu provedor DNS

Cada linha tem um botão **Copiar**. Cole cada um no painel do seu registrador conforme abaixo:

| Provedor | Onde ir |
|---|---|
| Registro.br | Painel → seu domínio → **DNS** → Editar zona |
| GoDaddy | Meus produtos → domínio → **DNS** → **Adicionar** |
| Cloudflare | Site → **DNS** → **Add record** |
| cPanel (HostGator/Locaweb) | Zone Editor → **+ Add Record** |

Para cada linha, cole exatamente:
- **Tipo** (TXT / CNAME / MX)
- **Host / Nome** (ex.: `envio` — NÃO o domínio inteiro)
- **Valor** (o conteúdo grande — sem quebras de linha, sem aspas)

### 4. Verificar

Volte à tela do Leaderei e clique **Verificar DNS**. Se estiver correto, muda para **Verificado ✅** em segundos.

## Dicas

- Propagação DNS pode levar **5 min a 1 hora**. Se falhar, aguarde e clique de novo.
- Não cadastre o mesmo domínio em duas empresas Leaderei — dá conflito.
- Se aparecer erro "plano do Resend atingiu limite": remova domínios antigos ou faça upgrade.

## Erros comuns

- Copiar o valor com aspas — remova antes de colar.
- Colocar `envio.suaempresa.com.br` no campo **Host** (deveria ser só `envio`).
- Esquecer o registro **MX inbound** — sem ele, respostas ao email não voltam pra plataforma.

**Próximo passo →** [03c. Apollo](./03c-apollo.md)
