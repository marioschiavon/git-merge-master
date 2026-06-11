import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { detectMeetingClarifier, meetingClarifierSubIntent, normalizePtText } from "../_shared/meeting-clarifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATEGORIES = [
  "interest", "info_request", "pricing", "scheduling", "rejection",
  "routing", "channel_switch", "compliance", "escalation", "silence",
];

const SUB_INTENT_HINTS = `
Sub-intents possíveis (escolha UM ou null):
- interest: greeting, interested, positive_but_unclear, asks_how_it_works
- info_request: asks_more_info, asks_material, asks_case_study, technical_question, clinical_question, regulatory_question, asks_contract, asks_proposal
- pricing: asks_price
- scheduling: wants_meeting, new_booking, asks_time_options, gives_time_preference, selected_time, asks_calendar_link, reschedule_request, cancel_request, cancel_meeting, abandoned_scheduling, no_show_response, timezone_question, event_type_question, confirms_attendance, asks_duration, asks_format, asks_attendees, asks_location, asks_objective
- rejection: not_interested, already_has_solution, bad_timing, no_time, no_fit, negative_but_polite
- routing: not_responsible, gatekeeper, wrong_person, wrong_company, referral_with_contact, referral_without_contact, will_forward, refuses_to_share_contact, asks_contact_source
- channel_switch: send_by_email, call_me
- compliance: opt_out, complaint, invalid_data
- escalation: enterprise_opportunity, human_needed, asks_subject
`;

const SYSTEM_PROMPT = `Você é um classificador de mensagens de prospects B2B em português brasileiro.
Dada a última mensagem do prospect e o histórico curto, classifique em UMA categoria (10 opções) e opcionalmente um sub-intent.

Para mensagens de scheduling, distinga claramente:
- new_booking: pessoa quer marcar PELA PRIMEIRA VEZ
- reschedule_request: pessoa JÁ TEM reunião marcada e quer mudar horário
- cancel_request: pessoa quer cancelar definitivamente
- no_show_response: pessoa responde após não comparecer
- timezone_question: dúvida sobre fuso horário
- event_type_question: pergunta sobre qual tipo de reunião
- asks_duration: pergunta quanto tempo dura a reunião ("quanto tempo é a reunião?", "quanto dura?", "vai demorar muito?")
- asks_format: pergunta se é online/presencial/vídeo/telefone
- asks_attendees: pergunta quem vai participar
- asks_location: pergunta o local/link da reunião
- asks_objective: pergunta qual o objetivo da reunião / o que vai ser tratado

IMPORTANTE: perguntas esclarecedoras sobre a reunião (duração, formato, quem participa, local, objetivo) NÃO são `asks_time_options`. Use o sub-intent específico (`asks_duration`, `asks_format`, ...).

Extraia entidades quando relevante: data/hora mencionada (ISO 8601 BRT-3 se possível), e-mail/nome/empresa referidos, motivo de cancelamento, fuso horário.

Categorias: ${CATEGORIES.join(", ")}

${SUB_INTENT_HINTS}

Sentimento: interesse | objeção | dúvida | rejeição | neutro

Responda APENAS JSON válido (sem markdown):
{
  "category": "<uma das 10>",
  "sub_intent": "<sub-intent ou null>",
  "sentiment": "<sentimento>",
  "confidence": <0.0 a 1.0>,
  "entities": {
    "datetime": null,
    "target_date": null,
    "target_time": null,
    "timezone": null,
    "cancel_reason": null,
    "referred_email": null,
    "referred_name": null,
    "referred_company": null
  },
  "reasoning": "<1 frase curta explicando>"
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json();
    const { company_id, lead_id, conversation_id, message_id, message_content, history = [] } = body;

    if (!company_id || !lead_id || !message_content) {
      return new Response(JSON.stringify({ error: "company_id, lead_id, message_content são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clarifierKind = detectMeetingClarifier(message_content);
    if (clarifierKind) {
      const parsed = {
        category: "info_request",
        sub_intent: meetingClarifierSubIntent(clarifierKind),
        sentiment: "dúvida",
        confidence: 1,
        entities: {},
        reasoning: `Pergunta esclarecedora sobre reunião detectada deterministicamente (${clarifierKind})`,
      };
      console.log(`MEETING_CLARIFIER_CLASSIFIER_BYPASS kind=${clarifierKind} norm="${normalizePtText(message_content)}"`);

      const { data: logRow, error: logErr } = await supabase
        .from("lead_intents_log")
        .insert({
          company_id,
          lead_id,
          conversation_id: conversation_id || null,
          message_id: message_id || null,
          category: parsed.category,
          sub_intent: parsed.sub_intent,
          sentiment: parsed.sentiment,
          confidence: parsed.confidence,
          entities: parsed.entities,
          message_excerpt: String(message_content).slice(0, 500),
          model_used: "deterministic:meeting-clarifier",
          latency_ms: 0,
          raw_response: parsed,
        })
        .select()
        .single();

      if (logErr) console.error("classify-intent clarifier log error:", logErr);

      return new Response(JSON.stringify({ ...parsed, intent_log_id: logRow?.id || null, latency_ms: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const historyText = (history as any[])
      .slice(-6)
      .map((m) => `[${m.direction === "outbound" ? "SDR" : "PROSPECT"}]: ${m.content}`)
      .join("\n");

    const userPrompt = `Histórico recente:
${historyText || "(sem histórico)"}

Última mensagem do prospect:
"""${message_content}"""

Classifique.`;

    const model = "google/gemini-2.5-flash";
    const t0 = Date.now();
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });
    const latency_ms = Date.now() - t0;

    if (!response.ok) {
      const status = response.status;
      await response.text();
      if (status === 429) return new Response(JSON.stringify({ error: "Limite de requisições excedido." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Erro ao classificar intent" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }

    if (!parsed || !CATEGORIES.includes(parsed.category)) {
      parsed = {
        category: "escalation",
        sub_intent: "human_needed",
        sentiment: "neutro",
        confidence: 0.0,
        entities: {},
        reasoning: "Falha ao classificar — encaminhar para humano",
      };
    }

    // Persist log
    const { data: logRow, error: logErr } = await supabase
      .from("lead_intents_log")
      .insert({
        company_id,
        lead_id,
        conversation_id: conversation_id || null,
        message_id: message_id || null,
        category: parsed.category,
        sub_intent: parsed.sub_intent || null,
        sentiment: parsed.sentiment || null,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        entities: parsed.entities || {},
        message_excerpt: String(message_content).slice(0, 500),
        model_used: model,
        latency_ms,
        raw_response: parsed,
      })
      .select()
      .single();

    if (logErr) console.error("classify-intent log error:", logErr);

    return new Response(JSON.stringify({ ...parsed, intent_log_id: logRow?.id || null, latency_ms }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("classify-intent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
