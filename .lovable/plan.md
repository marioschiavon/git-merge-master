# Corrigir acesso ao MunicipIA

## Diagnóstico (verificado no banco)

- **Qualé**: MunicipIA habilitado, 1 usuário (admin, logou hoje). O acesso funciona, mas o item do menu só aparece depois de recarregar a página, porque a checagem da integração é carregada uma vez e fica em cache.
- **Revista Qualé**: MunicipIA habilitado, porém a empresa está **sem nenhum usuário**. Ninguém consegue entrar por ela — não é problema de permissão, é falta de membros.
- Permissões da tabela de integrações e o carregamento do MunicipIA dentro do Leaderei estão corretos (o MunicipIA já autoriza ser exibido dentro do app).

## O que será feito

### 1. Menu MunicipIA em tempo real
- Assinar mudanças na integração da empresa: quando o master habilita/desabilita, o item "MunicipIA" aparece ou some na hora, sem recarregar.
- Revalidar também ao voltar o foco para a janela.

### 2. Painel master mais claro
- Na lista de empresas, mostrar a **quantidade de usuários** de cada empresa.
- Ao habilitar o MunicipIA para uma empresa sem usuários, exibir aviso: "Esta empresa não tem usuários — ninguém verá o MunicipIA até alguém entrar por convite."

### 3. Página MunicipIA com mensagem útil
- Se a integração não estiver habilitada, mostrar o nome da empresa atual do usuário (ajuda a identificar quando a pessoa está na empresa errada) e orientação para falar com o admin.
- Se o usuário não pertencer a nenhuma empresa, mensagem específica em vez de tela vazia.

### 4. Revista Qualé (empresa distinta, sem membros)
- Nada é mesclado: as duas empresas continuam separadas.
- Gerar/entregar o **link de convite** para a Revista Qualé, para que os usuários dela entrem na empresa correta. Assim que alguém aceitar, o MunicipIA (já habilitado) aparece automaticamente.

## Detalhes técnicos

- `src/hooks/useMunicipia.ts`: adicionar canal realtime em `municipia_integrations` filtrado por `company_id`, invalidando a query; `refetchOnWindowFocus: true`.
- Migração: `ALTER PUBLICATION supabase_realtime ADD TABLE public.municipia_integrations` (se ainda não estiver na publicação) e `REPLICA IDENTITY FULL`.
- `src/pages/master/Companies.tsx`: contagem de membros por empresa (agregação em `company_members`) exibida na tabela + aviso ao ativar o toggle com 0 membros.
- `src/pages/Municipia.tsx`: estados de "sem empresa" e "integração desabilitada" com nome da empresa via `useCompanyName`.
- Bump de versão para `beta 0.30`.
