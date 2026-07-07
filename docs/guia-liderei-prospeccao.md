# Guia de Desenvolvimento — Fluxo de Prospecção Automatizada com IA (Liderei)

> Documento de referência para orientar o desenvolvimento/ajustes da plataforma no Lovable, com base no alinhamento técnico e operacional realizado em 03/07/2026 entre Mário Schiavon e Nico.

---

## 1. Objetivo Geral

Construir um fluxo de prospecção ponta a ponta, multilocatário (multi-tenant), em que a IA seja capaz de:

1. Puxar leads de diferentes fontes (Apollo, listas externas, etc.);
2. Enriquecer esses leads com dados de site, LinkedIn e Instagram;
3. Qualificar e pontuar (score) cada lead com base em critérios específicos do cliente;
4. Gerar mensagens de abordagem personalizadas (WhatsApp/e-mail) com base em uma base de conhecimento própria de cada cliente.

Princípio central: **qualidade acima de volume**. É preferível abordar poucos leads com alta personalização do que muitos leads de forma genérica (o que também reduz risco de ser marcado como spam).

---

## 2. Estrutura de Base de Conhecimento (Multi-tenant)

A base de conhecimento **precisa ser exclusiva por cliente**. Cada cliente da Liderei deve ter seu próprio espaço de contexto, sem misturar dados entre projetos.

### 2.1 Base de Conhecimento Comercial (por cliente)
Contém o contexto do negócio do cliente, para que a IA entenda **o que está vendendo** e **por que está abordando** determinado lead. Deve incluir:

- O que a empresa/cliente faz e vende;
- Proposta de valor e diferenciais frente à concorrência;
- Histórico comercial: o que já funcionou e o que não funcionou em prospecções anteriores;
- Contexto do problema/dor que o produto resolve (ex.: dermatite em atendimentos veterinários, falta de fluxo de prospecção automatizado, etc.).

**Origem dos dados:** reuniões de kickoff/discovery com o cliente. A transcrição dessas reuniões deve ser processada e resumida para alimentar esse campo.

**Regras de edição:**
- O campo deve ficar visível tanto para o admin (equipe Liderei) quanto para o cliente;
- O cliente **não deve poder alterar** os dados vindos da reunião de kickoff;
- O cliente **pode adicionar** informações complementares.

### 2.2 Base de Conhecimento de Leads (por lead, dentro do tenant do cliente)
Base menor, gerada automaticamente durante o processo de enriquecimento (scraping) de cada lead. Contém:

- Dados extraídos do site do lead (texto);
- Dados extraídos do LinkedIn (quando disponível);
- Dados extraídos do Instagram (quando disponível).

Essa base alimenta tanto a qualificação/score quanto a geração da mensagem de abordagem personalizada.

---

## 3. Fluxo Operacional Completo (Ponta a Ponta)

```
1. Importação da lista de leads (Apollo ou lista externa/upload)
        ↓
2. Seleção de quantos leads serão enriquecidos (controle manual, não automático)
        ↓
3. Enriquecimento (scraping de site, LinkedIn, Instagram)
        ↓
4. Geração da base de conhecimento individual do lead
        ↓
5. Qualificação e Score do lead (critérios definidos por cliente)
        ↓
6. Filtro/decisão: seguir para cadência ou descartar
        ↓
7. Geração de mensagens personalizadas pela IA (com base na base comercial + base do lead)
        ↓
8. Disparo da cadência de abordagem (WhatsApp)
```

Fontes de dados variam por cliente:
- A maioria dos clientes usará **Apollo** como fonte principal (dados de LinkedIn + telefone);
- Casos excepcionais (ex.: sem presença em LinkedIn) usarão **lista própria enviada pelo cliente**.

---

## 4. Controle de Enriquecimento (Volume)

Problema identificado: subir uma lista grande (ex.: 5.000 leads) e tentar enriquecer tudo automaticamente é custoso e arriscado operacionalmente.

**Requisito de produto:**
- O usuário deve poder escolher **quantos leads deseja enriquecer** de uma lista importada — não deve ser um processo 100% automático e ilimitado;
- Referência de mercado: um SDR humano trabalha, em média, **100 a 150 leads/mês**. O enriquecimento inicial pode considerar uma margem (ex.: puxar ~200 para, após qualificação, sobrarem ~100 leads bons);
- Nesta fase inicial, evitar modelo 100% self-service (risco alto de o cliente não saber operar corretamente e ter uma má experiência). O acompanhamento da equipe Liderei nas primeiras operações é recomendado até a maturação do onboarding.

---

## 5. Qualificação e Score de Leads

Este é o núcleo diferencial da ferramenta: um processo de qualificação avançado que evita prospecção genérica.

### 5.1 Conceito
Para cada cliente, deve existir um **critério de qualificação configurável (prompt de score)**, que define o que é um "lead bom" e um "lead ruim" para aquele perfil de cliente ideal (ICP).

Exemplo prático usado como referência (caso Educa Open):
- Critério 1: presença de página dedicada a bolsas de estudo;
- Critério 2: publicação recente sobre o tema;
- Critério 3: número de bolsas oferecidas;
- Critério 4: destaque do tema na homepage;
- Critério 5: critério adicional definido pela IA.

Cada critério gera uma pontuação parcial, somada em um **score final** (ex.: 0 a 100), permitindo priorizar os leads mais aderentes.

### 5.2 Palavras-chave de inclusão e exclusão
O sistema deve permitir configurar termos que **aumentam** a pontuação (ex.: "casa popular", "minha casa minha vida") e termos que **reduzem/zeram** a pontuação (ex.: "alto padrão", "requinte", "localização privilegiada") — mostrando que a IA precisa diferenciar não apenas presença de palavras-chave, mas também contexto de exclusão.

### 5.3 Funcionalidade esperada na plataforma
- Campo de configuração por cliente: "critério de qualificação / score" (texto livre, tipo prompt);
- Processamento automático do conteúdo scrapado (site, LinkedIn, Instagram) contra esse critério;
- Geração de score numérico por lead;
- Possibilidade de o usuário revisar os leads antes de enviar para a cadência (aceitar, excluir, ajustar).

> Observação de melhoria futura (não prioritária agora): capacidade da IA de interpretar imagens do site, não apenas texto.

---

## 6. Geração de Mensagens de Abordagem

Após qualificação, a IA deve gerar mensagens personalizadas de abordagem (WhatsApp, e cadência em geral) combinando:

- Base de Conhecimento Comercial do cliente (o que ele vende, proposta de valor, histórico);
- Base de Conhecimento do Lead (dados extraídos do site/LinkedIn/Instagram);
- Objetivo da abordagem (ex.: agendar reunião para apresentar a solução).

A mensagem deve refletir o motivo específico do contato (ex.: vender uma revista para a Secretaria de Educação, vender a própria ferramenta Liderei, vender o shampoo da Groomer), evitando abordagens genéricas.

---

## 7. Princípio de Qualidade sobre Volume

- Preferir enviar poucas mensagens altamente qualificadas e personalizadas do que grandes volumes genéricos;
- Volume descontrolado aumenta risco de bloqueio/spam;
- A repetição de contato (múltiplas tentativas, formas diferentes) é importante, mas sempre dentro do grupo de leads já qualificados — não expandir para leads de baixa qualificação apenas para aumentar volume.

---

## 8. Próximos Passos (excluindo integração com Gmail)

- [ ] Kickoff/Discovery com cliente Raquel: extrair dados da transcrição para popular a base de conhecimento comercial;
- [ ] Ajustar a base de conhecimento de scraping/enriquecimento para funcionar em modelo multi-tenant (hoje está configurada apenas para um único cliente/caso);
- [ ] Configurar/verificar integração com Apollo;
- [ ] Verificar integridade dos dados no Pipedrive conforme estrutura definida;
- [ ] Finalizar preparação do fluxo inicial de cadência (WhatsApp) para testes;
- [ ] Estruturar campo de "critério de qualificação/score" configurável por cliente;
- [ ] Implementar controle de quantidade de leads a enriquecer por operação (não processar lista inteira automaticamente).

---

*Documento gerado a partir da ata e transcrição da reunião de 03/07/2026, com foco em orientar o desenvolvimento na plataforma Lovable. Trecho referente à integração com Gmail foi propositalmente removido conforme solicitado.*
