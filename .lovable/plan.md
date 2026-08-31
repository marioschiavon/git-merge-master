# Configuração Google Cloud para conexão de Gmail

## Objetivo
Criar um guia HTML independente em `docs/manual/configuracao-google-gmail.html` para o dono do app configurar o Google Cloud Console, possibilitando que usuários e clientes conectem seus Gmail ao Leaderei.

## O que será entregue
- Página HTML estática, responsiva, com tema claro/escuro, seguindo o visual do manual existente.
- Instruções passo a passo:
  1. Criar projeto no Google Cloud.
  2. Ativar Gmail API e People API.
  3. Configurar tela de consentimento OAuth (externo, domínio, política, termos).
  4. Adicionar escopos necessários (gmail.send, gmail.readonly, gmail.modify, userinfo, openid).
  5. Criar credenciais OAuth web com origens autorizadas e a redirect URI correta.
  6. Publicar/submeter para verificação, com avisos sobre CASA e prazo.
  7. Entregar Client ID e Client Secret à equipe Leaderei de forma segura.
- Seções de checklist, erros comuns e botões de copiar escopos/URLs.
- Não altera a versão do app nem o patch log (documento interno).

## Notas técnicas
- A redirect URI a ser cadastrada é `https://plfcbbqzpcbgykfervnp.supabase.co/functions/v1/email-connect-callback`.
- Origens autorizadas: domínios públicos do app (custom domain, published, preview).
- O documento descreve o fluxo como “conectar Gmail no Leaderei”, sem expor o motor de e-mail por trás do app.
