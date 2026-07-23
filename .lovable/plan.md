## Problema

A página `Configurações → Email` cresceu em camadas e hoje mistura assuntos parecidos em posições diferentes da tela:

- **Topo:** header + banner de reputação + "Como funciona (4 passos)" + Checklist de entregabilidade + Card de "Recebimento de respostas" (com MX inbound).
- **Meio:** "Sua configuração" + tabela de registros DNS de envio (SPF/DKIM/DMARC).
- **Base:** stats + botão "Passo 4: Verificar meu DNS" + botão Remover.

Isso gera dois problemas concretos:

1. **DNS aparece em dois lugares diferentes**: o MX de inbound fica em um card lá no topo (dentro do `InboundCard`), enquanto SPF/DKIM/DMARC ficam numa tabela lá embaixo. O cliente precisa rolar para cima e para baixo copiando registros de blocos separados.
2. **Ações repetidas**: "Verificar DNS agora" aparece dentro do card "Sua configuração" e de novo como "Passo 4: Verificar meu DNS" no rodapé. "Remover" também aparece em dois lugares (quando trava e no rodapé).

## Objetivo

Deixar claro que existem **dois assuntos independentes** — **Envio** (SPF/DKIM/DMARC) e **Recebimento** (MX inbound) — cada um com seu status, seus registros DNS e suas ações, sem duplicações.

## Nova estrutura da página

```text
┌─ Header (título + badge geral) ───────────────────────────┐
├─ Banner de reputação (1 linha, pode virar dica compacta) ─┤
├─ Cadastro inicial (só quando não há domínio) ─────────────┤
│                                                            │
├─ [ Tabs ]  Envio  |  Recebimento  ────────────────────────┤
│                                                            │
│  Aba "Envio"                                               │
│  • Resumo (domínio, remetente, reply-to, status)           │
│  • Checklist de entregabilidade (SPF / DKIM / DMARC /      │
│    Subdomínio) — sem a linha "Recebimento de respostas"    │
│  • Tabela DNS de envio (SPF/DKIM/DMARC) com "Como          │
│    adicionar no meu provedor" collapsible                  │
│  • Ações: Verificar DNS agora  |  Remover domínio          │
│                                                            │
│  Aba "Recebimento"                                         │
│  • Explicação curta + endereço reply-to (com copiar)       │
│  • Status próprio (Ativo / Configurando)                   │
│  • Tabela DNS de inbound (MX único)                        │
│  • Dica "propagação até 1h; envios continuam funcionando"  │
│                                                            │
└─ Stats (Enviados / Recebidos 7d) — abaixo das abas ───────┘
```

### Regras de deduplicação

- O bloco "Como funciona (4 passos)" continua aparecendo **apenas antes do cadastro** (quando ainda não há domínio) e some depois — hoje ele fica exibido para sempre.
- O botão "Verificar DNS agora" existe **em um único lugar por aba** (não repetir dentro de "Sua configuração" e no rodapé).
- O botão "Remover domínio" fica **só na aba Envio**, no rodapé da aba.
- O item "Recebimento de respostas" **sai do checklist de entregabilidade** — ele vira o status próprio da aba Recebimento, então o checklist volta a tratar só de reputação de envio (SPF/DKIM/DMARC/Subdomínio).
- O `InboundCard` (hoje no topo) deixa de existir como card solto e vira o conteúdo da aba Recebimento.

### Detalhes de UX

- Badge geral no header mostra o status do **Envio** (é o que bloqueia disparos). A aba Recebimento tem sua própria badge própria para não confundir.
- Cada aba mostra um pequeno cabeçalho de uma linha explicando o que é: "SPF/DKIM/DMARC autorizam o mundo a aceitar seus envios" / "MX para receber respostas dos prospects dentro do Leaderei".
- Manter o polling silencioso atual (a cada 15s) — funciona igual para ambos os status.
- Bump de versão para `beta 0.7` em `src/lib/version.ts`.

## Detalhes técnicos

- Arquivo tocado: `src/pages/settings/Email.tsx` (reorganização puramente de UI, mesma query, mesmas mutations `resend-domain-create` / `resend-domain-verify` / `resend-domain-delete`).
- Usar `Tabs` de `@/components/ui/tabs` (já usado em outras páginas).
- `deliverabilityChecks()` perde o campo `inbound` (passa a ser exibido só na aba Recebimento).
- Nenhuma mudança em edge functions, tabelas ou RLS.
