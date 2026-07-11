## Plano

1. **Corrigir a permissão real de edição da empresa**
   - Adicionar uma migration com `GRANT SELECT, UPDATE ON public.companies TO authenticated` e `GRANT ALL ON public.companies TO service_role`.
   - Manter a regra de segurança já criada: somente `company_admin` da própria empresa e `master_admin` podem alterar.

2. **Ajustar a tela de Configurações para não parecer bloqueada indevidamente**
   - Usar o papel do usuário logado para diferenciar quem pode editar.
   - Para usuários sem permissão, mostrar os controles como somente leitura com uma mensagem clara.
   - Para admins, deixar o Human-in-the-Loop clicável e salvar normalmente.

3. **Evitar falso “salvo com sucesso”**
   - No hook de salvamento, exigir retorno da linha atualizada e tratar “0 linhas alteradas” como erro de permissão.
   - Atualizar o cache local após salvar para a tela refletir o novo estado imediatamente.

4. **Validar**
   - Conferir via backend que a tabela `companies` tem `UPDATE` para usuários autenticados.
   - Testar no preview se o switch de Human-in-the-Loop fica clicável para admin e se persiste ao recarregar.