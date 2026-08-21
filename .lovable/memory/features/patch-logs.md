---
name: Patch logs para clientes
description: A cada bump de APP_VERSION, registrar as mudanças do dia em docs/patch-logs/AAAA-MM-DD.md em linguagem de cliente
type: preference
---

Sempre que `APP_VERSION` (src/lib/version.ts) for incrementada, atualizar ou criar o arquivo do dia em
`docs/patch-logs/AAAA-MM-DD.md` e adicionar/atualizar a data no índice `docs/patch-logs/README.md`.

Formato do arquivo: cabeçalho com data e versões cobertas, e seções **Novidades**, **Melhorias**, **Correções**.
Itens curtos, sem jargão técnico — foco no que o cliente percebe.
