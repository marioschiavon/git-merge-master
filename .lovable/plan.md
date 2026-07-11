## Problema

Em **Configurações → Human-in-the-Loop**, os switches não persistem. Ao clicar, o toast "Preferências salvas" aparece, mas o valor volta ao estado anterior (parece "não configurável").

## Causa raiz

A tabela `companies` tem RLS com apenas duas policies:

- `SELECT` para membros da empresa (`id = get_user_company_id(auth.uid())`)
- `ALL` só para `master_admin`

**Não existe policy de `UPDATE` para `company_admin`**. Quando o hook `useHitlSettings.update` faz `supabase.from("companies").update(patch).eq("id", companyId)`, o Postgres bloqueia silenciosamente (0 linhas afetadas, sem erro) — por isso o toast de sucesso aparece mas nada muda.

O mesmo bug afeta o `CompanyCard` (nome, fuso, business hours) e provavelmente qualquer outro update client-side em `companies` feito por company_admin não-master.

## Correção

Migration única adicionando policy `UPDATE` em `public.companies` para `company_admin` da própria empresa:

```sql
CREATE POLICY "Company admins can update their company"
ON public.companies
FOR UPDATE
TO authenticated
USING (
  id = public.get_user_company_id(auth.uid())
  AND public.has_role(auth.uid(), 'company_admin'::app_role)
)
WITH CHECK (
  id = public.get_user_company_id(auth.uid())
  AND public.has_role(auth.uid(), 'company_admin'::app_role)
);
```

Escopo: apenas a migration. Sem mudanças em UI ou hooks — o código cliente já está correto, só faltava o direito no banco.

## Observação

Usuários `user` (não-admin) continuam sem poder editar — o que é o comportamento esperado. Se você quiser que qualquer membro possa mexer no HITL, é só me avisar e ajusto a policy.
