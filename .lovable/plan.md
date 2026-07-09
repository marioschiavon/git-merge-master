
## Objetivo

Fazer a tela `/settings` bater com o Manual 01: permitir editar **nome da empresa**, **fuso horário**, **janela de envio** (horário comercial) e **perfil pessoal** (nome, telefone).

## Alterações

### 1. Banco de dados (migration)

Tabela `companies` — adicionar colunas:
- `timezone text not null default 'America/Sao_Paulo'`
- `business_hours jsonb not null default '{"start":"09:00","end":"18:00","days":[1,2,3,4,5]}'::jsonb`  
  (formato: `start`/`end` em HH:MM, `days` = 0-6 dom-sáb)

Tabela `profiles` — adicionar coluna:
- `phone text`

Sem novas tabelas, sem mudança em RLS/GRANTs (colunas herdam das políticas existentes).

### 2. Frontend — nova seção "Empresa" no topo de `src/pages/settings/Settings.tsx`

Card **Empresa**:
- Input: Nome da empresa
- Select: Fuso horário (lista curta: America/Sao_Paulo, America/Manaus, America/Belem, America/Fortaleza, America/Cuiaba, America/Rio_Branco, America/Noronha, UTC)
- Janela de envio: 2 inputs `type="time"` (início/fim) + checkboxes dos 7 dias da semana
- Botão Salvar

Card **Meu perfil**:
- Input: Nome completo (grava em `profiles.full_name`)
- Input: Telefone (grava em `profiles.phone`)
- Email (readonly, do `auth.user.email`)
- Botão Salvar

Cards ficam nessa ordem: **Empresa → Meu perfil → HITL → Qualificação de Leads**.

### 3. Hooks

Criar `src/hooks/useCompanySettings.ts` — `useQuery`+`useMutation` para ler/gravar `companies.{name,timezone,business_hours}` filtrando por `companyId` do `useAuth`.

Criar `src/hooks/useProfileSettings.ts` — mesma coisa para `profiles.{full_name,phone}` filtrando por `user.id`.

Ambos invalidam suas queries no sucesso e disparam `toast.success`.

### 4. Fora de escopo (não faz agora)

- Não plugar `business_hours` no scheduler de cadências (só armazena por enquanto — a lógica que respeita janela de envio nas edge functions é uma segunda fase).
- Não mexer no manual — ele já descreve o comportamento; após esta implementação o texto passa a bater.
- Sem alteração em `useAuth`.

## Detalhes técnicos

- `business_hours` é `jsonb` livre; o form serializa o shape acima. Sem CHECK constraint (validação apenas no cliente).
- Telefone é texto livre, sem máscara nem validação estrita.
- Fuso: `<Select>` do shadcn com as opções fixas listadas acima; se o usuário quiser outra, adicionamos depois.
- Nenhum edge function novo, nenhuma migração de dados.
