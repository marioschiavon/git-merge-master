# Desfazer importação, filtro por lista e uso do celular na prospecção

## O que encontramos
- A importação guardou os três telefones (Telefone, Celular, Corporativo), mas **a tela do lead só mostra o "Telefone"**, por isso o celular parecia ter sumido.
- Pior: **a verificação de WhatsApp e os envios só usam "Telefone" e "WhatsApp"**. O celular importado hoje não seria usado na prospecção. Esse é o problema real do cliente.
- Cada importação por planilha já vira uma Lista, mas em Leads não existe um seletor de Lista na tela, nem exclusão de vários leads de uma vez.

## O que vamos fazer

### 1. O celular passa a ser usado (corrige a causa)
- Na importação, quando houver "Celular" e o campo WhatsApp estiver vazio, o celular vira o **número de WhatsApp** do lead. O "Telefone corporativo" fica só como apoio.
- A verificação de WhatsApp e o envio passam a tentar, nesta ordem: WhatsApp, Celular, Telefone.
- A tela do lead mostra todos os telefones, cada um com seu nome.
- Correção dos leads já importados: quem tem celular e não tem WhatsApp recebe o celular como WhatsApp e entra na verificação. Isso vale também para a planilha de hoje, **sem precisar importar de novo**.

### 2. Filtro por Lista em Leads
- Novo seletor "Lista" ao lado de Origem, mostrando as listas mais recentes primeiro, com data e quantidade.
- Uma caixa "Selecionar todos" marca todos os leads filtrados, não só os da página.

### 3. Excluir em massa
- Novo botão "Excluir selecionados" na barra de ações.
- Antes de apagar, uma confirmação mostra quantos leads já receberam mensagem ou estão em cadência. Esses são desmarcados por padrão, e o cliente precisa marcar de propósito para apagá-los.

### 4. Desfazer importação
- Em Leads → Listas, cada lista de planilha ganha o botão **"Desfazer importação"**.
- Ele apaga os leads **criados** por aquela importação que ainda não foram contatados, e depois apaga a lista.
- Leads que já existiam e só foram atualizados não são apagados. O aviso diz quantos ficaram. Todos os dados antigos que estavam antes da importação não podem ser restaurados.
- Cada exclusão fica registrada nos logs de auditoria.

## Detalhes técnicos
- `LeadImportDialog.tsx`: `whatsapp = whatsapp || mobile_phone` antes do insert.
- `whatsapp-verify-numbers`, `cadence-executor`, `send-outbound-message`, `_shared/whatsapp-pacer` e os leitores de telefone: fallback `whatsapp ?? mobile_phone ?? phone`.
- Backfill via SQL: `UPDATE leads SET whatsapp = mobile_phone WHERE whatsapp IS NULL AND mobile_phone IS NOT NULL`, depois dispara a verificação por empresa.
- `LeadDetailContent.tsx`: exibe `mobile_phone` e `corporate_phone`.
- `Leads.tsx`: `Select` de lista ligado ao `?list=`, "selecionar todos filtrados", ação `delete` em `useBulkLeadActions` usando `delete_lead_cascade`, com checagem de mensagens/matrículas.
- `LeadLists.tsx`: "Desfazer importação". Precisa saber quais leads foram criados (e não só atualizados) pela importação: gravar `enrichment_data.import_created = true` ou comparar `created_at` com o horário da lista. Para importações antigas, usar a segunda opção.
- Bump para beta 0.68, patch log e manual (08-leads, 09-listas).
