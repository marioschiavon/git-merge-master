# Teste real do enriquecimento de Instagram e LinkedIn

## Situação atual
Desde a mudança de ontem, só rodaram os 3 testes que eu mesmo fiz (todos com sucesso):
- Paga Leve: Instagram (com posts recentes), Facebook e LinkedIn da empresa.
- 2 leads de prefeitura: LinkedIn da pessoa e da empresa.
Nenhum lead novo entrou depois disso, então ainda não há resultado "do dia a dia" para mostrar.

## O que vou testar (precisa sair do modo planejamento, porque o teste roda o enriquecimento de verdade)
Rodar em cerca de 15 leads reais, separados em 3 grupos:
1. **E-commerce / empresas com site** (ex.: Paga Leve, B Jumper, leads de planilha): é o caso do Nico, o mais importante para o Instagram.
2. **Leads do Apollo com link do LinkedIn**: verifica pessoa e empresa.
3. **Prefeituras do MunicipIA**: costumam ter site do governo e pouca rede social.

Custo estimado: cerca de 15 a 40 leituras de redes (alguns centavos de dólar).

## O que vou trazer no resultado
Uma tabela por lead com:
- Se achou o Instagram no site (sim/não) e o @ encontrado.
- Se leu o perfil: bio, seguidores e quantos posts recentes.
- LinkedIn da pessoa e da empresa: lido ou não, com o motivo quando falhar.
- Tempo de cada rodada e se precisou de nova tentativa.
- Trecho da mensagem gerada pela IA usando essas informações, quando houver.

Também um resumo: % de leads com Instagram encontrado, % de leituras bem-sucedidas e falhas por motivo.

## Ajuste junto, se aparecer no teste
- Seguidores do Instagram chegando vazios: corrigir a leitura desse campo.
- Qualquer falha recorrente que o teste revelar será listada antes de corrigir.

## Detalhes técnicos
- Disparo via `enrich-lead` com `lead_id` + `force`, leads escolhidos por `website`/`instagram_url`/`linkedin_url`, excluindo `is_lead_protected`.
- Leitura de `lead_enrichment_jobs.steps_done.social`, `lead_social_profiles` e `cadence_custom_messages`.
