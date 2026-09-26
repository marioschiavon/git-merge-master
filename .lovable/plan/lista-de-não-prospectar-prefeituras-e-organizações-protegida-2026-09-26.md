# Lista de "Não prospectar" (prefeituras e organizações protegidas)

## O problema
Hoje o MunicipIA importa qualquer prefeitura selecionada. Se ela já é cliente, ou já tem um lead em negociação avançada, pode acabar entrando numa cadência e recebendo abordagem fria por engano. A única trava que existe hoje vale só para e-mails descadastrados, não para uma organização inteira.

## A solução
Uma **lista de organizações protegidas** por empresa. Qualquer contato dessa organização (vindo do MunicipIA, CSV, Apollo, Pipedrive ou cadastrado à mão) fica bloqueado para prospecção automática.

### Para o usuário
1. **Nova página: Configurações → Não prospectar**
   - Adicionar uma prefeitura por Município + UF (ex.: "Altamira / PA") ou qualquer empresa pelo nome/domínio do site.
   - Motivo: **Cliente**, **Em negociação**, **Pediu para não contatar**, **Outro** + observação.
   - Pesquisar, editar e remover da lista.
2. **Atalho em Leads**: no detalhe do lead e na seleção em massa, botão **"Marcar organização como protegida"**.
3. **Proteção automática (opcional, ligada por padrão)**: quando um lead chega a **Reunião agendada** ou vira **Convertido**, a organização dele entra na lista sozinha, com motivo "Em negociação" / "Cliente".
4. **No MunicipIA**: ao clicar em "Enviar para o Leaderei", as prefeituras protegidas **não viram lead novo**. O aviso final mostra: "X criados, Y atualizados, Z ignorados (protegidos)".
5. **Leads já existentes** de uma organização protegida aparecem com um selo **"Protegido"** e não podem ser colocados em cadência — o botão avisa o motivo.
6. **Trava final de segurança**: mesmo que um lead protegido já esteja numa cadência, o envio automático é suspenso antes de mandar a mensagem e fica registrado no histórico do lead. Respostas a conversas que o próprio lead iniciou continuam funcionando normalmente.

### Como a organização é reconhecida
- Prefeituras: município + UF (sem diferença de acento/maiúscula).
- Empresas: domínio do site ou do e-mail, ou nome normalizado.

## Detalhes técnicos
- Tabela `protected_organizations` (`company_id`, `kind` municipio|empresa, `city`, `state`, `domain`, `name_normalized`, `reason`, `note`, `source` manual|auto, `created_by`, timestamps) + índices únicos por chave normalizada. GRANT authenticated/service_role, RLS por `get_user_company_id`.
- Função SQL `is_lead_protected(lead_id)` + coluna calculada/visão para o selo; helper compartilhado `_shared/protected-orgs.ts` para as funções do backend.
- `municipia-ingest`: pula as linhas protegidas na criação (atualizações de leads existentes continuam), retorna `protected`.
- Checagem no enrollment (`mark_lead_enrolled`/fluxo de cadência), em `cadence-executor` e `whatsapp-send-tick`/envio de e-mail para disparos frios; replies inbound não são bloqueados.
- Trigger em `leads`/`bookings` para a proteção automática (configurável em `platform_settings`/configurações da empresa).
- UI: `src/pages/settings/ProtectedOrgs.tsx`, rota + item em Configurações, selo e ações em `Leads.tsx` / `LeadDetailContent.tsx`.
- Manual (novo item em Leads + nota no MunicipIA), patch log, versão beta 0.61.
- Regra registrada para projetos futuros: toda nova fonte de importação precisa passar pela checagem de organização protegida.
