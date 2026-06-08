## Minha opinião

Sua estrutura está excelente — concordo 100% que indicação é avanço de funil, não perda. Mas, em vez de programar 15 fluxos rígidos, recomendo modelar **um intent unificado de "referral"** com slots de dados extraídos pela IA, e deixar 4 sub-fluxos operacionais cuidarem da execução. Mais simples de manter, mais robusto, e a IA (que já tem a Base de Conhecimento) escolhe o tom do novo outreach por canal/cargo sem precisarmos hard-codar 15 templates.

Proponho entregar em 2 fases. Fase 1 cobre 90% do valor; Fase 2 é refinamento.

---

## Fase 1 — Detectar indicação, criar novo lead e abordar (MVP)

### 1. Schema (uma migration)

Adicionar em `public.leads`:
- `referral_source_lead_id uuid` (FK → leads.id) — quem indicou
- `referral_role text` — "indicador" | "decisor" | null (default null)
- `referral_context text` — frase livre com contexto da indicação
- `referral_permission_to_mention boolean` — autorização para citar quem indicou

Adicionar valores ao enum `lead_status` (ou criar coluna textual auxiliar se o enum estiver travado):
- `indicador`, `aguardando_contato_decisor`, `encaminhado_para_decisor`, `aguardando_encaminhamento_interno`, `contato_errado`, `sem_acesso_decisor`

Sem nova tabela — reutilizamos `leads` (mesmo `company_id`), `conversations` e `messages`. O vínculo entre o lead original e o indicado fica em `referral_source_lead_id`.

### 2. inbound-webhook: novo intent `referral`

No JSON de saída da IA, adicionar:

```json
"action": "referral",
"referral": {
  "subtype": "with_contact | without_contact | will_forward | wrong_person | gatekeeper | refuses_contact",
  "referred_name": "Dra. Ana" | null,
  "referred_role": "veterinária responsável" | null,
  "referred_email": "..." | null,
  "referred_phone": "..." | null,
  "referred_channel": "whatsapp | email | phone" | null,
  "permission_to_mention": true | false | null,
  "context": "frase resumindo a indicação"
}
```

A IA passa a receber, no system prompt, uma seção "DETECÇÃO DE INDICAÇÃO" com as regras-chave que você descreveu (não insistir na pessoa errada, pedir permissão para citar, recepcionista = gatekeeper, etc.) e a lista de subtypes. Isso fica curto porque o resto (tom, tagline da empresa) já vem da Base de Conhecimento.

### 3. Roteador de subtypes (código TS, não prompt)

No `inbound-webhook`, depois de parsear o JSON, se `action === "referral"`:

| subtype | Ação do sistema |
|---|---|
| `with_contact` | (a) responder agradecendo e pedindo permissão se ainda não houver; (b) criar novo `lead` com `referral_source_lead_id = currentLead.id`, `referral_role='decisor'`, `status='novo'`; (c) marcar lead atual como `referral_role='indicador'`, `status='indicador'`; (d) criar `conversation` no canal indicado; (e) inserir 1ª mensagem outbound contextualizada (gerada pela própria IA neste mesmo turno, campo extra `new_outreach_message`); (f) pausar `cadence_enrollments` ativos do lead original |
| `without_contact` | responder pedindo WhatsApp/e-mail do indicado; status = `aguardando_contato_decisor` |
| `will_forward` | responder com texto curto e encaminhável (gerado pela IA a partir da Base); status = `aguardando_encaminhamento_interno`; agendar follow-up leve em 2 dias (registrar em `lead_activities` com `type='followup_scheduled'` + `metadata.run_after`) |
| `wrong_person` | pedir quem é o responsável; status = `contato_errado`; pausar cadência |
| `gatekeeper` | mensagem curta pedindo direcionamento ao responsável (sem vender); manter cadência pausada |
| `refuses_contact` | oferecer mensagem encaminhável; status = `sem_acesso_decisor`; encerrar após 1 follow-up |

Em todos os casos: salvar `lead_activities` (`type='referral_detected'`, metadata com o objeto referral completo) para auditoria, e registrar o reply na conversation existente via Gmail (já threading) ou canal correto.

### 4. Nova abordagem para o lead indicado

Quando criamos o novo lead (subtype `with_contact`), geramos a 1ª mensagem **no mesmo turno**, pedindo à IA — no JSON de saída — um campo extra `new_outreach_message` quando aplicável. Template guiado pelo prompt:

> "Olá {nome}. Falei com {indicador_nome} da {empresa} e ela me indicou você como responsável por {área}. Sou da {empresa_usuario}…[1 frase da Base]…Faz sentido conversarmos 15min?"

Se `permission_to_mention=false`, a IA usa fallback neutro ("Falei com a equipe da {empresa} e me indicaram você…").

Envio: pelo mesmo canal do lead original quando possível (Gmail-send para email, ou registrar lead com `preferred_channel` para WhatsApp/telefone — Twilio só se já configurado).

### 5. UI mínima em `/leads` e `/conversations`

- Badge "Indicador" / "Indicado por X" no card do lead (usando `referral_source_lead_id` + join).
- Link clicável "Ver indicador" / "Ver indicado(s)" no `LeadDetail`.
- Filtro de status novo: "Aguardando encaminhamento" / "Encaminhado para decisor".

Sem dashboard novo nesta fase.

---

## Fase 2 — Refinamentos (depois de validar a Fase 1)

- Adaptação de tom por `referred_role` (técnico/RT, compras, marketing, comercial, dono) — substituir o prompt único por um seletor de "playbook" baseado no role detectado.
- Tarefa de ligação (`task_type='call'`) para subtype "me liga" quando integrarmos voz.
- Follow-up automático com indicador após 2 dias (cron via `expire-slot-holds`-style scheduler).
- Handoff humano automático para perguntas técnicas/regulatórias (já temos a flag `handoff_required` — só ligar).

---

## Detalhes técnicos

**Arquivos a alterar (Fase 1):**
- `supabase/migrations/<novo>.sql` — campos em `leads`, novos valores de status.
- `supabase/functions/inbound-webhook/index.ts` — adicionar bloco "DETECÇÃO DE INDICAÇÃO" no system prompt; tratar `action='referral'`; roteador de subtypes; criar lead/conversation/message; pausar enrollment.
- `supabase/functions/_shared/referral-outreach.ts` (novo) — helper que monta o `new_outreach_message` final (escolhe canal, monta subject, chama gmail-send).
- `src/components/LeadDetail.tsx` e `src/pages/Leads.tsx` — badges, link indicador↔indicado, filtro.
- `src/hooks/useLeads.ts` (se existir) — incluir o join.

**Fora do escopo desta fase:**
- Mensagem em grupo de WhatsApp (fluxo 12) — depende de integração de grupos no Twilio que não temos.
- Agente de voz para "me liga" (fluxo 13) — vira só uma tarefa registrada.
- Playbooks especializados por cargo (técnico/compras/marketing) — Fase 2.
- Anexar apresentação PDF em e-mail para compras — Fase 2.

**Risco/decisão pendente que preciso confirmar:**
- O lead indicado entra em qual **cadence** automaticamente? Opções: (a) nenhuma — só a 1ª mensagem manual e aguarda resposta; (b) reaproveitar a mesma cadência do indicador; (c) cadência específica "referral_outreach" a ser criada pelo usuário. **Minha recomendação: (a)** — a indicação já é forte sinal, mandar sequência automática queima o lead.

Posso seguir com a Fase 1 assim?
