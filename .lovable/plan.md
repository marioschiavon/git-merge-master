# Enriquecimento de Instagram e LinkedIn (foco: raspagem)

Assinaturas modulares e Asaas ficam fora deste plano (próxima etapa).

## O que encontrei hoje

- A raspagem já existe e está ligada para toda a plataforma (uma única chave Apify, controlada pelo master).
- **Instagram:** só é raspado se o link aparecer no site do lead. Apenas 53 de 8.857 leads têm Instagram; 37 perfis foram raspados. É exatamente a dor do Nico (B Jumper, Paga Leve): e-commerce sem link no rodapé = sem Instagram.
- **LinkedIn:** 2.045 leads já têm link (vem do Apollo) e a raspagem rodou para dezenas deles, mas **nenhum perfil foi salvo**. O serviço usado para LinkedIn está retornando vazio/falhando sem aviso.
- Não existe controle por cliente: ou liga para todos, ou desliga para todos. Também não há limite de gasto.
- 7.878 leads nunca passaram pelo enriquecimento.

## O que vamos construir

### 1. Encontrar o Instagram mesmo sem link no site
Ordem de tentativa, parando na primeira que achar:
1. Link no site (como hoje, mas lendo também páginas "contato" e "sobre").
2. Busca na web por "nome da empresa + cidade + instagram" e validação do perfil (nome/site batendo).
3. Busca direta de perfis do Instagram pelo nome da empresa.
O perfil encontrado só é salvo se tiver confiança mínima; caso contrário fica como "sugerido" para o usuário confirmar na tela do lead.

### 2. Consertar o LinkedIn
- Diagnosticar por que o serviço atual não devolve nada (teste com 3 links reais).
- Trocar por um serviço que funcione e registrar o erro real quando falhar (nada de "rodou" sem resultado).
- Quando o lead não tiver link do LinkedIn, buscar pelo nome da empresa.

### 3. Controle por cliente no painel master
Na ficha de cada empresa (Master → Empresas), um bloco "Enriquecimento de redes":
- Liga/desliga: Instagram, LinkedIn (pessoa), LinkedIn (empresa), Facebook.
- Limite mensal de leads enriquecidos por rede (economiza créditos).
- Contador do mês: quantos já foram consumidos.
O cliente não vê nem altera esses botões; o painel dele só mostra o resultado no lead. Exemplo: e-commerce = só Instagram; B2B = só LinkedIn.

### 4. Uso do resultado na abordagem
- Resumo do Instagram (bio, nicho, últimos posts) e do LinkedIn já alimentam a IA; garantir que a primeira mensagem cite algo concreto do perfil quando existir.
- Na tela do lead, mostrar o perfil encontrado, quando foi atualizado e botão "Buscar de novo".

### 5. Reprocessar a base
Botão no master para enfileirar o enriquecimento de redes para os leads de uma empresa (respeitando o limite), para os clientes atuais já se beneficiarem.

## Validação
Testar com leads reais da B Jumper / Paga Leve (Instagram) e 3 leads com LinkedIn do Apollo; conferir perfis salvos, contador e mensagem gerada.

## Prazo
Entrega até sexta, conforme combinado na reunião.

## Detalhes técnicos
- Novo campo `companies.social_enrichment` (jsonb: redes ligadas, limite mensal) + contagem mensal derivada de `lead_social_profiles`/`apollo_api_calls`-like log; checagem em `enrich-lead` antes de cada ator, junto com o toggle global `platform_settings.apify_enabled`.
- Descoberta de Instagram: Firecrawl search (conector) ou ator de busca do Apify; validação por similaridade de nome/domínio na bio.
- LinkedIn: substituir `harvestapi/linkedin-profile-scraper` e `apimaestro/linkedin-company` após teste; logar status/erro em `steps_done`.
- Edição restrita a master_admin (RLS + UI em `CompanyDetailsSheet`).
- Respeitar `is_lead_protected` ao reprocessar.
