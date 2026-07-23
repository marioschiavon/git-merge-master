## Ideia

Trocar as abas fixas por um comportamento que depende do estado:

- **Enquanto está configurando** (algo pendente): página em **passos sequenciais**, um embaixo do outro, na ordem natural.
- **Depois que tudo está verificado**: página vira **abas** (Envio | Recebimento), compacta, pra consulta.

Isso resolve a confusão de "duas abas ao mesmo tempo" logo no primeiro contato, mantendo a organização depois.

## Estrutura durante a configuração (modo "passos")

```text
┌─ Header (título + badge de status geral) ─────────────────┐
├─ Banner de reputação (dica compacta) ─────────────────────┤
│                                                            │
│  Passo 1 — Cadastro inicial                                │
│  (só aparece se ainda não há domínio; some depois)         │
│  • Nome do remetente / prefixo / domínio                   │
│  • Botão "Cadastrar domínio"                               │
│                                                            │
│  Passo 2 — Envio (SPF / DKIM / DMARC)                      │
│  • Resumo (domínio, remetente, reply-to)                   │
│  • Checklist de entregabilidade                            │
│  • Tabela DNS de envio + "Como adicionar no meu provedor"  │
│  • Ações: Verificar DNS agora | Remover domínio            │
│  → estado "check" verde quando SPF/DKIM/DMARC ok           │
│                                                            │
│  Passo 3 — Recebimento (MX inbound)                        │
│  (fica bloqueado/acinzentado até o Passo 2 ficar verde)    │
│  • Explicação curta + endereço reply-to (copiar)           │
│  • Status próprio (Ativo / Configurando)                   │
│  • Tabela DNS de inbound (MX único)                        │
│  • Dica de propagação                                      │
│  → estado "check" verde quando MX ok                       │
│                                                            │
└─ Stats (Enviados / Recebidos 7d) ─────────────────────────┘
```

Cada passo tem um **cabeçalho numerado** com título, uma linha explicando o que é, e um ícone de estado (pendente / verificando / ok / erro). O passo 3 fica visualmente "apagado" enquanto o 2 não está verde — não bloqueia, só sinaliza a ordem sugerida (usuário ainda pode expandir e copiar o MX antes se quiser).

## Estrutura depois de tudo verificado (modo "abas")

Quando **Envio = verified** e **Recebimento = verified**, a página troca automaticamente para o layout de abas (Envio | Recebimento), igual ao que já foi feito no `beta 0.7`, com o conteúdo mais enxuto (sem instruções passo-a-passo em destaque, só resumo + tabela DNS + ações). É o modo "consulta".

Regra de troca: `modo = (envio.verified && inbound.verified) ? "abas" : "passos"`. Não precisa de toggle manual — muda sozinho.

## Regras de deduplicação (mantidas)

- "Verificar DNS agora": um único botão por seção (envio no passo 2, inbound no passo 3).
- "Remover domínio": só no passo 2 (envio).
- "Recebimento de respostas" continua fora do checklist de entregabilidade.
- Bloco "Como funciona (4 passos)" só antes do cadastro.

## Detalhes técnicos

- Arquivo tocado: `src/pages/settings/Email.tsx`.
- Mesmo dado, mesmas mutations (`resend-domain-create`, `resend-domain-verify`, `resend-domain-delete`); só muda o layout condicional.
- Componentes internos: `<StepCard number title status>` reutilizado nos passos 2 e 3; o conteúdo interno é o mesmo já usado nas abas hoje.
- Sem mudanças em edge functions, tabelas ou RLS.
- Bump de versão para `beta 0.8` em `src/lib/version.ts`.
