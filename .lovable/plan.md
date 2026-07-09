
## Objetivo

Deixar a página `/settings/email` autoexplicativa, com passo a passo claro em linguagem simples, para que o cliente final (que muitas vezes não é técnico) consiga configurar o domínio de envio sem dúvidas. Também trocar os defaults do remetente para nomes mais amigáveis.

## Mudanças nos defaults

- Nome do remetente padrão: **"Atendimento"** (antes: "SDR").
- Caixa de envio padrão: **"atendimento"** (antes: "contato"), formando por padrão `atendimento@mail.suaempresa.com`.
- Placeholder do subdomínio segue `mail.suaempresa.com`.
- Aplicar em `src/pages/settings/Email.tsx` (states iniciais `fromName` e `fromLocal`, e placeholders dos inputs).
- No backend, `supabase/functions/resend-domain-create/index.ts` também usa `"SDR"` como fallback de `from_name` — trocar para `"Atendimento"` para consistência.

## Passo a passo na UI (novo)

Adicionar, no topo da página (depois do banner de reputação), um bloco visual **"Como funciona (4 passos)"** com estado dinâmico (cada passo mostra ✓ concluído, ● atual, ○ pendente) baseado em `domain?.status`:

1. **Escolher um subdomínio de envio** — explicar o que é subdomínio em uma frase ("um endereço filho do seu domínio, ex.: `mail.suaempresa.com`. Não use o domínio raiz para preservar sua reputação").
2. **Cadastrar o domínio aqui** — clicar em "Criar domínio no Resend"; vamos gerar os registros DNS.
3. **Adicionar os registros DNS no seu provedor** — copiar os registros da tabela e colar no painel do seu registrador (Registro.br, GoDaddy, Cloudflare, etc.). Passo a passo genérico expandível: "Onde adicionar DNS?" com instruções curtas para os 3-4 provedores mais comuns no Brasil.
4. **Clicar em 'Verificar DNS'** — o Resend confere e libera envio (pode levar de minutos a algumas horas).

Estado dinâmico:
- Sem `domain` → passo 1 atual.
- `domain.status = pending|verifying` → passos 1-2 concluídos, passo 3 atual.
- `domain.status = verified` → todos concluídos, mostrar mensagem "✅ Tudo pronto! Você já pode enviar emails."

## Wizard (formulário inicial)

Reescrever a seção "Configurar domínio de envio" com:
- Título maior "Passo 1: Cadastre seu domínio de envio".
- Texto explicativo curto acima de cada campo em linguagem simples:
  - **Subdomínio**: "É o endereço técnico usado para enviar. Recomendamos `mail.suaempresa.com`. Se `suaempresa.com` já é seu, basta usar `mail.` na frente."
  - **Nome do remetente**: "Nome que aparece na caixa de entrada do destinatário. Ex.: Atendimento, Comercial, Equipe Acme."
  - **Caixa de envio**: "Parte antes do @. Ex.: atendimento, contato, ola. Evite `no-reply` — respostas são bem-vindas."
- Preview em tempo real: mostrar em destaque `Atendimento <atendimento@mail.suaempresa.com>` conforme o usuário digita, para ele visualizar exatamente o que o destinatário verá.

## Tabela DNS mais didática

- Título: "Passo 3: Adicione estes registros no DNS do seu domínio".
- Texto acima da tabela: "Copie cada registro abaixo e cadastre no painel de DNS do seu registrador (onde você comprou o domínio). Cada linha vira uma entrada nova."
- Adicionar uma seção expansível **"Como fazer no meu provedor?"** com instruções curtas por provedor:
  - **Registro.br**: painel → Editar Zona DNS → adicionar cada registro (Tipo, Nome, Valor).
  - **GoDaddy**: Meus Produtos → DNS → Adicionar registro.
  - **Cloudflare**: DNS → Records → Add record (deixar proxy DESLIGADO/cinza).
  - **HostGator/Locaweb**: cPanel → Zona DNS → Adicionar registro.
- Aviso destacado ao lado da tabela: "⚠️ Ao copiar o **Nome**, use exatamente o que aparece aqui. Alguns provedores adicionam o domínio automaticamente — se acontecer duplicação (ex.: `mail.suaempresa.com.suaempresa.com`), remova a parte extra."
- Manter o texto "Após adicionar os registros, DNS pode levar até 72h (geralmente é bem mais rápido, ~15min a 2h)."

## Botão de verificar

- Renomear "Verificar DNS" → "Passo 4: Verificar meu DNS" quando ainda não verificado.
- Ao clicar, se ainda não propagado, toast: "Registros ainda não encontrados. Aguarde alguns minutos e tente de novo — pode levar até 2h em alguns provedores."

## Estados vazios e mensagens de erro

- Mensagens de erro em português claro (já estão, mas revisar para evitar termos técnicos como "resend_domain_id").
- Quando `status = verified`, esconder tabela DNS num accordion recolhido "Ver registros DNS configurados" para não poluir a tela.

## Arquivos afetados

- `src/pages/settings/Email.tsx` — reescrita da estrutura visual + defaults.
- `supabase/functions/resend-domain-create/index.ts` — trocar fallback `"SDR"` por `"Atendimento"`.

## Fora do escopo

- Não mexer em backend de envio, webhook inbound, migração de dados, ou lógica de verificação.
- Não adicionar suporte a múltiplos domínios por company.
