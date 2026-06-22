## Objetivo

Na coluna **Próxima execução** mostrar uma prévia do que será disparado: canal (com ícone + rótulo) e assunto/preview do próximo step.

## Mudanças (somente frontend)

**`src/hooks/useCadenceLeadProgress.ts`**
- Ampliar `nextStep` para incluir `template` (além de `step_order`, `channel`, `subject`).
  - Ajustar o `select` de `cadence_steps` para `"step_order, channel, subject, template"`.
  - Atualizar o tipo `CadenceLeadProgressRow.nextStep`.

**`src/pages/CadencesDashboard.tsx`** — célula "Próxima execução":
- Renderizar:
  - Linha 1: ícone do canal + rótulo do canal (`Email` / `WhatsApp` / `LinkedIn`) + `Step N`.
  - Linha 2 (menor, muted): data formatada `dd/MM HH:mm` (como hoje).
  - Linha 3 (truncada, muted): assunto do step se existir, senão primeiros ~60 caracteres do `template`. Tooltip com texto completo.
- Se `nextStep` for nulo (cadência concluída/sem próximo step), mostrar "—".

Sem mudanças de backend, RLS ou edge functions. A informação já está disponível em `cadence_steps`.

## Validação

- Na linha do lead Juliano, a coluna "Próxima execução" deve mostrar algo como:
  ```
  ✉ Email · Step 2
  24/06 10:13
  Assunto: Seguindo nosso papo...
  ```
- Hover no preview deve mostrar o conteúdo completo do template.