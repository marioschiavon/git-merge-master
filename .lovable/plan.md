# Ajustes no Manual do Usuário

Duas mudanças no manual (`docs/manual/`), sem tocar em código do app.

## 1. Remover a linha "Rota:" de todos os capítulos

Hoje quase todo capítulo abre com algo tipo:

```
**Rota:** `/settings/integrations`
**Quando usar:** ...
```

Isso confunde usuário leigo (ele não sabe o que é uma "rota"). Removo **apenas** essa linha em cada arquivo, mantendo "Quando usar" e "Pré-requisitos". Onde a instrução realmente depende do menu, o passo a passo já diz "Vá em **Configurações → Integrações**", então nada de navegação se perde.

Arquivos afetados (24): `01` até `19` + `03a-03e`.

## 2. Revisar a seção de Integrações (sem novos capítulos)

Mantendo apenas os 5 capítulos que já existem (WhatsApp, Email, Apollo, Pipedrive, Cal.com). LinkedIn e Enriquecimento (Apify) ficam de fora por enquanto.

O que muda em cada arquivo:

| Arquivo | O que muda |
|---|---|
| `03-integracoes.md` | Reescrita com linguagem mais leiga: o que é uma "integração", tabela das 5 integrações disponíveis, ordem recomendada de conexão e por quê |
| `03a-whatsapp-hook7.md` | Sem "Rota". Passo a passo mais didático — explica o que é QR-Code e o caminho exato no celular (**WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho**) |
| `03b-email-resend.md` | Sem "Rota". Deixar mais claro o que cada tipo de registro (TXT/CNAME/MX) faz, com analogia simples, e passo a passo por provedor DNS |
| `03c-apollo.md` | Sem "Rota". Caminho exato dentro do Apollo (menu por menu) para gerar a API key |
| `03d-pipedrive.md` | Sem "Rota". Caminho exato dentro do Pipedrive para gerar o token |
| `03e-calcom.md` | Sem "Rota". Passo a passo com os nomes de menu atuais do Cal.com |

Todos continuam terminando com **Próximo passo →** no encadeamento atual: 03 → 03a → 03b → 03c → 03d → 03e → 04.

## Fora do escopo

- Nenhum novo capítulo (sem `03f-enriquecimento.md`, sem `03g-linkedin.md`).
- Sem mudanças em código, edge functions ou banco.
- Sem screenshots.
- Continua em **pt-BR**.

## Detalhes técnicos

- Remoção da linha `**Rota:** ...` via `sed` (padrão consistente nos 24 arquivos).
- Reescrita manual dos 6 arquivos de integração para linguagem mais acessível.
- `docs/manual/README.md` não muda (sumário permanece igual).
