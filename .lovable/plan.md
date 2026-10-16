# Atualizar os modelos de IA descontinuados

## Diagnóstico confirmado

O código atual ainda utiliza quatro modelos descontinuados em 19 funções e auxiliares de IA. Os registros de produção de 16/10/2026 confirmam chamadas bem-sucedidas aos modelos Gemini 2.5 Pro e Flash: o aviso é real, mas não comprova uma interrupção atual.

O catálogo autenticado da workspace informa `deprecated: true` e estas datas de expiração:
- Gemini 2.5 Flash, Flash Lite e Pro: 20/10/2026, às 00h UTC.
- GPT-5: 11/12/2026, às 00h UTC.

O catálogo consultado **não informa mapeamentos de substituição automática**. Portanto, não foi possível confirmar redirecionamentos nem afirmar que as chamadas deixarão de funcionar nessas datas.

Como a mudança atravessa respostas comerciais, decisões com ferramentas, cadências e enriquecimento, executar uma migração coordenada com testes antes de alterar a produção.

## Substituições propostas

Todos os substitutos abaixo constam como ativos, disponíveis no catálogo da workspace e com retenção zero no endpoint Chat Completions utilizado pelo app.

| Modelo atual | Substituto | Uso e motivo |
| --- | --- | --- |
| Gemini 2.5 Flash | `google/gemini-3.8-flash` | Personalização, enriquecimento, classificação e análise; manter a categoria Flash, suporte multimodal e equilíbrio entre qualidade e rapidez. |
| Gemini 2.5 Flash Lite | `google/gemini-3.1-flash-lite` | Resumos de conversas; manter a categoria leve, adequada a extração e processamento em volume. |
| Gemini 2.5 Pro | `google/gemini-4-argon` | Agente SDR; modelo ativo para raciocínio e execução de tarefas com ferramentas. |
| GPT-5 | `openai/gpt-6.1-sol` | Análise de conversas e geração de respostas; capacidade atual de raciocínio profissional, preservando o fornecedor e o endpoint quando compatível. |

### Impacto financeiro

Preços de referência do catálogo em USD por milhão de tokens, sem cache, na primeira faixa de contexto; não são os valores dos planos comerciais do Leaderei:

| Troca | Entrada: antigo → novo | Saída: antigo → novo |
| --- | --- | --- |
| Flash → 3.8 Flash | US$ 0,30 → US$ 0,75 | US$ 2,50 → US$ 3,75 |
| Flash Lite → 3.1 Flash Lite | US$ 0,10 → US$ 0,25 | US$ 0,40 → US$ 1,50 |
| Pro → Argon | US$ 1,25 → US$ 2,00 | US$ 10,00 → US$ 10,00 |
| GPT-5 → 6.1 Sol | US$ 1,25 → US$ 2,00 | US$ 10,00 → US$ 10,00 |

O custo final e o tempo de resposta dependem do consumo real de tokens, raciocínio e tamanho do contexto. Não prometer redução de custo ou latência; comparar nos testes.

## Implementação

1. Atualizar apenas seleções executáveis dos quatro modelos descontinuados e os registros de modelo associados às novas decisões. Preservar modelos já ativos, instruções comerciais, regras de aprovação, limites operacionais e proteção de leads.
2. Preservar endpoints, streaming existente, temporizadores e lógica de tentativas, exceto ajustes estritamente necessários para o contrato do modelo escolhido. Remover limites opcionais de saída somente nas chamadas efetivamente atualizadas, conforme a política de upgrades; preservar limites explicitamente exigidos.
3. Conferir o histórico enviado ao agente: manter pares completos de chamadas/resultados de ferramentas e garantir um último turno de usuário ou resultado de ferramenta nos modelos Google.
4. Conferir o mapeamento de contingência para os novos IDs para não cair por engano em uma categoria inferior. Não substituir modelos dos fornecedores externos apenas por constarem no catálogo do Gateway; verificar a situação deles separadamente antes de qualquer alteração. Não executar contingência em testes após uma recusa terminal.
5. Atualizar estimativas de custo somente para os modelos introduzidos. Manter entradas antigas necessárias para relatórios históricos.

## Verificação e entrega

- Criar e executar testes pequenos para seleção de modelos, mapeamento de contingência e preservação das opções de requisição.
- Verificar respostas JSON de classificação, resumo, extração e personalização com dados de teste sem informações privadas.
- Exercitar o agente SDR em modo de simulação, incluindo chamada de ferramenta e continuação do histórico, sem enviar mensagens nem criar reuniões reais.
- Conferir as funcionalidades afetadas com uma sessão autenticada e verificar o resultado lido de volta no app, sem disparos frios.
- Inspecionar respostas e registros de IA. Se houver indisponibilidade, recusa do fornecedor ou bloqueio da conta, interromper o teste e reportar o impedimento, sem trocar modelos silenciosamente.
- Atualizar a versão beta e as notas para clientes após a implementação validada; registrar decisões técnicas pertinentes.
- Disponibilizar as funções alteradas somente após validação e marcar o aviso como corrigido apenas com evidência suficiente.
- **Não publicar o aplicativo.**

## Fora do escopo

Cobrança Asaas, planos, módulos, Gmail e mudanças visuais permanecem como estão. Nenhuma alteração no código do aplicativo foi realizada nesta revisão.