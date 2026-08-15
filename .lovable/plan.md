# Integração MunicipIA

Novo item no menu lateral do Leaderei que abre o MunicipIA **dentro** do próprio app. O usuário busca e seleciona municípios normalmente e, junto de "Exportar CSV / Excel", ganha o botão **Enviar para o Leaderei**, que cria os leads aqui já com a cidade preenchida.

## Como vai funcionar para o usuário

1. **Menu lateral → MunicipIA**: nova página `/municipia` no Leaderei que carrega `https://municipia.lovable.app/` embutido, ocupando a tela toda (sem sair do app). Se o MunicipIA bloquear a exibição embutida, a página mostra um aviso com botão "Abrir em nova aba" — sem tela branca.
2. O item só aparece para empresas liberadas pelo master admin.
3. **No MunicipIA**: filtros, busca e seleção de municípios seguem iguais.
4. **Exportar**: ao lado de "Exportar CSV" e "Exportar Excel (.xlsx)" entra **Enviar para o Leaderei**. Só aparece quando o MunicipIA está sendo usado de dentro do Leaderei.
5. **Resultado**: toast com "X leads criados, Y atualizados" e os leads aparecem em Leads, origem `municipia`, com **Cidade** e **UF** preenchidos.

## Mapeamento dos dados

O MunicipIA já exporta: Município, UF, Secretário(a), Cargo, E-mail, Telefone, Horário, Equipe, Fonte, Hierarquia, Data da Busca. Vira lead assim:

- Secretário(a) → nome do lead; Cargo → cargo
- Município → **cidade**; UF → estado
- Primeiro e-mail → e-mail (demais em e-mail secundário); primeiro telefone → telefone
- Município + hierarquia (ex.: "Prefeitura de X — Secretaria de Educação") → empresa
- Fonte, horário, equipe e data da busca → guardados nas observações/metadados do lead
- Cada membro da **Equipe** com contato pode virar lead adicional vinculado ao mesmo município (opcional, ligado por padrão)

## Como os dois apps conversam com segurança

O MunicipIA é outro projeto (outro backend), então o envio passa por um endpoint de ingestão do Leaderei. Para não guardar credencial no MunicipIA:

- a página `/municipia` do Leaderei envia ao iframe, por mensagem interna do navegador, a identificação da empresa e um **token de sessão curto** (validade de minutos);
- o botão "Enviar para o Leaderei" usa esse token no envio;
- o Leaderei valida token, empresa e se a integração está habilitada, e deduplica por município+cargo, e-mail e telefone, para reenvio não duplicar.

## Detalhes técnicos

**Banco (Leaderei, migração)**
- `municipia_integrations`: `company_id` (única), `enabled`, `last_import_at`, `last_import_count`, `last_error`, timestamps. GRANT `SELECT` para `authenticated`, `ALL` para `service_role`. RLS: membros leem a própria linha; escrita só por master admin ou service_role.
- `leads`: adicionar `municipia_source_id text` + índice único parcial `(company_id, municipia_source_id)`. `city` já existe.

**Edge functions (Leaderei)**
- `municipia-session` (JWT do usuário): confere integração habilitada e devolve um token curto assinado (HMAC com segredo do projeto) contendo `company_id`, `user_id` e expiração.
- `municipia-ingest` (`verify_jwt = false`, CORS liberado para `municipia.lovable.app`): valida o token curto, mapeia as linhas, deduplica, insere leads com `source = 'municipia'`, atualiza `last_import_*` e registra em `audit_logs`. Retorna `{ created, updated, skipped }`.

**Frontend (Leaderei)**
- `src/pages/Municipia.tsx`: iframe em tela cheia + detecção de bloqueio (timeout de carregamento) com fallback "Abrir em nova aba"; envia `company_id`, nome da empresa e token via `postMessage` quando o iframe sinaliza que está pronto.
- `src/App.tsx`: rota `/municipia`.
- `src/components/AppSidebar.tsx`: item **MunicipIA** condicional à integração.
- `src/pages/master/Companies.tsx`: switch **MunicipIA** por empresa + último import.
- `src/pages/Leads.tsx`: coluna **Cidade** exibida quando a integração está ativa.

**No projeto MunicipIA** (mudança separada, feita depois que este lado estiver no ar):
- permitir ser exibido dentro do Leaderei (liberar framing para o domínio do Leaderei nos headers do servidor);
- pequeno módulo que faz o handshake `postMessage` com o Leaderei e guarda o token em memória;
- em `src/components/ExportButtons.tsx`, novo botão "Enviar para o Leaderei" que faz POST em `municipia-ingest` com as mesmas `ExportRow` já usadas no CSV/XLSX.

**Versão**: bump para `beta 0.28`.
