# Guia HTML: Configuração do Google Cloud para conexão de Gmail dos clientes

## Objetivo
Criar `docs/manual/configuracao-google-gmail.html` — um documento autossuficiente (HTML + CSS embutido, mesmo visual do `manual.html`) para você enviar ao dono do app. Ele detalha, passo a passo, tudo que precisa ser feito no **Google Cloud Console** para liberar o OAuth do Gmail, de modo que **qualquer usuário/cliente possa conectar a própria conta Gmail** e enviar e-mails pelo Leaderei. Depois que ele concluir, você finaliza a configuração aqui (Client ID / Client Secret no provedor de e-mail).

Não é login social do Google — é acesso à API do Gmail (envio e leitura) por conta conectada.

## Conteúdo do guia

1. **Visão geral** — por que o app precisa de um app OAuth próprio do Google e o que muda para o cliente final (ele só clica em "Conectar Gmail" e autoriza).
2. **Pré-requisitos** — conta Google Workspace do dono, acesso ao Google Cloud Console, domínio verificado (Search Console) e política de privacidade + termos publicados em URL pública.
3. **Passo 1 — Criar o projeto** no Google Cloud.
4. **Passo 2 — Ativar as APIs**: Gmail API (e People API para nome/e-mail do usuário).
5. **Passo 3 — Tela de consentimento OAuth**: tipo **Externo**, nome do app, e-mails de suporte/desenvolvedor, logo, domínio autorizado, links de política de privacidade e termos.
6. **Passo 4 — Escopos**: lista exata que deve ser adicionada, com a marcação de quais são "restritos" (exigem verificação):
   - `.../auth/gmail.send`
   - `.../auth/gmail.readonly`
   - `.../auth/gmail.modify`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `openid`
7. **Passo 5 — Criar credenciais OAuth 2.0 (Aplicativo da Web)**:
   - JavaScript origins e **Authorized redirect URIs** exigidos, em bloco de código para copiar exato (URI de callback do provedor de e-mail usado pelo app + a URL do app).
   - Onde copiar **Client ID** e **Client Secret**.
8. **Passo 6 — Publicar e enviar para verificação**: sair do modo "Teste" (limite de 100 usuários), submeter para verificação do Google, o que o Google pede (vídeo demonstrando o fluxo, justificativa de cada escopo restrito) e o **CASA security assessment** obrigatório para escopos restritos do Gmail — com aviso de prazo (semanas) e custo possível.
9. **Passo 7 — Entregar as credenciais com segurança** — não enviar por WhatsApp/e-mail aberto; usar canal seguro ou o próprio painel.
10. **O que acontece depois** — você cadastra Client ID/Secret, testa a conexão de um Gmail e libera para os clientes.
11. **Checklist final** e **erros comuns** (`redirect_uri_mismatch`, `access_blocked: app não verificado`, `scope_not_allowed`, limite de usuários de teste).

## Observações técnicas
- Documento estático, sem dependências externas, pronto para abrir no navegador, imprimir em PDF ou enviar por e-mail.
- Redirect URI e URL do app preenchidos com os valores reais do projeto.
- Sem alterações no app, backend, rotas ou credenciais — apenas o arquivo de documentação.
