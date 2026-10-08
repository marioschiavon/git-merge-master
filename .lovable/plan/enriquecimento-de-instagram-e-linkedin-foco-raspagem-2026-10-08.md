# Enriquecimento de Instagram e LinkedIn (foco: raspagem)

Assinaturas modulares e Asaas ficam fora deste plano (próxima etapa).

## O que encontrei hoje

- A raspagem já existe e está ligada para toda a plataforma (uma única chave, controlada pelo master).
- **Por que precisa clicar várias vezes:** a tela de Configurações mostra "Descobrir Instagram/LinkedIn no site" como **ligado**, mas o enriquecimento automático só procura as redes quando a opção foi salva explicitamente. Em empresas que nunca salvaram essa tela, o automático pula o Instagram. Além disso, só a página inicial do site é lida, e a raspagem do Instagram pode estourar o tempo sem tentar de novo.
- **Resultado:** só 53 de 8.857 leads têm Instagram; 37 perfis raspados.
- **LinkedIn:** 2.045 leads já têm link (vem do Apollo), a raspagem rodou para dezenas deles, mas **nenhum perfil foi salvo**. O serviço usado está retornando vazio sem aviso.
- Não existe controle por cliente: liga para todos ou desliga para todos.
- 7.878 leads nunca passaram pelo enriquecimento.

## O que vamos construir

### 1. Instagram só a partir do site do lead (sem busca por nome)
- Corrigir o automático para respeitar o que a tela mostra (ligado por padrão).
- Ler a página inicial e também as páginas de contato/sobre, rodapé e links "fale conosco" para achar o Instagram.
- Se não estiver no site, o lead fica sem Instagram — sem buscas por nome + cidade, para evitar ruído.

### 2. Totalmente automático, sem cliques repetidos
- Ao entrar o lead (importação, Apollo, MunicipIA, manual), descobrir o Instagram e já raspar o perfil na mesma rodada.
- Se a raspagem falhar ou demorar, tentar de novo sozinho (até 3 vezes, com intervalo), em vez de exigir novo clique.
- O botão manual na tela do lead continua existindo só para "Atualizar agora".

### 3. Consertar o LinkedIn
- Testar o serviço atual com 3 links reais e trocar por um que funcione.
- Registrar o erro real quando falhar (nada de "rodou" sem resultado).

### 4. Liga/desliga por cliente no painel master
Na ficha de cada empresa (Master → Empresas), bloco "Enriquecimento de redes":
- Liga/desliga automático por rede: Instagram, LinkedIn (pessoa), LinkedIn (empresa), Facebook.
- Limite mensal opcional por rede e contador do mês (controle de créditos).
- Exemplo: e-commerce = só Instagram; B2B = só LinkedIn.

### 5. Uso na abordagem
- Garantir que a primeira mensagem cite algo concreto do Instagram/LinkedIn quando existir.
- Tela do lead mostra o perfil encontrado e quando foi atualizado.

### 6. Reprocessar a base
Botão no master para enfileirar o enriquecimento de redes dos leads atuais de uma empresa (respeitando liga/desliga, limite e a lista "Não prospectar").

## Validação
Leads reais da B Jumper / Paga Leve (Instagram no site) e 3 leads com LinkedIn do Apollo: conferir que o perfil é salvo numa única rodada automática, sem clique.

## Prazo
Entrega até sexta, conforme combinado.

## Detalhes técnicos
- Bug: `enrich-lead` usa `settings.discover_socials` (truthy) enquanto a UI usa `!== false`; padronizar para `!== false`.
- Descoberta: reaproveitar `fetchContactPages` para socials; Instagram apenas via site.
- Retentativa: falha/timeout de ator volta o job a `pending` com `next_run_at` + backoff (máx. 3 `attempts`) em vez de `completed`.
- Novo `companies.social_enrichment` (jsonb: redes ligadas, limite mensal), editável só por master_admin; checado em `enrich-lead` junto com `platform_settings.apify_enabled`. Contador mensal via `lead_social_profiles.scraped_at`.
- LinkedIn: substituir `harvestapi/linkedin-profile-scraper` / `apimaestro/linkedin-company` após teste; logar status em `steps_done`.
- Reprocessamento respeita `is_lead_protected`.
