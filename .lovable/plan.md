# Card do Bitrix24 em Integrações

Adicionar o Bitrix24 à página **Configurações → Integrações**, no mesmo formato visual dos demais cards, sinalizado como **em desenvolvimento** (sem função de conexão ainda).

## O que muda

- Novo card "Bitrix24", categoria **CRM**, com descrição do que a integração vai fazer (sincronizar leads e negócios com o CRM Bitrix24).
- Estado visual: desconectado, com "Readiness: Em desenvolvimento" e botão desabilitado com o texto "Em desenvolvimento" — mesmo padrão já usado hoje no card do LinkedIn ("Em breve").
- O card entra na contagem de "Disponíveis" do topo, como os outros.

## Detalhes técnicos

- Arquivo: `src/pages/settings/Integrations.tsx` — inserir uma entrada no array `providers` (após `pipedrive`), usando `ProviderCardProps` existente: `status: "disconnected"`, `readinessLabel: "Em desenvolvimento"`, `actionLabel: "Em desenvolvimento"`, `disabled: true`, sem `onAction`.
- Ícone: usar `SiBitrix24` de `react-icons/si` se disponível na versão instalada; caso contrário, ícone genérico (`Building2` do lucide) com tint neutro — sem adicionar dependências novas.
- Nenhuma alteração de backend, tabela ou edge function nesta etapa.
- Bump de versão em `src/lib/version.ts` (beta 0.43) e registro no patch log do dia em `docs/patch-logs/`.
