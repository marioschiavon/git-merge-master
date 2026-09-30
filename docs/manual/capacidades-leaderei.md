# Leaderei — Capacidades do Software

Documento de referência para treinar assistentes de IA sobre o que a plataforma Leaderei faz, como faz e onde estão seus limites.

> Este documento descreve **comportamento de produto**. Ele não descreve arquitetura interna, provedores de infraestrutura, modelos, chaves ou detalhes de implementação. O WhatsApp é operado por meio da **Hook7**, a API oficial de integração de WhatsApp usada pela plataforma — nenhum detalhe além disso deve ser assumido ou divulgado.

---

## 1. O que é o Leaderei

O Leaderei é um SaaS de **prospecção B2B ativa com agente de IA**. Ele encontra/importa leads, enriquece dados, dispara cadências multicanal (WhatsApp e e-mail), conversa com o lead usando IA treinada no contexto da empresa, qualifica, agenda reuniões e devolve tudo para o CRM.

Ele substitui o trabalho repetitivo do SDR: primeira abordagem, follow-ups, respostas iniciais, triagem e agendamento. Ele **não substitui** o closer/vendedor humano na negociação.

**Modelo de operação:** multiempresa. Cada empresa tem seus próprios leads, conexões, scripts, equipe e dados totalmente isolados.

---

## 2. Estrutura funcional (ordem de uso)

```text
Fase 1 — Configuração
  Configurações gerais → Equipe → Integrações → Base de Conhecimento → Scripts IA → Intents & Ações

Fase 2 — Operação
  Buscar leads → Leads → Listas → Cadências → Aprovações → Acompanhamento

Fase 3 — Relacionamento
  Conversas → Inbox humana → Anotações → Reuniões

Fase 4 — Análise
  Dashboard → Relatórios → Runs do Agente
```

---

## 3. Funcionalidades em detalhe

### 3.1 Entrada de leads

| Fonte | O que faz |
|---|---|
| Apollo | Busca leads por filtros (cargo, setor, porte, localização) e importa direto |
| Planilha / CSV | Importação com mapeamento de colunas (nome, e-mail, empresa, telefone, celular, corporativo, cidade, site) |
| MunicipIA | Envio direto de órgãos públicos filtrados; cada envio vira uma Lista nomeada |
| Cadastro manual | Lead a lead |
| Indicação por cartão de contato | Quando um lead envia um cartão de contato no WhatsApp, o indicado é cadastrado como novo lead vinculado a quem indicou |

Comportamentos automáticos na importação:
- **Normalização de telefone brasileiro**: corrige formatos, separa vários números colados num mesmo campo (vírgula, barra, ponto e vírgula) e prioriza o celular como canal de WhatsApp.
- **Deduplicação** por e-mail/telefone: leads existentes são atualizados, não duplicados.
- **Lista automática** para cada importação, permitindo filtrar, revisar e excluir em massa.
- **Desfazer importação**: apaga os leads criados por aquela importação que ainda não foram contatados, preservando os que já existiam ou já estão em conversa.
- **Bloqueio por lista "Não prospectar"** (organizações protegidas): clientes atuais, negociações em andamento e quem pediu para não ser contatado nunca entram em prospecção.
- **Descarte de registros sem contato**: registros sem telefone e sem e-mail não viram lead.

### 3.2 Enriquecimento e qualificação

- Fila automática de enriquecimento de dados da empresa/lead.
- Análise do site da empresa para contexto comercial.
- **Score** do lead e status de prontidão ("pronto para cadência" = tem contato utilizável e não está protegido).
- **Verificação de WhatsApp em massa**: confirma se o número tem WhatsApp antes de gastar disparo. Roda sozinha em importações quando há conexão ativa. Números com aparência de fixo **não** são bloqueados por formato — só são marcados como inválidos quando a verificação confirma.

### 3.3 Canais de comunicação

**WhatsApp (via Hook7)** — canal principal.
- Conexão por QR Code, múltiplas conexões por empresa.
- Reconexão sem perder histórico nem a configuração da conexão.
- Detecção de queda, aviso ao administrador, tentativa de religar automaticamente em quedas transitórias e explicação em linguagem simples do motivo da queda.
- Fila de envio com ritmo humano: intervalos variáveis, limites diários, período de aquecimento do número e prioridade para responder quem já respondeu.
- Recebe e interpreta texto, áudio (transcrição automática) e cartões de contato.

**E-mail** — canal complementar. Ver ressalva importante na seção 5.
- Conexão da caixa do próprio usuário por autorização segura (sem senha dentro do app).
- Cada lead fica amarrado à mesma caixa que o abordou primeiro (stickiness), mantendo a conversa em uma única thread.
- Leitura de respostas, follow-up automático, aquecimento e limites de envio, link de descadastro.

### 3.4 Cadências e agente de IA

- Cadências com múltiplas etapas, canal por etapa, espera entre etapas e prazo total.
- Mensagens geradas pela IA usando **Base de Conhecimento** (informações da empresa, produto, objeções, casos) e **Scripts IA** (tom, estrutura, regras do que pode e não pode dizer).
- Personalização por lead a partir dos dados disponíveis.
- **Intents & Ações**: a IA classifica a intenção da resposta (interesse, objeção, pedido de informação, pedido para não contatar, agendamento) e dispara a ação correspondente.
- Parada automática da cadência quando o lead responde, pede para não ser contatado ou é marcado como protegido.
- Reengajamento de quem não respondeu, dentro dos limites configurados.

### 3.5 Aprovação humana (HITL)

- Modo opcional por empresa: nenhuma mensagem sai sem aprovação humana.
- Tela de Aprovações com edição do texto antes de enviar.
- Mensagens geradas há muito tempo recebem o selo "Antiga".
- Falha no envio aparece como "Falhou", com o motivo em linguagem clara.

### 3.6 Conversas e atendimento humano

- Todas as conversas em um só lugar, com data e hora de cada mensagem no horário de Brasília e status (Entregue, Na fila, Falhou).
- Abas **Todas / Responderam / Sem resposta**, com filtro de período e contador de respostas recentes.
- **Inbox humana**: assumir a conversa a qualquer momento, com sugestões da IA e indicador de tempo de resposta.
- Anotações internas por lead e feedback para melhorar as respostas do agente.

### 3.7 Reuniões

- Integração com Cal.com: a IA oferece horários reais, segura o horário durante a conversa e confirma o agendamento.
- Convite enviado ao lead, com convidados adicionais e follow-up caso o horário expire.

### 3.8 CRM e integrações

- **Bitrix24**: cria/atualiza Pessoa e Negócio, avança o estágio conforme a prospecção (respondeu, reunião marcada), sem sobrescrever dados já existentes no CRM.
- **Pipedrive**: importação e sincronização de leads.
- **Apollo**: busca e importação.
- **MunicipIA**: envio de órgãos públicos filtrados direto para o Leaderei.

### 3.9 Gestão, análise e segurança

- Dashboard com leads, qualificados, cadências ativas, respostas recentes e taxa de conversão.
- Relatórios de desempenho por cadência, canal e período.
- **Runs do Agente**: histórico de cada decisão da IA, com contexto e resultado.
- Equipe com papéis e permissões; convites por e-mail.
- Log de auditoria das ações sensíveis.
- Controle de custo de IA por empresa.
- Manual dentro do app e notas de versão a cada atualização.

---

## 4. O que o Leaderei NÃO faz

- **Não negocia nem fecha vendas.** O agente qualifica e agenda; a negociação é humana.
- **Não é um CRM completo.** Não gerencia pipeline comercial, propostas, contratos ou faturamento. Ele integra com o CRM do cliente.
- **Não faz ligações telefônicas** nem discagem automática.
- **Não prospecta por SMS, LinkedIn, Instagram ou outras redes sociais.** Os canais são WhatsApp e e-mail.
- **Não garante entrega nem imunidade a bloqueio de WhatsApp.** A plataforma reduz risco com ritmo, limites e aquecimento, mas as regras são do WhatsApp, não do Leaderei.
- **Não cria a base de contatos do nada.** Depende de Apollo, planilha, MunicipIA, CRM ou cadastro.
- **Não valida se um e-mail existe** antes do envio (valida WhatsApp, não e-mail).
- **Não envia campanhas de marketing em massa.** É prospecção 1 a 1, conversacional.
- **Não recupera mensagens anteriores à conexão** do WhatsApp nem histórico de antes da adoção da plataforma.
- **Não substitui consentimento e conformidade.** Respeitar LGPD, opt-out e boas práticas é responsabilidade de quem opera.
- **Não opera fora do horário e limites configurados.** Se a janela de envio é restrita, a fila espera.
- **Não faz disparo em massa instantâneo.** O envio é enfileirado e espaçado de propósito.
- **Não tem aplicativo nativo para celular.** É web, responsivo no navegador.
- **Não oferece portabilidade automática de conexão de WhatsApp entre empresas.**

---

## 5. Ressalva importante — conexão de e-mail via Google (Gmail / Workspace)

**A funcionalidade existe e está pronta na plataforma**: conectar a caixa de e-mail do usuário, enviar cadências, ler respostas, manter a thread e aplicar aquecimento e limites.

**Porém**, para que os usuários finais consigam conectar contas **Gmail / Google Workspace** com um clique, é obrigatório que a administração conclua previamente o cadastro e a aprovação do aplicativo no **Google Cloud Console** (tela de consentimento, escopos e credenciais). Existe um passo a passo dedicado para isso na documentação.

**Status atual:** essa configuração no Google Cloud **ainda não foi concluída**. Até que seja:

- A conexão de contas Gmail pelos clientes **não fica disponível na prática**.
- O **WhatsApp é o canal principal e prioritário** de prospecção ativa.
- Todo o restante do fluxo (importação, enriquecimento, cadência, IA, aprovações, CRM, reuniões, relatórios) funciona normalmente.

Ao responder perguntas sobre e-mail, a IA deve deixar claro: **é capacidade existente do produto, pendente de uma configuração de ambiente no Google — não é uma limitação do software.**

---

## 6. Resumo em uma frase

O Leaderei importa e enriquece leads B2B, valida números de WhatsApp, dispara cadências personalizadas por WhatsApp e e-mail com um agente de IA treinado no negócio do cliente, conversa e qualifica automaticamente, agenda reuniões, entrega tudo no CRM e mostra em painéis analíticos taxa de resposta, custos de IA e o histórico completo de cada mensagem trocada.
