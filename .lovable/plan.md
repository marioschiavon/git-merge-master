## Corrigir CORS do login no domínio `app.leaderei.com.br`

### Causa
O endpoint `/auth/v1/token` do backend do Lovable Cloud rejeita requests de `https://app.leaderei.com.br` porque esse domínio custom não foi adicionado à allow-list de URLs do Auth. Os domínios `id-preview--...lovable.app` e `leaderei-app.lovable.app` são aceitos automaticamente; o custom domain **precisa ser registrado manualmente**.

Por isso:
- No **preview** o login falha com "Failed to fetch" (proxy do preview interferindo — problema conhecido).
- No **custom domain** falha com CORS explícito (allow-list).
- No `leaderei-app.lovable.app` (URL Lovable publicada) provavelmente **funciona** — vale confirmar.

### Ação (você precisa fazer no UI, não há mudança de código)

1. Abrir o painel de backend do projeto:
   - Sidebar do Lovable → **Cloud** (ou "Backend") → **Users** → ícone de engrenagem **Auth Settings** → aba **URL Configuration**.
2. Em **Site URL**, definir: `https://app.leaderei.com.br`
3. Em **Redirect URLs** (additional), adicionar TODAS as URLs abaixo, uma por linha:
   - `https://app.leaderei.com.br/**`
   - `https://leaderei-app.lovable.app/**`
   - `https://id-preview--b5896184-51c5-4d86-ac16-a70f7aac80fb.lovable.app/**`
4. Salvar.
5. Aguardar ~30s e recarregar `https://app.leaderei.com.br/auth` — tentar login novamente.

### Verificação
- Login em `https://app.leaderei.com.br` deve funcionar.
- Reset de senha (`/reset-password`) e onboarding devem redirecionar corretamente para o domínio custom.

### Observação sobre o preview
O preview `id-preview--...lovable.app` tem um proxy de `fetch` da Lovable que às vezes quebra o `signInWithPassword` com "Failed to fetch". Isso é conhecido e **não é bug do app**. Depois de corrigir o CORS acima, teste principalmente no domínio publicado / custom domain, não no preview.

### Sem alteração de código
Este plano não muda nenhum arquivo do projeto. É só configuração no painel do Cloud Auth.
