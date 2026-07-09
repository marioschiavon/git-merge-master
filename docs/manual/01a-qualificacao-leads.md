# 01a. Qualificação de Leads (Score)

**Quando usar:** depois de configurar a empresa, antes de começar a importar leads em volume.
**Pré-requisitos:** ter clareza do seu ICP (perfil de cliente ideal).

## O que é

Toda vez que um lead entra no Leaderei, a IA lê o site dele (e dados de enriquecimento quando disponíveis) e devolve uma **nota de 0 a 100** — o **Score** — com base no critério que **você** escreveu.

O Score serve para:

- **Priorizar** quem entra em cadência primeiro.
- **Filtrar listas** — trabalhar só leads acima de determinada nota.
- **Não queimar canal** enviando mensagem para quem obviamente não é ICP.

Quanto mais específico o seu critério, mais útil é a nota. Critério vago ("empresa boa") gera Score inútil.

## Onde fica

Menu lateral **Configurações** → card **Qualificação de Leads (Score)**.

## Passo a passo

### 1. Escreva o critério (prompt)

Liste critérios **objetivos**, em formato numerado. Cada critério deve ser algo que dá para verificar olhando o site do lead.

Exemplo genérico:

```
Critério 1: possui página dedicada ao produto/serviço X.
Critério 2: publicação recente sobre o tema (últimos 12 meses).
Critério 3: menciona números concretos (clientes, unidades, faturamento).
Critério 4: destaca o tema na homepage.
```

Evite:

- ❌ "Empresa séria" (subjetivo)
- ❌ "Parece organizada" (subjetivo)
- ❌ "Tem cara de bom pagador" (a IA não sabe)

Prefira:

- ✅ "Tem página específica para bolsas de estudo"
- ✅ "Publicou algo em blog nos últimos 6 meses"
- ✅ "Site menciona atendimento em todo o Brasil"

### 2. Adicione termos que AUMENTAM o score

Palavras/expressões que, quando aparecem no site, confirmam que o lead é ICP. Adicione uma por vez e pressione **Enter** ou clique em **Adicionar**.

### 3. Adicione termos que REDUZEM ou ZERAM o score

Palavras/expressões que, quando aparecem no site, indicam que o lead **não** é ICP. Cuidado — esses termos podem zerar leads inteiros.

### 4. Salve

Clique em **Salvar critério**. A partir daí, todos os **novos leads** analisados usam esse critério.

## Como a IA usa

Ao analisar o site de cada lead, a IA gera:

- Um **breakdown por critério** (o que ela encontrou de evidência para cada item da sua lista).
- Uma **nota consolidada** de 0 a 100.
- Ambos ficam visíveis dentro do lead, na aba de insights.

## Exemplos prontos

### Exemplo A — Educação (bolsas de estudo)

**Critério:**
```
Critério 1: possui página dedicada a bolsas de estudo.
Critério 2: publicação recente sobre o tema (últimos 12 meses).
Critério 3: menciona número de bolsas oferecidas.
Critério 4: destaca "bolsa" ou "auxílio financeiro" na homepage.
```
**Aumentam:** `bolsa de estudo`, `bolsa integral`, `ProUni`, `auxílio educacional`, `descontos para funcionários`
**Reduzem:** `curso livre`, `certificado sem valor oficial`

### Exemplo B — Imobiliária (segmento popular)

**Critério:**
```
Critério 1: trabalha com imóveis abaixo de R$ 300 mil.
Critério 2: menciona programas habitacionais governamentais.
Critério 3: tem estoque grande na periferia/interior.
Critério 4: destaca financiamento facilitado.
```
**Aumentam:** `casa popular`, `Minha Casa Minha Vida`, `MCMV`, `financiamento Caixa`, `entrada facilitada`
**Reduzem:** `alto padrão`, `requinte`, `cobertura`, `localização privilegiada`, `luxo`

## Dicas

- **Comece simples.** 3 a 5 critérios já entregam Score útil. Vá refinando depois.
- **Teste em 5–10 leads reais** antes de importar milhares. Se a nota não bate com sua percepção, ajuste o critério.
- **Termos de exclusão são poderosos.** Um único termo forte ("alto padrão") pode zerar um segmento inteiro — use com intenção.
- **Reprocessamento manual:** se você mudar o critério, os leads antigos mantêm a nota antiga até você reprocessar (via ação em massa na tela de Leads).

## Erros comuns

- **Critério vago** ("empresa boa", "site bonito") → Score aleatório.
- **Termos de aumento e redução contraditórios** (ex.: `imóvel` como termo que aumenta E `imóvel de luxo` como termo que reduz — a IA fica confusa).
- **Não reprocessar após mudar critério** → leads antigos com nota desatualizada.
- **Confundir Score com Intent.** Score = "esse lead é ICP?". Intent = "esse lead demonstrou interesse na resposta?". São coisas diferentes.

---

**Próximo passo →** [02. Equipe](./02-equipe.md)
