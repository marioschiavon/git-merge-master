# Guia HTML: Configuração do Google Cloud (OAuth)

## Objetivo
Criar um arquivo HTML independente em `docs/manual/configuracao-google.html`, para ser enviado ao **dono do app**, detalhando tudo que ele precisa fazer no **Google Cloud Console** para que o login com Google funcione no Leaderei. Depois que ele concluir a parte dele, você finaliza no backend (cole Client ID / Secret).

## Conteúdo do arquivo
Guia em linguagem simples, sem jargões desnecessários, com o mesmo visual do `manual.html` (tema claro/escuro, caixas de aviso, blocos de código):

1. **O que é e por que é necessário** — explicação em 1 parágrafo (o app precisa de credenciais OAuth do Google para o botão "Entrar com Google").
2. **Pré-requisitos** — conta Google, acesso ao Google Cloud Console.
3. **Passo 1 — Criar (ou escolher) o projeto** no console.cloud.google.com.
4. **Passo 2 — Configurar a tela de consentimento OAuth** (OAuth consent screen): tipo Externo, nome do app, e-mail de suporte, logo opcional.
5. **Passo 3 — Criar as credenciais OAuth 2.0** (Aplicativo da Web):
   - Nome sugerido: `Leaderei`
   - **Authorized redirect URIs** — a URL de callback do backend de autenticação (URL do projeto + `/auth/v1/callback`), exibida em bloco de código com instrução clara de copiar exata.
6. **Passo 4 — Copiar Client ID e Client Secret** e enviar de forma segura (aviso: nunca por e-mail aberto/WhatsApp; idealmente o próprio dono cola no painel ou envia por canal seguro).
7. **Passo 5 (opcional) — Publicar o app** (sair do modo "Teste") para não limitar a 100 usuários de teste.
8. **O que acontece depois** — você habilita o provedor Google no backend e testa o login.
9. **Checklist final** com caixas marcáveis.

## Observações
- Arquivo **estático e autossuficiente** (CSS inline, sem dependências), pronto para abrir no navegador ou enviar por e-mail.
- Somente criação do arquivo; nenhuma alteração no app, backend ou rotas.
