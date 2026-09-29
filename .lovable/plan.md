# MunicipIA → Leaderei: só chegam leads prontos para trabalhar

## O que foi confirmado
Na empresa da cliente, 504 leads vieram do MunicipIA e **122 chegaram sem telefone e sem e-mail**. Hoje o Leaderei aceita qualquer município enviado. Se a busca não achou contato, o lead é criado vazio mesmo assim.

## Como vai ficar para a cliente
1. No MunicipIA ela filtra (UF, faixa de população, secretaria, "só com contato", "só com WhatsApp provável") e clica em **Enviar para o Leaderei**.
2. **Só entram leads com telefone ou e-mail.** Os municípios sem contato não viram lead vazio. O aviso final mostra: "X criados, Y atualizados, Z sem contato (não enviados), W protegidos".
3. Cada envio vira um **lote com nome**, por exemplo "MunicipIA 29/09 – SP Educação". Ele aparece automaticamente em **Listas**.
4. Assim que os leads chegam, o Leaderei faz sozinho:
   - **enriquecimento** com prioridade na fila;
   - **verificação de WhatsApp**, sem ela precisar clicar em "Verificar". Isso só acontece se houver uma conexão de WhatsApp ativa. Se não houver, o aviso informa.
5. Em **Leads**, entram os filtros **Origem: MunicipIA**, **Lote de importação** e **Pronto para cadência** (tem contato + WhatsApp válido ou e-mail + não protegido). Um atalho "Ver leads deste envio" leva direto para eles.
6. A partir do lote ela pode **Enviar para cadência** em um clique. Isso já existe e passa a funcionar também pela Lista.

## Leads vazios que já existem
Os 122 leads sem contato recebem a marcação **"Sem contato"**. Eles saem do filtro "Pronto para cadência" e não são apagados. Se você preferir, posso excluí-los.

## Detalhes técnicos

**Leaderei**
- `municipia-ingest`: descartar drafts sem `email` e sem `phone` (contador `no_contact`). Também aceitar `list_name` opcional, criar ou reusar `lead_lists` (origem municipia) e vincular os leads inseridos ou atualizados. Enfileirar enriquecimento com prioridade e chamar `whatsapp-verify-numbers` em segundo plano para os ids com telefone, se houver instância conectada. Retornar `{created, updated, no_contact, protected, list_id, whatsapp_verification: "queued"|"no_instance"}`. A checagem de `protected_organizations` continua.
- Migração: `leads.import_batch_id uuid` (vínculo com a lista) + índice. Nada de novas tabelas sem GRANT.
- `Leads.tsx`: filtros Origem, Lote e "Pronto para cadência" (usa `lead-readiness.ts` + `is_lead_protected`). Aceitar query `?list=` / `?batch=`.
- Backfill: marcar os leads municipia sem contato em `enrichment_data.sem_contato = true`.
- Manual (08-leads, integrações), patch log, bump para beta 0.66.

**MunicipIA (Municipal Connect Pro)**: código pronto para colar, porque meu acesso a esse projeto é só de leitura
- No diálogo de exportação/envio: filtro **"Somente com contato"** marcado por padrão e opção "Somente com celular (provável WhatsApp)".
- Campo **Nome do lote** (preenchido automaticamente com data + UF + secretaria) enviado como `list_name`.
- Antes de enviar, o resumo mostra "N com contato serão enviados, M sem contato ficarão de fora".
- Toast final com todos os contadores retornados e o botão "Abrir no Leaderei" (postMessage para o pai navegar até `/leads?batch=<list_id>`). A página `/municipia` do Leaderei passa a escutar essa mensagem.
- Vou entregar o código em um arquivo nos Files, com as instruções para o projeto MunicipIA.
