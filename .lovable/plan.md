Plano: adicionar badge com link para a página de boas práticas no card do WhatsApp em Integrações

Objetivo
- No card de WhatsApp da tela Configurações → Integrações, exibir uma badge clicável que leve o usuário para `/guides/whatsapp` (página de boas práticas do WhatsApp).

Mudanças propostas

1. Estender `ProviderCardProps` em `src/pages/settings/Integrations.tsx`
   - Adicionar prop opcional `badgeLink?: { label: string; to: string }`.

2. Alterar o componente `ProviderCard`
   - Se `badgeLink` existir, renderizar um `Badge` (variante outline ou secondary) com um `Link` do React Router interno, usando o ícone de seta/link.
   - Posicionar a badge abaixo da descrição do card, mantendo o layout limpo.

3. Configurar o provider `whatsapp`
   - Passar `badgeLink: { label: "Boas práticas", to: "/guides/whatsapp" }`.

4. Verificar importações
   - Garantir que `Link` do `react-router-dom` esteja disponível (já há `useNavigate`, então só adicionar `Link` ao import).

Critérios de aceitação
- O card de WhatsApp exibe uma badge "Boas práticas".
- Clicar na badge navega para `/guides/whatsapp` sem recarregar a página.
- Outros cards não são afetados.
- O build continua passando sem erros de TypeScript.