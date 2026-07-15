## Análise dos alertas de segurança

Revisei os 6 alertas do scanner. Aqui está o diagnóstico de cada um e a correção proposta.

### 1. `lead_action_queue` sem policies de INSERT/DELETE — **warn**
Hoje só existem `SELECT` e `UPDATE`. Inserts/deletes só acontecem via `service_role` (edge functions). Isto é **intencional** — a fila é escrita pelo backend, não pelo usuário. Vou marcar como *false positive* na memória de segurança, sem mudar SQL.

### 2. `cadence_policies` usa uma única policy `ALL` — **warn**
Não há risco real (o escopo `company_id` está correto), mas o scanner sugere separar por comando para auditoria. Vou **dividir em SELECT/INSERT/UPDATE/DELETE** mantendo a mesma lógica.

### 3. Funções SECURITY DEFINER executáveis por `anon` / `authenticated` — **warn (2 findings)**
Várias funções sensíveis (`get_calcom_api_key`, `get_resend_master_key`, `get_hook7_instance_token`, `set_*`, `clear_*`, `regenerate_calcom_webhook_secret`, `set_hook7_instance_token`) estão com EXECUTE público. Elas exigem passphrase, mas ainda assim não devem ser chamáveis por `anon`.

Ação: **REVOKE EXECUTE ... FROM PUBLIC, anon** para todas as funções de segredo, mantendo apenas `service_role` (edge functions) e, onde necessário, `authenticated`.

Funções que precisam permanecer chamáveis por `authenticated` (usadas pelo frontend via RPC):
- `create_company_and_join`, `accept_company_invite`, `get_invite_by_token`, `create_company_invite`, `cancel_company_invite`, `list_company_members`, `update_company_member_role`, `remove_company_member`, `delete_lead_cascade`, `match_knowledge_chunks`, `has_role`, `get_user_company_id`.

Funções restritas a `service_role`:
- `get_calcom_api_key`, `set_calcom_api_key`, `clear_calcom_api_key`, `regenerate_calcom_webhook_secret`
- `get_resend_master_key`, `set_resend_master_key`, `clear_resend_master_key`
- `get_hook7_instance_token`, `set_hook7_instance_token`
- `enqueue_email`, `read_email_batch`, `delete_email`, `move_to_dlq`
- Triggers internos (`handle_new_user`, `enqueue_lead_enrichment`, `after_enrichment_done`, `mark_*`, `update_updated_at_column`) — REVOKE de PUBLIC (rodam como trigger, não precisam EXECUTE público).

### 4. Leaked Password Protection desabilitado — **warn**
Ativar HIBP check via `supabase--configure_auth` (`password_hibp_enabled: true`).

### 5. `company_members` — company_admin pode escalar privilégios — **warn**
A policy `ALL` permite que um `company_admin` faça `INSERT/UPDATE` livre em `company_members` da própria empresa, podendo:
- inserir a si mesmo em outra empresa (bloqueado pelo `company_id` scope, ok);
- promover outro membro a `company_admin` diretamente na tabela (não há restrição de role).

Correção:
- **Substituir a policy `ALL` por policies granulares** que impeçam `INSERT/UPDATE` de linhas com `role = 'master_admin'` por não-master, e reforçar que apenas as RPCs (`update_company_member_role`, `remove_company_member`) fazem escritas.
- Alternativa mais segura e alinhada ao código atual: **remover INSERT/UPDATE/DELETE de `authenticated`** nessa tabela (só `SELECT`), já que todas as mutações passam pelas funções SECURITY DEFINER que validam role.

Vou aplicar a alternativa: manter só `SELECT` para membros da empresa + `master_admin` bypass; INSERT/UPDATE/DELETE ficam exclusivamente via RPCs.

---

### Detalhes técnicos

**Migração SQL** (um único arquivo):

```sql
-- 2. cadence_policies: split ALL em policies granulares
DROP POLICY "Members manage own company policies" ON public.cadence_policies;
CREATE POLICY "cadence_policies_select" ON public.cadence_policies FOR SELECT
  USING (company_id = get_user_company_id(auth.uid()) OR has_role(auth.uid(),'master_admin'));
CREATE POLICY "cadence_policies_insert" ON public.cadence_policies FOR INSERT
  WITH CHECK (company_id = get_user_company_id(auth.uid()) OR has_role(auth.uid(),'master_admin'));
CREATE POLICY "cadence_policies_update" ON public.cadence_policies FOR UPDATE
  USING (company_id = get_user_company_id(auth.uid()) OR has_role(auth.uid(),'master_admin'))
  WITH CHECK (company_id = get_user_company_id(auth.uid()) OR has_role(auth.uid(),'master_admin'));
CREATE POLICY "cadence_policies_delete" ON public.cadence_policies FOR DELETE
  USING (company_id = get_user_company_id(auth.uid()) OR has_role(auth.uid(),'master_admin'));

-- 3. REVOKE EXECUTE das funções sensíveis
REVOKE EXECUTE ON FUNCTION public.get_calcom_api_key(uuid,text),
                          public.set_calcom_api_key(uuid,text,text,text),
                          public.clear_calcom_api_key(uuid),
                          public.regenerate_calcom_webhook_secret(uuid),
                          public.get_resend_master_key(text),
                          public.set_resend_master_key(text,text),
                          public.clear_resend_master_key(),
                          public.get_hook7_instance_token(uuid,text),
                          public.set_hook7_instance_token(uuid,text,text),
                          public.enqueue_email(text,jsonb),
                          public.read_email_batch(text,int,int),
                          public.delete_email(text,bigint),
                          public.move_to_dlq(text,text,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;
-- service_role mantém acesso (usado pelas edge functions).

-- 5. company_members: só SELECT via RLS; mutações via RPCs
DROP POLICY "Company admins can manage their company members" ON public.company_members;
DROP POLICY "Master admins can manage all members" ON public.company_members;
-- Mantém "Members can view their company members" (SELECT).
CREATE POLICY "Master admins can view all members" ON public.company_members FOR SELECT
  USING (has_role(auth.uid(),'master_admin'));
-- INSERT/UPDATE/DELETE ficam sem policy p/ authenticated → só service_role e RPCs SECURITY DEFINER escrevem.
```

**Auth config**: ligar HIBP via tool.

**Memória de segurança**: registrar que `lead_action_queue` INSERT/DELETE é intencionalmente service-role-only.

Após aplicar, executo `supabase--linter` para confirmar.

### O que NÃO vou mudar
- `lead_action_queue` (comportamento é o desejado).
- Nenhum código de frontend/edge function — todas as chamadas atuais das funções sensíveis já usam `service_role` client.
