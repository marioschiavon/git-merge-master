import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";
import { routeAndEnqueue } from "../_shared/route-intent.ts";
import { extractDateRangeFromText } from "../_shared/date-range.ts";
import { insertBookingSystemMessage } from "../_shared/booking-messages.ts";
import { formatBRTLong } from "../_shared/datetime.ts";
import { getTwilioConfig, sendWhatsAppViaTwilio } from "../_shared/twilio-whatsapp.ts";
import { cancelCalcomBooking, cancelCalcomReservation } from "../_shared/calcom.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Convert local Brasília time (UTC-3) components to UTC ISO string.
 * "12h BRT" → "15h UTC" → "2026-04-15T15:00:00.000Z"
 */
const BRT_OFFSET_HOURS = 3;

function toBrtIso(year: number, month: number, day: number, hour: number, minute: number): string {
  const dt = new Date(Date.UTC(year, month, day, hour + BRT_OFFSET_HOURS, minute));
  return dt.toISOString();
}

/** Format a UTC ISO datetime string as a human-readable BRT string */
function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toEmailHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
}

function formatDateTimeBrt(isoString: string): string {
  return formatBRTLong(isoString);
}

/**
 * Fallback server-side datetime parser for Portuguese date expressions.
 * Returns ISO 8601 string or null. All times are interpreted as Brasília (UTC-3).
 */
function extractDateTimeFromText(text: string): string | null {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  // Current time in BRT for comparisons
  const nowBrt = new Date(now.getTime() - BRT_OFFSET_HOURS * 3600000);

  // Pattern: "dia DD às HH:MM" or "dia DD as HHh" or "dia DD as HH:MM"
  const diaMatch = text.match(/dia\s+(\d{1,2})\s+[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (diaMatch) {
    const day = parseInt(diaMatch[1]);
    const hour = parseInt(diaMatch[2]);
    const minute = parseInt(diaMatch[3] || "0");
    let month = currentMonth;
    if (day < nowBrt.getUTCDate() || (day === nowBrt.getUTCDate() && hour < nowBrt.getUTCHours())) {
      month += 1;
    }
    return toBrtIso(currentYear, month, day, hour, minute);
  }

  // Pattern: "DD/MM às HH:MM" or "DD/MM as HHh"
  const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})\s+[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]) - 1;
    const hour = parseInt(slashMatch[3]);
    const minute = parseInt(slashMatch[4] || "0");
    return toBrtIso(currentYear, month, day, hour, minute);
  }

  // Pattern: weekday + time, e.g. "terça às 14h", "segunda as 10:00"
  const weekdayMap: Record<string, number> = {
    domingo: 0, segunda: 1, terça: 2, terca: 2, quarta: 3,
    quinta: 4, sexta: 5, sábado: 6, sabado: 6,
  };
  const weekdayMatch = text.match(/(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)\s+[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (weekdayMatch) {
    const targetDay = weekdayMap[weekdayMatch[1].toLowerCase().replace("ç", "c").replace("á", "a")] ?? -1;
    const hour = parseInt(weekdayMatch[2]);
    const minute = parseInt(weekdayMatch[3] || "0");
    if (targetDay >= 0) {
      const todayBrt = nowBrt.getUTCDay();
      let diff = targetDay - todayBrt;
      if (diff <= 0) diff += 7;
      const targetDate = new Date(nowBrt);
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
      return toBrtIso(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), hour, minute);
    }
  }

  // Pattern: just time "às HHh" or "as HH:MM" (assume today or tomorrow in BRT)
  const timeOnly = text.match(/[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (timeOnly) {
    const hour = parseInt(timeOnly[1]);
    const minute = parseInt(timeOnly[2] || "0");
    let day = nowBrt.getUTCDate();
    let month = nowBrt.getUTCMonth();
    let year = nowBrt.getUTCFullYear();
    // If time already passed today in BRT, use tomorrow
    if (hour < nowBrt.getUTCHours() || (hour === nowBrt.getUTCHours() && minute <= nowBrt.getUTCMinutes())) {
      const tomorrow = new Date(nowBrt);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      day = tomorrow.getUTCDate();
      month = tomorrow.getUTCMonth();
      year = tomorrow.getUTCFullYear();
    }
    return toBrtIso(year, month, day, hour, minute);
  }

  return null;
}

// stripQuotedEmail imported from _shared/strip-quoted-email.ts

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Accept both Twilio webhook format and direct JSON
    let body: any;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      body = {
        from: formData.get("From"),
        content: formData.get("Body"),
        channel: "whatsapp",
      };
    } else {
      body = await req.json();
    }

    const { from, content, channel, conversation_id, lead_id, skip_insert } = body;

    if (!content) {
      return new Response(JSON.stringify({ error: "content é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find conversation
    let convId = conversation_id;
    let leadData: any = null;
    let companyId: string | null = null;
    let convChannel: string | null = channel || null;

    if (!convId && lead_id) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, company_id, channel, leads(id, name, email, company_name, phone, whatsapp, pending_email_slot_hold_id)")
        .eq("lead_id", lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (conv) {
        convId = conv.id;
        companyId = conv.company_id;
        convChannel = conv.channel;
        leadData = (conv as any).leads;
      }
    } else if (convId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, company_id, channel, leads(id, name, email, company_name, phone, whatsapp, pending_email_slot_hold_id)")
        .eq("id", convId)
        .maybeSingle();
      if (conv) {
        companyId = conv.company_id;
        convChannel = conv.channel;
        leadData = (conv as any).leads;
      }
    }

    if (!convId) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FIX: Strip quoted email content before saving
    const cleanContent = stripQuotedEmail(content);
    console.log("Original content length:", content.length, "Clean content length:", cleanContent.length, "skip_insert:", !!skip_insert);

    // Save inbound message (with clean content) — pulado quando a mensagem já foi inserida pelo caller (ex: gmail-sync-inbox)
    if (!skip_insert) {
      await supabase.from("messages").insert({
        conversation_id: convId,
        content: cleanContent,
        direction: "inbound",
        ai_suggested: false,
      });
    }

    // FIX: Read enrollment state BEFORE overwriting paused_reason
    let originalPausedReason: string | null = null;
    let enrollmentId: string | null = null;
    if (convId) {
      const { data: convData } = await supabase
        .from("conversations")
        .select("cadence_enrollment_id")
        .eq("id", convId)
        .maybeSingle();

      if (convData?.cadence_enrollment_id) {
        enrollmentId = convData.cadence_enrollment_id;
        // Read current paused_reason BEFORE updating
        const { data: enrollState } = await supabase
          .from("cadence_enrollments")
          .select("paused_reason")
          .eq("id", enrollmentId)
          .maybeSingle();
        originalPausedReason = enrollState?.paused_reason || null;

        // FIX: Only set lead_replied if NOT in scheduling flow
        if (originalPausedReason !== "awaiting_slot_confirmation") {
          await supabase
            .from("cadence_enrollments")
            .update({ status: "paused", paused_reason: "lead_replied" } as any)
            .eq("id", enrollmentId)
            .in("status", ["active", "completed"]);
        }
      }
    }

    // Log inbound activity
    if (companyId && leadData?.id) {
      const channelLabel = convChannel || channel || "email";
      const channelEmoji = channelLabel === "whatsapp" ? "📱" : channelLabel === "linkedin" ? "💼" : "📧";
      await supabase.from("lead_activities").insert({
        company_id: companyId,
        lead_id: leadData.id,
        type: channelLabel === "multi_channel" ? "email" : channelLabel,
        description: `${channelEmoji} Resposta recebida: ${cleanContent.substring(0, 150)}`,
        metadata: { direction: "inbound", channel: channelLabel },
      });
    }

    // Lead responded — pause any pending slot-expiry follow-up progression
    if (companyId && leadData?.id) {
      await supabase
        .from("slot_expiry_followups")
        .update({ next_action_at: null, metadata: { resolved_by: "lead_reply", resolved_at: new Date().toISOString() } })
        .eq("lead_id", leadData.id)
        .neq("stage", "no_response");
    }


    // Classify intent + route side-effect actions (does not duplicate reply — legacy flow below handles that)
    if (companyId && leadData?.id) {
      try {
        // Build brief history for classifier
        const { data: recentMsgs } = await supabase
          .from("messages")
          .select("direction, content")
          .eq("conversation_id", convId)
          .order("sent_at", { ascending: false })
          .limit(6);
        const history = (recentMsgs || []).reverse();

        const { data: clf, error: clfErr } = await supabase.functions.invoke("classify-intent", {
          body: {
            company_id: companyId,
            lead_id: leadData.id,
            conversation_id: convId,
            message_content: cleanContent,
            history,
          },
        });

        if (!clfErr && clf?.intent_log_id && clf?.category) {
          const route = await routeAndEnqueue(supabase, {
            company_id: companyId,
            lead_id: leadData.id,
            conversation_id: convId,
            intent_log_id: clf.intent_log_id,
            category: clf.category,
            sub_intent: clf.sub_intent || null,
            confidence: Number(clf.confidence) || 0,
          }, { include_reply_actions: false });
          console.log("intent routed:", clf.category, clf.sub_intent, "→", route);
        } else if (clfErr) {
          console.error("classify-intent error:", clfErr);
        }
      } catch (e) {
        console.error("intent pipeline error:", e);
      }
    }

    // Check for held slots (FIX: filter out expired slots)
    let heldSlots: any[] = [];
    if (leadData?.id) {
      const { data: slots } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime, cal_booking_uid, status")
        .eq("lead_id", leadData.id)
        .eq("status", "held")
        .gt("expires_at", new Date().toISOString())
        .order("slot_datetime", { ascending: true });
      heldSlots = slots || [];
    }

    // Find active/paused enrollment for this lead
    const { data: enrollment } = await supabase
      .from("cadence_enrollments")
      .select("id, cadence_id, paused_reason")
      .eq("lead_id", leadData?.id)
      .in("status", ["active", "paused"])
      .maybeSingle();

    // FIX: Detect scheduling in progress via preserved original state OR current enrollment
    let schedulingInProgress = false;
    if (originalPausedReason === "awaiting_slot_confirmation" || enrollment?.paused_reason === "awaiting_slot_confirmation") {
      schedulingInProgress = true;
      console.log("Scheduling in progress detected (paused_reason was awaiting_slot_confirmation)");
    }

    // FIX: Check last outbound message for schedule loop guard
    let lastOutboundWasSchedule = false;
    let lastOfferedSlots: string[] = [];
    {
      const { data: lastOutbound } = await supabase
        .from("messages")
        .select("metadata")
        .eq("conversation_id", convId)
        .eq("direction", "outbound")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastOutbound?.metadata) {
        const meta = lastOutbound.metadata as any;
        if (meta.action === "schedule" || meta.action === "reject_slots") {
          lastOutboundWasSchedule = true;
          schedulingInProgress = true;
          console.log("Last outbound was schedule/reject_slots — forcing scheduling context");
        }
        if (meta.offered_slots) {
          lastOfferedSlots = meta.offered_slots;
        }
      }
    }

    // Format slot context for AI
    let slotContext = "";
    if (heldSlots.length >= 2) {
      const formatted = heldSlots.map((s: any, i: number) => {
        const dt = new Date(s.slot_datetime);
        return `${i + 1}) ${dt.toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })} às ${dt.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      });
      slotContext = `\n\nATENÇÃO: O prospect recebeu 2 opções de horário para reunião:
${formatted.join("\n")}

INSTRUÇÕES PARA SLOTS PENDENTES:
- Se o prospect está confirmando ou escolhendo um desses horários → action = "confirm_slot" e selected_slot = número da opção (1 ou 2)
- Se o prospect rejeitou ambos os horários (ex: "nenhum funciona", "não consigo nesses dias", "tenho compromisso") → action = "reject_slots"
- Se o prospect sugeriu um horário alternativo (ex: "pode ser terça às 14h?", "prefiro quinta de manhã") → action = "check_availability" e inclua "suggested_datetime" no formato ISO 8601 (YYYY-MM-DDTHH:mm:ss)`;
    } else if (heldSlots.length === 1) {
      const dt = new Date(heldSlots[0].slot_datetime);
      const formatted = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })
        + " às " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      slotContext = `\n\nATENÇÃO: O prospect recebeu 1 opção de horário para reunião:
1) ${formatted}

INSTRUÇÕES PARA SLOT PENDENTE:
- Se o prospect está confirmando esse horário → action = "confirm_slot" e selected_slot = 1
- Se o prospect rejeitou o horário → action = "reject_slots"
- Se o prospect sugeriu um horário alternativo → action = "check_availability" e inclua "suggested_datetime" no formato ISO 8601`;
    } else if (schedulingInProgress) {
      // FIX: Even without active slots, give context that scheduling is happening
      let offeredSlotsContext = "";
      if (lastOfferedSlots.length > 0) {
        offeredSlotsContext = `\nHorários anteriormente oferecidos (já expiraram): ${lastOfferedSlots.map((s: string) => {
          const dt = new Date(s);
          return dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) +
            " às " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        }).join(", ")}`;
      }
      slotContext = `\n\nATENÇÃO: Há um processo de agendamento em andamento com este prospect (os horários anteriores já expiraram).${offeredSlotsContext}
Se o prospect mencionar qualquer horário, dia ou disponibilidade → action = "check_availability" com suggested_datetime em ISO 8601 (YYYY-MM-DDTHH:mm:ss).
Se o prospect confirmar um dos horários anteriores → action = "check_availability" com o datetime correspondente.
Se o prospect rejeitar completamente a ideia de reunião → action = "pause".
NÃO use action = "schedule" pois já estamos em processo de agendamento.`;
    }

    // Get conversation history
    const { data: messages } = await supabase
      .from("messages")
      .select("direction, content")
      .eq("conversation_id", convId)
      .order("sent_at", { ascending: true })
      .limit(20);

    // Load company knowledge base (single source of truth — prevents AI hallucination)
    let knowledgeContext = "";
    let highlightsContext = "";
    let aiInstructionsContext = "";
    if (companyId) {
      const [knowledgeRes, highlightsRes, aiInstructionsRes] = await Promise.all([
        supabase.from("company_knowledge").select("title, content").eq("company_id", companyId).not("type", "in", "(highlights,ai_instructions)").limit(10),
        supabase.from("company_knowledge").select("content").eq("company_id", companyId).eq("type", "highlights").maybeSingle(),
        supabase.from("company_knowledge").select("content").eq("company_id", companyId).eq("type", "ai_instructions").maybeSingle(),
      ]);
      knowledgeContext = (knowledgeRes.data || []).map((k: any) => `## ${k.title}\n${k.content}`).join("\n\n");
      highlightsContext = highlightsRes.data?.content || "";
      aiInstructionsContext = aiInstructionsRes.data?.content || "";
    }

    // Pre-fetch confirmed booking for this lead (used by prompt + double-booking guard)
    let confirmedSlotForPrompt: { id: string; slot_datetime: string } | null = null;
    if (leadData?.id) {
      const { data: cs } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime")
        .eq("lead_id", leadData.id)
        .eq("status", "confirmed")
        .order("slot_datetime", { ascending: false })
        .limit(1);
      if (cs?.length) confirmedSlotForPrompt = cs[0] as any;
    }
    const confirmedBookingBlock = confirmedSlotForPrompt
      ? `\n=== REUNIÃO ATUALMENTE CONFIRMADA ===\n${formatDateTimeBrt(confirmedSlotForPrompt.slot_datetime)}\n→ Se o prospect pedir para TROCAR/ALTERAR/MOVER/REMARCAR esse horário (com ou sem nova data), use action = "reschedule" e preencha "suggested_datetime" se ele indicou um novo horário.\n→ NUNCA use "check_availability" quando já existe reunião confirmada — sempre use "reschedule".\n→ Se ele quiser CANCELAR sem remarcar, use "cancel".\n=====================================\n`
      : "";

    const hasKnowledge = !!(knowledgeContext || highlightsContext);
    const knowledgeBlock = hasKnowledge
      ? `=== BASE DE CONHECIMENTO DA EMPRESA (ÚNICA FONTE DA VERDADE) ===
${highlightsContext ? `DIFERENCIAIS APROVADOS:\n${highlightsContext}\n\n` : ""}${knowledgeContext ? `INFORMAÇÕES DA EMPRESA/PRODUTO:\n${knowledgeContext}\n\n` : ""}${aiInstructionsContext ? `INSTRUÇÕES DE ABORDAGEM (PRIORIDADE MÁXIMA):\n${aiInstructionsContext}\n` : ""}================================================================

REGRAS ANTI-ALUCINAÇÃO (sobrepõem qualquer outra instrução):
- Use APENAS fatos, features, números, integrações, casos e nomes presentes na BASE acima.
- É TERMINANTEMENTE PROIBIDO inventar produto, funcionalidade, métrica, painel, integração, caso de cliente ou qualquer informação que não esteja na BASE.
- Se o prospect perguntar algo que não está na BASE → responda honestamente ("vou confirmar com o time e te retorno na reunião") e puxe para agendar. NUNCA preencha a lacuna com suposição.
- Se as INSTRUÇÕES DE ABORDAGEM disserem que o prospect não tem fit, NÃO force gancho — seja honesto.
`
      : `=== BASE DE CONHECIMENTO DA EMPRESA ===
(vazia — empresa ainda não cadastrou informações)
========================================

REGRAS ANTI-ALUCINAÇÃO:
- Como a base está vazia, NÃO mencione features, produtos, métricas, integrações ou nomes específicos.
- Mantenha a resposta neutra, focada em qualificar o prospect e agendar reunião para apresentação detalhada.
- NUNCA invente o que a empresa faz ou vende.
`;

    // Analyze with AI
    const systemPrompt = `${knowledgeBlock}${confirmedBookingBlock}

Você é um SDR autônomo de vendas B2B. Analise a resposta do prospect e decida a ação.


OBJETIVO PRINCIPAL: Seu objetivo FINAL é sempre agendar uma reunião com o prospect. Todas as interações devem caminhar para isso. Se o prospect demonstra QUALQUER interesse, direcione para agendamento (action = "schedule"). Se ele sugere um horário, use action = "check_availability".

AÇÕES POSSÍVEIS:
- "reply": responder automaticamente (objeção, dúvida, neutro)
- "schedule": prospect demonstrou interesse em reunião → parar cadência e confirmar horário
- "confirm_slot": prospect está confirmando/escolhendo um dos horários já oferecidos
- "request_email": acionado AUTOMATICAMENTE pelo sistema quando confirm_slot é detectado mas o lead não tem e-mail cadastrado (não escolha esta ação diretamente — apenas use confirm_slot e o sistema redireciona)
- "reject_slots": prospect rejeitou ambos os horários oferecidos (ex: "nenhum funciona", "tenho compromisso nesses dias")
- "check_availability": prospect sugeriu um horário alternativo próprio (ex: "pode ser terça às 14h?")
  → inclua "suggested_datetime" no formato ISO 8601 (YYYY-MM-DDTHH:mm:ss)
- "reschedule": prospect quer remarcar/reagendar uma reunião JÁ CONFIRMADA anteriormente (ex: "preciso remarcar", "surgiu um imprevisto", "mudar a reunião", "trocar o horário"). NÃO use "reschedule" se não houver reunião confirmada — nesse caso use "check_availability".
  → se o prospect já indicou novo horário, inclua "suggested_datetime" no formato ISO 8601
- "cancel": prospect quer CANCELAR uma reunião já confirmada SEM remarcar (ex: "não vou poder", "preciso cancelar a reunião", "vamos cancelar", "não tenho mais interesse na reunião"). NÃO usar para rejeição geral do produto (use "pause").
- "pause": prospect rejeitou totalmente a abordagem/produto → pausar cadência E enviar mensagem curta de agradecimento + porta aberta para retorno futuro
- "referral": prospect indicou outra pessoa, disse que não é responsável, vai encaminhar internamente, ou é um gatekeeper (recepção/atendimento)
- "request_call": prospect pediu para ser contatado por TELEFONE/LIGAÇÃO ("me liga", "prefiro por telefone", "pode me ligar amanhã às 10h") → criar tarefa de ligação para o time humano. Inclua "call_window" (frase curta com horário/data preferida, se informada) e "call_phone" (telefone, se informado ou já presente no lead).
- "handoff": prospect fez pergunta TÉCNICA, REGULATÓRIA, JURÍDICA, CLÍNICA ou COMERCIAL ESPECÍFICA que NÃO está na BASE DE CONHECIMENTO e exige especialista humano (ex: dosagem, posologia, contrato, NF-e, certificações ANVISA/MAPA, condições especiais de pagamento, integrações customizadas) → passar para humano. NÃO invente resposta. Use reply_message curto avisando que um especialista vai retornar.

CAPTURA DE E-MAIL (para confirmar reunião por convite):
- Se a última mensagem do prospect contém um e-mail válido (formato algo@dominio.tld) E há contexto de agendamento (slots pendentes OU pedido recente de e-mail) → preencha "provided_email" com o endereço informado.
- Se o prospect disser explicitamente que NÃO tem e-mail / não quer informar / prefere sem convite → preencha "email_refused": true.
- Caso contrário, "provided_email": null e "email_refused": false.


DETECÇÃO DE INDICAÇÃO / ENCAMINHAMENTO (action = "referral"):
Use quando o prospect:
- diz que outra pessoa é responsável ("fala com X", "quem cuida disso é Y", "isso é com o marketing/compras/comercial/dono/RT")
- vai encaminhar internamente ("vou encaminhar", "vou repassar", "vou mandar pro grupo")
- diz que não é a pessoa certa ("não sou eu", "não cuido disso", "não posso passar contato")
- é claramente recepção/atendimento respondendo em nome da empresa
Subtypes (referral.subtype):
- "with_contact": indicou e passou nome E (email OU telefone) do decisor → o sistema vai criar novo lead
- "without_contact": indicou alguém mas não passou contato → pedir WhatsApp/e-mail
- "will_forward": vai encaminhar internamente → enviar texto curto e encaminhável
- "wrong_person": disse que não é responsável (sem indicar quem é) → perguntar quem é
- "gatekeeper": recepcionista/atendente → pedir direcionamento ao responsável, NÃO vender
- "refuses_contact": recusou passar contato → oferecer texto encaminhável e encerrar

REGRAS DE INDICAÇÃO (obrigatórias):
- NUNCA insistir em vender para quem disse que não é o responsável.
- Sempre pedir permissão para citar quem indicou (se ainda não autorizou explicitamente).
- Mensagens curtas, sem pressão, agradecendo a ajuda.
- Para "with_contact": no campo new_outreach_message gere a 1ª abordagem para o lead indicado, contextualizando a indicação (use o nome de quem indicou se permission_to_mention=true, caso contrário use frase neutra "Falei com a equipe da {empresa} e me indicaram você"). Use a BASE DE CONHECIMENTO para a tagline da empresa. Termine com pergunta leve sobre disponibilidade para conversa rápida. NUNCA inclua dia/hora.

PLAYBOOKS POR CARGO (adapte o tom da new_outreach_message e de qualquer reply ao indicado de acordo com referred_role):
- "tecnico" | "responsavel_tecnico" | "veterinario" | "rt" | "farmaceutico" → tom técnico, focar em conformidade, eficácia, evidências, estudos, fichas técnicas. Evitar argumentos comerciais agressivos.
- "compras" | "suprimentos" | "procurement" → focar em condições comerciais, prazo de entrega, MOQ, oferecer apresentação/catálogo. Tom direto e objetivo.
- "marketing" | "trade" → focar em posicionamento, cases, co-marketing, geração de demanda. Tom criativo.
- "comercial" | "vendas" | "sales" → focar em parceria, comissionamento, volume, ticket médio. Tom de igual para igual.
- "socio" | "dono" | "ceo" | "diretor" | "founder" → focar em ROI, visão estratégica, tempo curto (1 frase + CTA). Tom executivo.
- desconhecido/null → tom neutro consultivo padrão.
Use o campo "playbook" (string) na saída JSON para registrar qual playbook aplicou ("tecnico"|"compras"|"marketing"|"comercial"|"socio"|"neutro").

REGRAS:
- REGRA CRÍTICA: NUNCA sugira horários específicos (dia/hora) no reply_message. Se o prospect quer agendar reunião, use action = "schedule" para que o sistema busque horários reais no calendário. O reply_message NUNCA deve conter dias da semana ou horários.
- Se o prospect menciona "reunião", "agendar", "conversar", "demo", "horário" E NÃO há slots pendentes → action = "schedule"
- Se há slots pendentes e o prospect está escolhendo um deles → action = "confirm_slot" com selected_slot = 1 ou 2
- Se há slots pendentes e o prospect recusou ambos → action = "reject_slots"
- Se há slots pendentes e o prospect sugeriu outro horário → action = "check_availability" com suggested_datetime
- Se o prospect diz "não tenho interesse", "não quero", "remova", "pare" → action = "pause" (reply_message OBRIGATÓRIO: agradecer a sinceridade, dizer que vai pausar o contato, deixar porta aberta para retorno futuro — sem insistir, sem CTA de venda, sem perguntas)
- Se objeção (preço, timing, concorrente) → contorne com empatia + prova social
- Se dúvida que ESTÁ na BASE → responda objetivamente + CTA para reunião
- Se dúvida técnica/regulatória que NÃO está na BASE → action = "handoff" (NÃO invente).
- Mensagens curtas e naturais

Responda APENAS com JSON:
{
  "action": "reply|schedule|confirm_slot|reject_slots|check_availability|reschedule|cancel|pause|referral|request_call|handoff",
  "sentiment": "interesse|objeção|dúvida|rejeição|neutro",
  "selected_slot": null,
  "suggested_datetime": null,
  "reasoning": "explicação breve",
  "used_facts": ["lista de trechos da BASE DE CONHECIMENTO que embasaram a resposta (vazio se não usou nada da base)"],
  "playbook": "tecnico|compras|marketing|comercial|socio|neutro",
  "handoff_reason": "motivo do handoff (apenas quando action=handoff, senão null)",
  "call_window": "janela preferida pelo prospect (apenas quando action=request_call, senão null)",
  "call_phone": "telefone informado (apenas quando action=request_call, senão null)",
  "referral": {
    "subtype": "with_contact|without_contact|will_forward|wrong_person|gatekeeper|refuses_contact",
    "referred_name": null,
    "referred_role": null,
    "referred_email": null,
    "referred_phone": null,
    "referred_channel": null,
    "permission_to_mention": null,
    "context": null
  },
  "new_outreach_message": "1ª mensagem para o lead indicado (apenas quando referral.subtype = with_contact, senão null)",
  "provided_email": null,
  "email_refused": false,
  "reply_message": "mensagem para enviar ao prospect (obrigatória inclusive em action=pause — agradecimento curto + porta aberta). Após confirmar reunião (confirm_slot), gere mensagem CURTA e CORDIAL (1-2 frases), confirmando data/hora, sem floreios nem promessas — para não atrapalhar o prospect."
}${slotContext}`;


    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Lead: ${leadData?.name || "N/A"} (${leadData?.company_name || "N/A"})

Histórico:
${(messages || []).slice(0, -1).map((m: any) => `[${m.direction === "outbound" ? "SDR" : "PROSPECT"}]: ${m.content}`).join("\n")}

ÚLTIMA MENSAGEM DO PROSPECT (analise com atenção):
"${cleanContent}"

Analise a última mensagem e decida a ação.`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      await aiRes.text();
      return new Response(JSON.stringify({ error: "Erro na análise IA" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiContent];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      parsed = { action: "reply", sentiment: "neutro", reasoning: "Fallback", reply_message: null, selected_slot: null };
    }

    // FIX: Compensate AI-provided suggested_datetime from naive BRT to UTC
    if (parsed.suggested_datetime && !parsed.suggested_datetime.endsWith("Z")) {
      const naive = new Date(parsed.suggested_datetime);
      if (!isNaN(naive.getTime())) {
        const utc = new Date(naive.getTime() + BRT_OFFSET_HOURS * 3600000);
        parsed.suggested_datetime = utc.toISOString();
        console.log("Compensated AI suggested_datetime to UTC:", parsed.suggested_datetime);
      }
    }

    // FIX: Guard — if reply contains time patterns, redirect to schedule
    if (parsed.action === "reply" && parsed.reply_message) {
      const hasTimePattern = /\b(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\s+(à|a)s?\s+\d{1,2}/i.test(parsed.reply_message)
        || /📅/.test(parsed.reply_message)
        || /\b\d{1,2}\/\d{1,2}\s+(à|a)s?\s+\d{1,2}/i.test(parsed.reply_message);
      if (hasTimePattern) {
        console.log("Reply contains time suggestions — redirecting to schedule");
        parsed.action = "schedule";
        parsed.reply_message = null;
      }
    }

    // FIX: Guard on INBOUND content — if prospect has scheduling intent but AI said "reply"
    if (parsed.action === "reply") {
      const lower = cleanContent.toLowerCase();
      const hasScheduleIntent = /\b(agendar|reunião|reuniao|demo|conversar|call|meeting|bate-?papo)\b/i.test(lower);
      const extractedDt = extractDateTimeFromText(cleanContent);

      if (hasScheduleIntent && extractedDt) {
        console.log("Inbound has scheduling intent + datetime — redirecting to check_availability");
        parsed.action = "check_availability";
        parsed.suggested_datetime = extractedDt;
        parsed.reply_message = null;
      } else if (hasScheduleIntent) {
        console.log("Inbound has scheduling intent without specific time — redirecting to schedule");
        parsed.action = "schedule";
        parsed.reply_message = null;
      } else if (extractedDt) {
        console.log("Inbound mentions datetime without keyword — redirecting to check_availability");
        parsed.action = "check_availability";
        parsed.suggested_datetime = extractedDt;
        parsed.reply_message = null;
      }
    }

    // FIX: If AI says "schedule" but scheduling is already in progress, redirect to check_availability
    if (parsed.action === "schedule" && schedulingInProgress) {
      console.log("Schedule requested but scheduling already in progress — redirecting to check_availability");
      parsed.action = "check_availability";
      // Try to extract datetime from original message
      if (!parsed.suggested_datetime) {
        parsed.suggested_datetime = extractDateTimeFromText(cleanContent);
        console.log("Extracted datetime from text:", parsed.suggested_datetime);
      }
    }

    // FIX: Fallback datetime extraction for check_availability when AI didn't provide it
    if (parsed.action === "check_availability" && !parsed.suggested_datetime) {
      const extracted = extractDateTimeFromText(content);
      if (extracted) {
        console.log("AI didn't provide suggested_datetime, extracted from text:", extracted);
        parsed.suggested_datetime = extracted;
      } else {
        console.log("check_availability but no datetime could be extracted — falling back to reply asking for specific time");
        parsed.action = "reply";
        parsed.reply_message = "Poderia me dizer o dia e horário exato de sua preferência? Assim consigo verificar a disponibilidade.";
      }
    }

    // Fallback: if AI says confirm_slot but no held slots exist, reclassify as reply
    if (parsed.action === "confirm_slot" && heldSlots.length < 2) {
      console.log("confirm_slot requested but no held slots found — falling back to check_availability or reply");
      // If scheduling is in progress and there's a datetime, try check_availability
      if (schedulingInProgress) {
        parsed.action = "check_availability";
        if (!parsed.suggested_datetime) {
          parsed.suggested_datetime = extractDateTimeFromText(content);
        }
        if (!parsed.suggested_datetime) {
          parsed.action = "reply";
          parsed.reply_message = "Os horários anteriores expiraram. Poderia me dizer sua disponibilidade para que eu verifique novos horários?";
        }
      } else {
        parsed.action = "reply";
        if (!parsed.reply_message) {
          parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
        }
      }
    }

    // Fallback: if AI says reject_slots but no held slots
    if (parsed.action === "reject_slots" && heldSlots.length === 0) {
      if (schedulingInProgress) {
        // Treat as wanting new slots
        console.log("reject_slots with no active slots but scheduling in progress — fetching new slots");
      } else {
        console.log(`reject_slots requested but no held slots found — falling back to reply`);
        parsed.action = "reply";
        if (!parsed.reply_message) {
          parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
        }
      }
    }

    // Ensure reply_message is never null for action=reply
    if (parsed.action === "reply" && !parsed.reply_message) {
      parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
    }

    // Guard: prevent double-booking — if lead already has a confirmed slot, handle scheduling actions carefully
    if (leadData?.id && ["schedule", "check_availability", "confirm_slot"].includes(parsed.action)) {
      const confirmedSlots = confirmedSlotForPrompt ? [confirmedSlotForPrompt] : [];

      if (confirmedSlots.length) {
        // If the prospect proposed a new datetime, treat as reschedule instead of bouncing
        if (parsed.action === "check_availability" && parsed.suggested_datetime) {
          console.log(`Guard: converting check_availability → reschedule (existing booking + suggested_datetime=${parsed.suggested_datetime})`);
          parsed.action = "reschedule";
        } else {
          const formatted = formatDateTimeBrt(confirmedSlots[0].slot_datetime);
          console.log(`Double-booking guard: lead already has confirmed slot at ${confirmedSlots[0].slot_datetime}`);
          parsed.action = "reply";
          parsed.reply_message = `Já temos uma reunião confirmada para ${formatted}! Caso precise reagendar, é só me avisar.`;
        }
      }
    }


    // Execute action based on AI decision
    if (parsed.action === "confirm_slot" && heldSlots.length >= 1) {
      const slotIndex = (parsed.selected_slot || 1) - 1;
      const selectedHold = heldSlots[Math.min(slotIndex, heldSlots.length - 1)];

      // If lead provided an email in this message, persist it before confirming
      const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
      const providedEmail: string | null =
        (typeof parsed.provided_email === "string" && emailRegex.test(parsed.provided_email))
          ? parsed.provided_email.trim()
          : (emailRegex.exec(cleanContent)?.[0] || null);

      if (providedEmail && !leadData?.email) {
        await supabase.from("leads").update({ email: providedEmail }).eq("id", leadData.id);
        leadData.email = providedEmail;
        console.log(`Lead email captured from conversation: ${providedEmail}`);
      }

      const emailRefused = !!parsed.email_refused;

      // If still no email AND lead didn't refuse → ask for email instead of confirming
      if (!leadData?.email && !emailRefused) {
        console.log("No email available — asking lead before confirming booking");
        await supabase
          .from("leads")
          .update({ pending_email_slot_hold_id: selectedHold.id })
          .eq("id", leadData.id);
        parsed.action = "reply";
        parsed.reply_message = parsed.reply_message ||
          "Perfeito! Para eu te enviar o convite com o link da reunião, qual o seu melhor e-mail?";
      } else {
        console.log(`Confirming slot ${parsed.selected_slot}: ${selectedHold.slot_datetime} (placeholder=${!leadData?.email})`);
        try {
          const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
            body: {
              lead_id: leadData.id,
              selected_slot_hold_id: selectedHold.id,
              force_placeholder: !leadData?.email && emailRefused,
            },
          });

          if (confirmRes.data?.success) {
            console.log("Booking confirmed successfully");
            const formattedDate = formatDateTimeBrt(selectedHold.slot_datetime);
            if (!parsed.reply_message) {
              parsed.reply_message = `Combinado! Reunião marcada para ${formattedDate}. Até lá!`;
            }
          } else {
            console.error("Failed to confirm booking:", confirmRes.data?.error);
            parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
          }
        } catch (e) {
          console.error("Error invoking calcom-confirm-booking:", e);
          parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
        }
      }
    } else if (parsed.action === "reject_slots") {
      // Cancel all held slots and offer new ones
      console.log(`Rejecting ${heldSlots.length} held slots for lead ${leadData?.id}`);
      const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");

      for (const slot of heldSlots) {
        if (slot.cal_booking_uid && CALCOM_API_KEY) {
          try {
            await fetch(`https://api.cal.com/v2/slots/reservations/${slot.cal_booking_uid}`, {
              method: "DELETE",
              headers: {
                "Authorization": `Bearer ${CALCOM_API_KEY}`,
                "cal-api-version": "2024-09-04",
              },
            });
          } catch (e) {
            console.error("Error cancelling reservation:", e);
          }
        }
        await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", slot.id);
      }

      // Collect previously offered datetimes to exclude from new selection
      const excludeDatetimes = [
        ...heldSlots.map((s: any) => s.slot_datetime),
        ...lastOfferedSlots,
      ];
      console.log("Excluding previously offered datetimes:", excludeDatetimes);

      // Fetch 2 new slots (excluding rejected ones)
      try {
        const channelLabel = convChannel || channel || "email";
        const slotsRes = await supabase.functions.invoke("calcom-slots", {
          body: {
            company_id: companyId,
            lead_id: leadData?.id,
            enrollment_id: enrollment?.id,
            conversation_id: convId,
            preferred_channel: channelLabel,
            exclude_datetimes: excludeDatetimes,
          },
        });

        if (slotsRes.data?.success && slotsRes.data?.formatted?.length >= 2) {
          // FIX: Update heldSlots to reflect the NEW slots (for metadata)
          if (slotsRes.data?.slots) {
            heldSlots = slotsRes.data.slots;
          }
          parsed.reply_message = `Sem problemas! Aqui vão outras opções:\n\n📅 ${slotsRes.data.formatted[0]}\n📅 ${slotsRes.data.formatted[1]}\n\nAlgum desses funciona para você?`;
        } else {
          const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
          parsed.reply_message = CALCOM_BOOKING_LINK
            ? `Entendo! Acesse ${CALCOM_BOOKING_LINK} para escolher o horário que melhor funciona para você.`
            : "Entendo! Me diga qual horário seria melhor para você que eu verifico a disponibilidade.";
        }
      } catch (e) {
        console.error("Error fetching new slots:", e);
        parsed.reply_message = "Entendo! Me diga qual horário seria melhor para você que eu verifico a disponibilidade.";
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "🔄 Prospect rejeitou horários, novos slots oferecidos",
          metadata: { action: "reject_slots", sentiment: parsed.sentiment },
        });
      }
    } else if (parsed.action === "reschedule") {
      // Reschedule: cancel existing booking + held slots, then offer new ones
      console.log(`Reschedule requested for lead ${leadData?.id}`);
      const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");

      // 1) Cancel any held or confirmed slots in slot_holds
      const { data: liveSlots } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime, cal_booking_uid, status")
        .eq("lead_id", leadData.id)
        .in("status", ["held", "confirmed"]);

      let cancelledBookingUid: string | null = null;
      let cancelledScheduledAt: string | null = null;
      for (const slot of (liveSlots || [])) {
        if (slot.cal_booking_uid && CALCOM_API_KEY) {
          const endpoint = slot.status === "confirmed"
            ? `https://api.cal.com/v2/bookings/${slot.cal_booking_uid}/cancel`
            : `https://api.cal.com/v2/slots/reservations/${slot.cal_booking_uid}`;
          const apiVersion = slot.status === "confirmed" ? "2024-04-15" : "2024-09-04";
          try {
            await fetch(endpoint, {
              method: "DELETE",
              headers: { "Authorization": `Bearer ${CALCOM_API_KEY}`, "cal-api-version": apiVersion },
            });
          } catch (e) {
            console.error("Error cancelling Cal.com entry:", e);
          }
          if (slot.status === "confirmed") {
            cancelledBookingUid = slot.cal_booking_uid;
            cancelledScheduledAt = slot.slot_datetime;
          }
        }
        await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", slot.id);
      }

      // 2) Update bookings row immediately so UI reflects the change (don't wait for webhook)
      const { data: activeBookings } = await supabase
        .from("bookings")
        .select("id, calcom_booking_uid, scheduled_at, status")
        .eq("lead_id", leadData.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      for (const b of (activeBookings || [])) {
        if (CALCOM_API_KEY && b.calcom_booking_uid && b.calcom_booking_uid !== cancelledBookingUid) {
          // Cancel orphan Cal.com booking that wasn't tied to a slot_hold row
          try {
            await fetch(`https://api.cal.com/v2/bookings/${b.calcom_booking_uid}/cancel`, {
              method: "DELETE",
              headers: { "Authorization": `Bearer ${CALCOM_API_KEY}`, "cal-api-version": "2024-04-15" },
            });
          } catch (e) {
            console.error("Error cancelling orphan booking:", e);
          }
        }
        await supabase.from("bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", b.id);
        cancelledBookingUid = cancelledBookingUid || b.calcom_booking_uid;
        cancelledScheduledAt = cancelledScheduledAt || b.scheduled_at;
      }

      // 3) System message in the conversation — only when a CONFIRMED booking was actually cancelled.
      // Prospects that simply suggest a new time without a prior confirmed booking shouldn't trigger
      // a "Reunião remarcada" system entry.
      if (companyId && leadData && (cancelledBookingUid || cancelledScheduledAt)) {
        await insertBookingSystemMessage(supabase, {
          lead_id: leadData.id,
          company_id: companyId,
          event_type: "booking_rescheduled",
          booking_uid: cancelledBookingUid,
          previous_scheduled_at: cancelledScheduledAt,
        });
      }

      // 4) Reset enrollment
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ meeting_scheduled: false, status: "paused", paused_reason: "awaiting_slot_confirmation" } as any)
          .eq("id", enrollment.id);
      } else if (enrollmentId) {
        await supabase
          .from("cadence_enrollments")
          .update({ meeting_scheduled: false, status: "paused", paused_reason: "awaiting_slot_confirmation" } as any)
          .eq("id", enrollmentId);
      }

      // 5) Fetch new slots — honour any date hint from the lead's message
      try {
        const channelLabel = convChannel || channel || "email";
        const rangeHint = extractDateRangeFromText(cleanContent);
        const slotsBody: any = {
          company_id: companyId,
          lead_id: leadData?.id,
          enrollment_id: enrollment?.id || enrollmentId,
          conversation_id: convId,
          preferred_channel: channelLabel,
        };
        if (parsed.suggested_datetime) slotsBody.check_datetime = parsed.suggested_datetime;
        if (rangeHint?.start_after) slotsBody.start_after = rangeHint.start_after;
        if (rangeHint?.end_before) slotsBody.end_before = rangeHint.end_before;

        const slotsRes = await supabase.functions.invoke("calcom-slots", { body: slotsBody });

        if (slotsRes.data?.available && slotsRes.data?.slots?.[0]?.id) {
          // Suggested time is available — confirm immediately
          const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
            body: { lead_id: leadData.id, selected_slot_hold_id: slotsRes.data.slots[0].id },
          });
          if (confirmRes.data?.success) {
            const formattedDate = formatDateTimeBrt(parsed.suggested_datetime);
            parsed.reply_message = `Sem problemas! Reunião reagendada para ${formattedDate}. Você receberá um novo convite por e-mail. Até lá! 🚀`;
          } else {
            parsed.reply_message = "Vou verificar a disponibilidade e retorno em seguida!";
          }
        } else if (slotsRes.data?.formatted?.length >= 2) {
          if (slotsRes.data?.slots) heldSlots = slotsRes.data.slots;
          const prefix = parsed.suggested_datetime
            ? "Infelizmente esse horário não está disponível. Que tal uma dessas opções?"
            : "Sem problemas! Aqui vão novas opções:";
          parsed.reply_message = `${prefix}\n\n📅 ${slotsRes.data.formatted[0]}\n📅 ${slotsRes.data.formatted[1]}\n\nQual funciona melhor?`;
        } else if (slotsRes.data?.formatted?.length === 1) {
          if (slotsRes.data?.slots) heldSlots = slotsRes.data.slots;
          parsed.reply_message = `Sem problemas! Consegui este horário:\n\n📅 ${slotsRes.data.formatted[0]}\n\nFunciona para você?`;
        } else {
          const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
          parsed.reply_message = CALCOM_BOOKING_LINK
            ? `Sem problemas! Acesse ${CALCOM_BOOKING_LINK} para escolher o melhor horário.`
            : "Sem problemas! Me diga qual horário seria ideal para você.";
        }
      } catch (e) {
        console.error("Error fetching slots for reschedule:", e);
        parsed.reply_message = "Sem problemas! Me diga qual horário seria ideal para remarcar.";
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "🔄 Reunião reagendada a pedido do prospect",
          metadata: { action: "reschedule", suggested: parsed.suggested_datetime },
        });
      }
    } else if (parsed.action === "cancel") {
      // Cancel: drop existing booking + held slots, no new offer
      console.log(`Cancel requested for lead ${leadData?.id}`);
      const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");

      const { data: liveSlots } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime, cal_booking_uid, status")
        .eq("lead_id", leadData.id)
        .in("status", ["held", "confirmed"]);

      let cancelledBookingUid: string | null = null;
      let cancelledScheduledAt: string | null = null;
      for (const slot of (liveSlots || [])) {
        if (slot.cal_booking_uid && CALCOM_API_KEY) {
          const endpoint = slot.status === "confirmed"
            ? `https://api.cal.com/v2/bookings/${slot.cal_booking_uid}/cancel`
            : `https://api.cal.com/v2/slots/reservations/${slot.cal_booking_uid}`;
          const apiVersion = slot.status === "confirmed" ? "2024-04-15" : "2024-09-04";
          try {
            await fetch(endpoint, {
              method: "DELETE",
              headers: { "Authorization": `Bearer ${CALCOM_API_KEY}`, "cal-api-version": apiVersion },
            });
          } catch (e) {
            console.error("Error cancelling Cal.com entry:", e);
          }
          if (slot.status === "confirmed") {
            cancelledBookingUid = slot.cal_booking_uid;
            cancelledScheduledAt = slot.slot_datetime;
          }
        }
        await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", slot.id);
      }

      const { data: activeBookings } = await supabase
        .from("bookings")
        .select("id, calcom_booking_uid, scheduled_at, status")
        .eq("lead_id", leadData.id)
        .neq("status", "cancelled");
      for (const b of (activeBookings || [])) {
        if (CALCOM_API_KEY && b.calcom_booking_uid && b.calcom_booking_uid !== cancelledBookingUid) {
          try {
            await fetch(`https://api.cal.com/v2/bookings/${b.calcom_booking_uid}/cancel`, {
              method: "DELETE",
              headers: { "Authorization": `Bearer ${CALCOM_API_KEY}`, "cal-api-version": "2024-04-15" },
            });
          } catch (e) {
            console.error("Error cancelling orphan booking:", e);
          }
        }
        await supabase.from("bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", b.id);
        cancelledBookingUid = cancelledBookingUid || b.calcom_booking_uid;
        cancelledScheduledAt = cancelledScheduledAt || b.scheduled_at;
      }

      if (companyId && leadData) {
        await insertBookingSystemMessage(supabase, {
          lead_id: leadData.id,
          company_id: companyId,
          event_type: "booking_cancelled",
          booking_uid: cancelledBookingUid,
          scheduled_at: cancelledScheduledAt,
        });
      }

      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ meeting_scheduled: false, status: "cancelled", paused_reason: "meeting_cancelled_by_lead" } as any)
          .eq("id", enrollment.id);
      }

      if (!parsed.reply_message) {
        parsed.reply_message = "Sem problemas, cancelei nossa reunião! Se mudar de ideia ou quiser reagendar, é só me chamar por aqui. 👋";
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "❌ Reunião cancelada a pedido do prospect",
          metadata: { action: "cancel", source_message: cleanContent.substring(0, 200) },
        });
      }
    } else if (parsed.action === "check_availability" && parsed.suggested_datetime) {
      // Check if the prospect's suggested time is available
      console.log(`Checking availability for suggested time: ${parsed.suggested_datetime}`);
      const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");

      // Cancel existing holds first
      for (const slot of heldSlots) {
        if (slot.cal_booking_uid && CALCOM_API_KEY) {
          try {
            await fetch(`https://api.cal.com/v2/slots/reservations/${slot.cal_booking_uid}`, {
              method: "DELETE",
              headers: {
                "Authorization": `Bearer ${CALCOM_API_KEY}`,
                "cal-api-version": "2024-09-04",
              },
            });
          } catch (e) {
            console.error("Error cancelling reservation:", e);
          }
        }
        await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", slot.id);
      }

      try {
        const channelLabel = convChannel || channel || "email";

        // Anchor alternatives to the lead's preferred window: start at 00:00 BRT
        // of the suggested day, end 7 days later at 23:59 BRT. A more specific
        // range hint extracted from the text takes priority.
        let anchorStart: string | undefined;
        let anchorEnd: string | undefined;
        try {
          const suggested = new Date(parsed.suggested_datetime);
          if (!isNaN(suggested.getTime())) {
            // BRT = UTC-3 (no DST in Brazil). Compute day start/end in BRT.
            const BRT_OFFSET_MS = 3 * 3600000;
            const brtMs = suggested.getTime() - BRT_OFFSET_MS;
            const dayStartBrt = Math.floor(brtMs / 86400000) * 86400000;
            anchorStart = new Date(dayStartBrt + BRT_OFFSET_MS).toISOString();
            anchorEnd = new Date(dayStartBrt + 7 * 86400000 + BRT_OFFSET_MS - 60000).toISOString();
          }
        } catch (_) { /* ignore */ }
        const rangeHint = extractDateRangeFromText(cleanContent);
        if (rangeHint?.start_after) anchorStart = rangeHint.start_after;
        if (rangeHint?.end_before) anchorEnd = rangeHint.end_before;

        const slotsBody: any = {
          company_id: companyId,
          lead_id: leadData?.id,
          enrollment_id: enrollment?.id,
          conversation_id: convId,
          preferred_channel: channelLabel,
          check_datetime: parsed.suggested_datetime,
          exclude_datetimes: [
            ...heldSlots.map((s: any) => s.slot_datetime),
            ...lastOfferedSlots,
          ],
        };
        if (anchorStart) slotsBody.start_after = anchorStart;
        if (anchorEnd) slotsBody.end_before = anchorEnd;

        const slotsRes = await supabase.functions.invoke("calcom-slots", { body: slotsBody });

        if (slotsRes.data?.available) {
          // Slot is available — confirm booking directly
          const holdId = slotsRes.data?.slots?.[0]?.id;
          if (holdId) {
            const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
              body: { lead_id: leadData.id, selected_slot_hold_id: holdId },
            });

            if (confirmRes.data?.success) {
              const formattedDate = formatDateTimeBrt(parsed.suggested_datetime);
              parsed.reply_message = `Perfeito, temos disponibilidade! Reunião confirmada para ${formattedDate}. Você receberá o convite por e-mail. Até lá! 🚀`;
            } else {
              parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
            }
          }
        } else {
          // Not available — offer alternatives anchored to lead's preferred window
          const formatted = slotsRes.data?.formatted || [];
          if (formatted.length >= 2) {
            parsed.reply_message = `Infelizmente esse horário não está disponível. Que tal uma dessas opções?\n\n📅 ${formatted[0]}\n📅 ${formatted[1]}\n\nQual funciona melhor?`;
          } else if (formatted.length === 1) {
            parsed.reply_message = `Infelizmente esse horário exato não está disponível. Tenho ${formatted[0]} — funciona para você?`;
          } else {
            const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
            parsed.reply_message = CALCOM_BOOKING_LINK
              ? `Infelizmente esse horário não está disponível. Acesse ${CALCOM_BOOKING_LINK} para ver todas as opções.`
              : "Infelizmente esse horário não está disponível. Pode sugerir outro?";
          }
        }
      } catch (e) {
        console.error("Error checking availability:", e);
        parsed.reply_message = "Vou verificar a disponibilidade e retorno em seguida!";
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: `🔍 Verificação de disponibilidade: ${parsed.suggested_datetime}`,
          metadata: { action: "check_availability", suggested: parsed.suggested_datetime },
        });
      }
    } else if (parsed.action === "schedule") {
      // Block schedule if meeting already scheduled
      if (enrollment) {
        const { data: enrollCheck } = await supabase
          .from("cadence_enrollments")
          .select("meeting_scheduled")
          .eq("id", enrollment.id)
          .maybeSingle();

        if (enrollCheck?.meeting_scheduled) {
          console.log("Meeting already scheduled — skipping schedule action");
          parsed.action = "reply";
          if (!parsed.reply_message) {
            parsed.reply_message = "Já temos uma reunião agendada! Caso precise reagendar, é só me avisar.";
          }
        }
      }

      // Only proceed with scheduling if action wasn't overridden
      if (parsed.action === "schedule") {
        try {
          const channelLabel = convChannel || channel || "email";
          const rangeHint = extractDateRangeFromText(cleanContent);
          const slotsBody: any = {
            company_id: companyId,
            lead_id: leadData?.id,
            enrollment_id: enrollment?.id,
            conversation_id: convId,
            preferred_channel: channelLabel,
          };
          if (rangeHint?.start_after) slotsBody.start_after = rangeHint.start_after;
          if (rangeHint?.end_before) slotsBody.end_before = rangeHint.end_before;
          const slotsRes = await supabase.functions.invoke("calcom-slots", { body: slotsBody });

          const slotCount = slotsRes.data?.formatted?.length || 0;
          // FIX: Capture offered slot datetimes for metadata
          if (slotsRes.data?.slots) {
            heldSlots = slotsRes.data.slots;
          }
          if (slotsRes.data?.success && slotCount >= 2) {
            parsed.reply_message = `Ótimo! Tenho 2 horários disponíveis para conversarmos:\n\n📅 ${slotsRes.data.formatted[0]}\n📅 ${slotsRes.data.formatted[1]}\n\nQual funciona melhor para você?`;
          } else if (slotsRes.data?.success && slotCount === 1) {
            parsed.reply_message = `Ótimo! Consegui o seguinte horário disponível:\n\n📅 ${slotsRes.data.formatted[0]}\n\nFunciona para você? Se não, me diga sua preferência que verifico outras opções.`;
          } else {
            const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
            parsed.reply_message = CALCOM_BOOKING_LINK
              ? `Ótimo! Acesse ${CALCOM_BOOKING_LINK} para escolher o melhor horário para nossa conversa.`
              : "Ótimo! Me diga sua disponibilidade para a reunião que eu verifico os horários.";
          }
        } catch (slotErr) {
          console.error("Error fetching Cal.com slots:", slotErr);
          const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
          parsed.reply_message = CALCOM_BOOKING_LINK
            ? `Ótimo! Acesse ${CALCOM_BOOKING_LINK} para escolher o melhor horário para nossa conversa.`
            : "Ótimo! Me diga sua disponibilidade para a reunião que eu verifico os horários.";
        }

        // FIX: Only pause enrollment inside the schedule block (not when action was overridden)
        if (enrollment) {
          await supabase
            .from("cadence_enrollments")
            .update({ status: "paused", paused_reason: "awaiting_slot_confirmation" } as any)
            .eq("id", enrollment.id);
        }
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "📅 Slots oferecidos ao prospect para agendamento",
          metadata: { auto_scheduled: true, sentiment: parsed.sentiment },
        });
      }
    } else if (parsed.action === "pause") {
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "lead_rejected" } as any)
          .eq("id", enrollment.id);
      }
      if (!parsed.reply_message) {
        parsed.reply_message = "Tudo bem, agradeço muito pelo seu retorno e pelo tempo até aqui! Vou pausar nosso contato por aqui. Se mudar de ideia ou quiser conversar mais pra frente, é só me chamar. 👋";
      }
    } else if (parsed.action === "request_call" && leadData && companyId) {
      // Prospect asked to be called. Pause cadence, log a 'call' task with metadata for human/voice agent.
      console.log(`Call requested for lead ${leadData.id}`);
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "call_requested" } as any)
          .eq("id", enrollment.id);
      }
      const callPhone = parsed.call_phone || leadData.phone || null;
      const callWindow = parsed.call_window || null;
      await supabase
        .from("leads")
        .update({ call_requested_at: new Date().toISOString() } as any)
        .eq("id", leadData.id);
      await supabase.from("lead_activities").insert({
        company_id: companyId,
        lead_id: leadData.id,
        type: "call",
        description: `📞 Pedido de ligação${callWindow ? ` (${callWindow})` : ""}${callPhone ? ` — ${callPhone}` : ""}`,
        metadata: {
          task_type: "call",
          status: "pending",
          phone: callPhone,
          preferred_window: callWindow,
          source_message: cleanContent.substring(0, 300),
        },
      });
      if (!parsed.reply_message) {
        parsed.reply_message = callWindow
          ? `Combinado! Vou agendar a ligação ${callWindow}${callPhone ? ` no ${callPhone}` : ""}. Se precisar ajustar, é só me avisar.`
          : `Perfeito! Vou pedir para nosso time te ligar${callPhone ? ` no ${callPhone}` : ""}. Tem alguma janela de horário que prefere?`;
      }
    } else if (parsed.action === "handoff" && leadData && companyId) {
      // Human handoff: pause cadence, flag lead, log activity. Keep reply short and honest.
      console.log(`Handoff requested for lead ${leadData.id}: ${parsed.handoff_reason}`);
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "handoff_required" } as any)
          .eq("id", enrollment.id);
      }
      await supabase
        .from("leads")
        .update({
          handoff_required: true,
          handoff_reason: parsed.handoff_reason || "Pergunta fora da base de conhecimento",
          handoff_at: new Date().toISOString(),
        } as any)
        .eq("id", leadData.id);
      await supabase.from("lead_activities").insert({
        company_id: companyId,
        lead_id: leadData.id,
        type: "note",
        description: `🚨 Handoff humano necessário: ${parsed.handoff_reason || "tema fora da base"}`,
        metadata: {
          handoff: true,
          reason: parsed.handoff_reason,
          source_message: cleanContent.substring(0, 300),
          reasoning: parsed.reasoning,
        },
      });
      if (!parsed.reply_message) {
        parsed.reply_message = "Ótima pergunta! Vou passar para um especialista do nosso time, que retorna em breve com a resposta correta. Obrigado pela paciência!";
      }
    } else if (parsed.action === "referral" && leadData && companyId) {
      const ref = parsed.referral || {};
      const subtype: string = ref.subtype || "wrong_person";
      console.log(`Referral detected (subtype=${subtype}) for lead ${leadData.id}`);

      // Always pause active cadence for the original contact when a referral is detected
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: `referral_${subtype}` } as any)
          .eq("id", enrollment.id);
      }

      // Map subtype → stage / role
      const stageMap: Record<string, string> = {
        with_contact: "encaminhado_para_decisor",
        without_contact: "aguardando_contato_decisor",
        will_forward: "aguardando_encaminhamento_interno",
        wrong_person: "contato_errado",
        gatekeeper: "tentando_identificar_decisor",
        refuses_contact: "sem_acesso_decisor",
      };

      // Mark current lead as indicador/gatekeeper
      const originalRole = subtype === "gatekeeper" ? "gatekeeper" : "indicador";
      await supabase
        .from("leads")
        .update({
          referral_role: originalRole,
          referral_stage: stageMap[subtype] || null,
          referral_context: ref.context || null,
          referral_permission_to_mention: ref.permission_to_mention ?? null,
        } as any)
        .eq("id", leadData.id);

      // Audit activity
      await supabase.from("lead_activities").insert({
        company_id: companyId,
        lead_id: leadData.id,
        type: "referral",
        description: `Indicação detectada (${subtype})${ref.referred_name ? ` → ${ref.referred_name}` : ""}`,
        metadata: { referral: ref, reasoning: parsed.reasoning, playbook: parsed.playbook || "neutro" },
      });

      // with_contact: create new lead + conversation + 1st outreach
      if (subtype === "with_contact" && ref.referred_name && (ref.referred_email || ref.referred_phone)) {
        // Avoid duplicates by email within same company
        let newLeadId: string | null = null;
        if (ref.referred_email) {
          const { data: existing } = await supabase
            .from("leads")
            .select("id")
            .eq("company_id", companyId)
            .eq("email", String(ref.referred_email).toLowerCase().trim())
            .maybeSingle();
          if (existing?.id) newLeadId = existing.id;
        }

        if (!newLeadId) {
          const insertRow: any = {
            company_id: companyId,
            name: ref.referred_name,
            email: ref.referred_email ? String(ref.referred_email).toLowerCase().trim() : null,
            phone: ref.referred_phone || null,
            company_name: leadData.company_name || null,
            title: ref.referred_role || null,
            source: "referral",
            status: "new",
            referral_source_lead_id: leadData.id,
            referral_role: "decisor",
            referral_stage: "novo_indicado",
            referral_context: ref.context || null,
            referral_permission_to_mention: ref.permission_to_mention ?? null,
            preferred_channel: ref.referred_channel || (ref.referred_email ? "email" : "whatsapp"),
          };
          const { data: newLead, error: newLeadErr } = await supabase
            .from("leads")
            .insert(insertRow)
            .select("id")
            .single();
          if (newLeadErr) {
            console.error("Failed to create referred lead:", newLeadErr);
          } else {
            newLeadId = newLead.id;
          }
        }

        // Create conversation + first outbound message and send via available channel
        if (newLeadId && parsed.new_outreach_message) {
          const newChannel = (ref.referred_channel || (ref.referred_email ? "email" : "whatsapp")) as string;
          const { data: newConv } = await supabase
            .from("conversations")
            .insert({
              company_id: companyId,
              lead_id: newLeadId,
              channel: newChannel as any,
            })
            .select("id")
            .single();

          const newConvId = newConv?.id;
          const outreachMeta = {
            referral_outreach: true,
            referral_source_lead_id: leadData.id,
            referral_source_name: leadData.name,
            permission_to_mention: ref.permission_to_mention ?? null,
          };

          // Email path → use gmail-send when available, else transactional
          if (newChannel === "email" && ref.referred_email && newConvId) {
            const subject = `${leadData.company_name || "Indicação"} — apresentação`;
            const { data: gmailAcc } = await supabase
              .from("gmail_account")
              .select("email")
              .eq("is_active", true)
              .maybeSingle();
            let sent = false;
            if (gmailAcc?.email) {
              try {
                const { error: sendErr } = await supabase.functions.invoke("gmail-send", {
                  body: {
                    to: ref.referred_email,
                    subject,
                    html: toEmailHtml(parsed.new_outreach_message),
                    text: parsed.new_outreach_message,
                    conversation_id: newConvId,
                    company_id: companyId,
                    lead_id: newLeadId,
                  },
                });
                if (!sendErr) sent = true;
              } catch (e) {
                console.error("gmail-send for referral failed:", e);
              }
            }
            if (!sent) {
              await supabase.from("messages").insert({
                conversation_id: newConvId,
                content: parsed.new_outreach_message,
                direction: "outbound",
                ai_suggested: true,
                metadata: { ...outreachMeta, subject, via: "transactional" },
              });
              await supabase.functions.invoke("send-transactional-email", {
                body: {
                  templateName: "cadence-outreach",
                  recipientEmail: ref.referred_email,
                  idempotencyKey: `referral-${newLeadId}-${Date.now()}`,
                  templateData: {
                    leadName: ref.referred_name,
                    subject,
                    messageBody: parsed.new_outreach_message,
                  },
                },
              });
            }
          } else if (newConvId) {
            // WhatsApp/other: just log message (sending happens via cadence/manual until Twilio is wired here)
            await supabase.from("messages").insert({
              conversation_id: newConvId,
              content: parsed.new_outreach_message,
              direction: "outbound",
              ai_suggested: true,
              metadata: { ...outreachMeta, channel: newChannel, pending_send: newChannel !== "email" },
            });
          }
        }
      }
    }

    // Send auto-reply if needed
    if (parsed.reply_message) {
      const replyChannel = convChannel || channel || "email";
      const autoReplyMetadata = {
        auto_reply: true,
        sentiment: parsed.sentiment,
        action: parsed.action,
        reasoning: parsed.reasoning,
        ...(["schedule", "reject_slots", "reschedule"].includes(parsed.action) ? { offered_slots: (heldSlots || []).map((s: any) => s.slot_datetime) } : {}),
      };

      let sentViaGmail = false;

      if (replyChannel === "email" && leadData?.email) {
        // Build threading headers from prior Gmail messages on this conversation
        const { data: priorMsgs } = await supabase
          .from("messages")
          .select("direction, rfc_message_id, gmail_thread_id, metadata, sent_at")
          .eq("conversation_id", convId)
          .not("rfc_message_id", "is", null)
          .order("sent_at", { ascending: true });

        const lastInbound = (priorMsgs || []).slice().reverse().find((m: any) => m.direction === "inbound" && m.rfc_message_id);
        const allRfcIds = (priorMsgs || []).map((m: any) => m.rfc_message_id).filter(Boolean);
        const originalSubject = (priorMsgs || [])
          .map((m: any) => m.metadata?.subject)
          .find((s: any) => typeof s === "string" && s.length > 0) || `${leadData.company_name || leadData.name}`;
        const replySubject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;

        // Check Gmail availability for this company
        const { data: gmailAcc } = await supabase
          .from("gmail_account")
          .select("email")
          .eq("is_active", true)
          .maybeSingle();

        if (gmailAcc?.email) {
          try {
            const { data: sendRes, error: sendErr } = await supabase.functions.invoke("gmail-send", {
              body: {
                to: leadData.email,
                subject: replySubject,
                html: toEmailHtml(parsed.reply_message),
                text: parsed.reply_message,
                conversation_id: convId,
                company_id: companyId,
                lead_id: leadData.id,
                in_reply_to_rfc_id: lastInbound?.rfc_message_id || null,
                references: allRfcIds.length ? allRfcIds.join(" ") : (lastInbound?.rfc_message_id || null),
              },
            });
            if (sendErr) throw sendErr;
            const gmailMessageId = (sendRes as any)?.gmail_message_id;
            // Promote the row inserted by gmail-send with our AI metadata
            if (gmailMessageId) {
              await supabase
                .from("messages")
                .update({ ai_suggested: true, metadata: { ...autoReplyMetadata, subject: replySubject, channel: "email", via: "gmail" } })
                .eq("gmail_message_id", gmailMessageId);
            }
            sentViaGmail = true;
          } catch (e) {
            console.error("gmail-send auto-reply failed, falling back to transactional:", e);
          }
        }

        if (!sentViaGmail) {
          // Fallback: transactional email (also save the message row, since gmail-send didn't run)
          await supabase.from("messages").insert({
            conversation_id: convId,
            content: parsed.reply_message,
            direction: "outbound",
            ai_suggested: true,
            metadata: { ...autoReplyMetadata, via: "transactional" },
          });
          await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "cadence-outreach",
              recipientEmail: leadData.email,
              idempotencyKey: `auto-reply-${convId}-${Date.now()}`,
              templateData: {
                leadName: leadData.name,
                subject: replySubject,
                messageBody: parsed.reply_message,
              },
            },
          });
        }
      } else if (replyChannel === "whatsapp" && (leadData?.whatsapp || leadData?.phone)) {
        const toNumber = leadData.whatsapp || leadData.phone;
        const twCfg = companyId ? await getTwilioConfig(supabase, companyId) : null;
        let deliveryMeta: Record<string, unknown> = { ...autoReplyMetadata };

        if (!twCfg) {
          deliveryMeta = { ...deliveryMeta, delivery_status: "pending_manual", delivery_error: "Twilio não configurado para a empresa" };
          console.warn("inbound-webhook: Twilio not configured for company", companyId);
        } else {
          const r = await sendWhatsAppViaTwilio(twCfg, toNumber, parsed.reply_message);
          if (!r.ok) {
            deliveryMeta = { ...deliveryMeta, delivery_status: "failed", twilio_status: r.status, twilio_error: r.error };
            console.error("inbound-webhook: Twilio WhatsApp send failed:", r.error);
          } else {
            deliveryMeta = { ...deliveryMeta, delivery_status: "sent", twilio_sid: r.sid };
          }
        }

        await supabase.from("messages").insert({
          conversation_id: convId,
          content: parsed.reply_message,
          direction: "outbound",
          ai_suggested: true,
          metadata: deliveryMeta,
        });
      } else {
        // Unknown channel — still log the message for visibility
        await supabase.from("messages").insert({
          conversation_id: convId,
          content: parsed.reply_message,
          direction: "outbound",
          ai_suggested: true,
          metadata: { ...autoReplyMetadata, delivery_status: "pending_manual", delivery_error: `Canal '${replyChannel}' sem destinatário válido` },
        });
      }

    }


    // Log execution
    if (enrollment && leadData && companyId) {
      const { data: steps } = await supabase
        .from("cadence_steps")
        .select("id")
        .eq("cadence_id", enrollment.cadence_id)
        .limit(1);

      if (steps && steps.length > 0) {
        const actionMap: Record<string, string> = {
          schedule: "scheduled",
          confirm_slot: "meeting_confirmed",
          reject_slots: "slots_rejected",
          check_availability: "availability_checked",
          reschedule: "rescheduled",
          cancel: "meeting_cancelled",
          pause: "paused",
          referral: "referral_detected",
          request_call: "call_requested",
          handoff: "handoff_required",
        };
        await supabase.from("execution_logs").insert({
          company_id: companyId,
          enrollment_id: enrollment.id,
          step_id: steps[0].id,
          lead_id: leadData.id,
          channel: channel || "email",
          action: actionMap[parsed.action] || "replied",
          message_content: parsed.reply_message || content,
          ai_context: parsed,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, action: parsed.action, sentiment: parsed.sentiment }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("inbound-webhook error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
