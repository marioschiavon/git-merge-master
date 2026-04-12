import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Fallback server-side datetime parser for Portuguese date expressions.
 * Returns ISO 8601 string or null.
 */
function extractDateTimeFromText(text: string): string | null {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  // Pattern: "dia DD às HH:MM" or "dia DD as HHh" or "dia DD as HH:MM"
  const diaMatch = text.match(/dia\s+(\d{1,2})\s+[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (diaMatch) {
    const day = parseInt(diaMatch[1]);
    const hour = parseInt(diaMatch[2]);
    const minute = parseInt(diaMatch[3] || "0");
    // If the day already passed this month, assume next month
    let month = currentMonth;
    if (day < now.getDate() || (day === now.getDate() && hour < now.getHours())) {
      month += 1;
    }
    const dt = new Date(currentYear, month, day, hour, minute);
    return dt.toISOString();
  }

  // Pattern: "DD/MM às HH:MM" or "DD/MM as HHh"
  const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})\s+[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]) - 1;
    const hour = parseInt(slashMatch[3]);
    const minute = parseInt(slashMatch[4] || "0");
    const dt = new Date(currentYear, month, day, hour, minute);
    return dt.toISOString();
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
      const today = now.getDay();
      let diff = targetDay - today;
      if (diff <= 0) diff += 7;
      const dt = new Date(now);
      dt.setDate(dt.getDate() + diff);
      dt.setHours(hour, minute, 0, 0);
      return dt.toISOString();
    }
  }

  // Pattern: just time "às HHh" or "as HH:MM" (assume today or tomorrow)
  const timeOnly = text.match(/[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (timeOnly) {
    const hour = parseInt(timeOnly[1]);
    const minute = parseInt(timeOnly[2] || "0");
    const dt = new Date(now);
    dt.setHours(hour, minute, 0, 0);
    if (dt <= now) dt.setDate(dt.getDate() + 1);
    return dt.toISOString();
  }

  return null;
}

/**
 * Strip quoted email text from replies (Gmail, Outlook, generic ">").
 */
function stripQuotedEmail(text: string): string {
  const patterns = [
    /\r?\n\s*Em .+escreveu:\s*$/im,
    /\r?\n\s*On .+wrote:\s*$/im,
    /\r?\n\s*-{3,}Original Message-{3,}/im,
    /\r?\n\s*_{10,}/im,
    /\r?\n\s*From:\s+.+\r?\nSent:\s+/im,
    /\r?\n\s*De:\s+.+\r?\nEnviado:\s+/im,
  ];

  let clean = text;
  for (const p of patterns) {
    const idx = clean.search(p);
    if (idx !== -1) {
      clean = clean.substring(0, idx).trim();
      break;
    }
  }

  // Remove trailing ">" quoted lines
  const lines = clean.split(/\r?\n/);
  const filtered: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    filtered.push(line);
  }

  return filtered.join("\n").trim() || text.trim();
}

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

    const { from, content, channel, conversation_id, lead_id } = body;

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
        .select("id, company_id, channel, leads(id, name, email, company_name)")
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
        .select("id, company_id, channel, leads(id, name, email, company_name)")
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
    console.log("Original content length:", content.length, "Clean content length:", cleanContent.length);

    // Save inbound message (with clean content)
    await supabase.from("messages").insert({
      conversation_id: convId,
      content: cleanContent,
      direction: "inbound",
      ai_suggested: false,
    });

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

    // Analyze with AI
    const systemPrompt = `Você é um SDR autônomo de vendas B2B. Analise a resposta do prospect e decida a ação.

AÇÕES POSSÍVEIS:
- "reply": responder automaticamente (objeção, dúvida, neutro)
- "schedule": prospect demonstrou interesse em reunião → parar cadência e confirmar horário
- "confirm_slot": prospect está confirmando/escolhendo um dos horários já oferecidos
- "reject_slots": prospect rejeitou ambos os horários oferecidos (ex: "nenhum funciona", "tenho compromisso nesses dias")
- "check_availability": prospect sugeriu um horário alternativo próprio (ex: "pode ser terça às 14h?")
  → inclua "suggested_datetime" no formato ISO 8601 (YYYY-MM-DDTHH:mm:ss)
- "pause": prospect rejeitou totalmente → pausar cadência

REGRAS:
- Se o prospect menciona "reunião", "agendar", "conversar", "demo", "horário" E NÃO há slots pendentes → action = "schedule"
- Se há slots pendentes e o prospect está escolhendo um deles → action = "confirm_slot" com selected_slot = 1 ou 2
- Se há slots pendentes e o prospect recusou ambos → action = "reject_slots"
- Se há slots pendentes e o prospect sugeriu outro horário → action = "check_availability" com suggested_datetime
- Se o prospect diz "não tenho interesse", "não quero", "remova", "pare" → action = "pause"
- Se objeção (preço, timing, concorrente) → contorne com empatia + prova social
- Se dúvida → responda objetivamente + CTA para reunião
- Mensagens curtas e naturais

Responda APENAS com JSON:
{
  "action": "reply|schedule|confirm_slot|reject_slots|check_availability|pause",
  "sentiment": "interesse|objeção|dúvida|rejeição|neutro",
  "selected_slot": null,
  "suggested_datetime": null,
  "reasoning": "explicação breve",
  "reply_message": "mensagem para enviar ao prospect (null se action=pause e não precisa responder)"
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
${(messages || []).map((m: any) => `[${m.direction === "outbound" ? "SDR" : "PROSPECT"}]: ${m.content}`).join("\n")}

Analise e decida a ação.`,
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

    // FIX: If AI says "schedule" but scheduling is already in progress, redirect to check_availability
    if (parsed.action === "schedule" && schedulingInProgress) {
      console.log("Schedule requested but scheduling already in progress — redirecting to check_availability");
      parsed.action = "check_availability";
      // Try to extract datetime from original message
      if (!parsed.suggested_datetime) {
        parsed.suggested_datetime = extractDateTimeFromText(content);
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

    // Execute action based on AI decision
    if (parsed.action === "confirm_slot" && heldSlots.length >= 1) {
      // Confirm the selected slot
      const slotIndex = (parsed.selected_slot || 1) - 1;
      const selectedHold = heldSlots[Math.min(slotIndex, heldSlots.length - 1)];

      console.log(`Confirming slot ${parsed.selected_slot}: ${selectedHold.slot_datetime}`);

      try {
        const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
          body: {
            lead_id: leadData.id,
            selected_slot_hold_id: selectedHold.id,
          },
        });

        if (confirmRes.data?.success) {
          console.log("Booking confirmed successfully");
          const dt = new Date(selectedHold.slot_datetime);
          const formattedDate = dt.toLocaleDateString("pt-BR", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }) + " às " + dt.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          });

          if (!parsed.reply_message) {
            parsed.reply_message = `Perfeito! Reunião confirmada para ${formattedDate}. Você receberá um convite no seu e-mail em instantes. Até lá! 🚀`;
          }
        } else {
          console.error("Failed to confirm booking:", confirmRes.data?.error);
          parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
        }
      } catch (e) {
        console.error("Error invoking calcom-confirm-booking:", e);
        parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
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

      // Fetch 2 new slots
      try {
        const channelLabel = convChannel || channel || "email";
        const slotsRes = await supabase.functions.invoke("calcom-slots", {
          body: {
            company_id: companyId,
            lead_id: leadData?.id,
            enrollment_id: enrollment?.id,
            conversation_id: convId,
            preferred_channel: channelLabel,
          },
        });

        if (slotsRes.data?.success && slotsRes.data?.formatted?.length >= 2) {
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
        const slotsRes = await supabase.functions.invoke("calcom-slots", {
          body: {
            company_id: companyId,
            lead_id: leadData?.id,
            enrollment_id: enrollment?.id,
            conversation_id: convId,
            preferred_channel: channelLabel,
            check_datetime: parsed.suggested_datetime,
          },
        });

        if (slotsRes.data?.available) {
          // Slot is available — confirm booking directly
          const holdId = slotsRes.data?.slots?.[0]?.id;
          if (holdId) {
            const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
              body: { lead_id: leadData.id, selected_slot_hold_id: holdId },
            });

            if (confirmRes.data?.success) {
              const dt = new Date(parsed.suggested_datetime);
              const formattedDate = dt.toLocaleDateString("pt-BR", {
                weekday: "long", day: "numeric", month: "long",
              }) + " às " + dt.toLocaleTimeString("pt-BR", {
                hour: "2-digit", minute: "2-digit",
              });
              parsed.reply_message = `Perfeito, temos disponibilidade! Reunião confirmada para ${formattedDate}. Você receberá o convite por e-mail. Até lá! 🚀`;
            } else {
              parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
            }
          }
        } else {
          // Not available — offer 2 alternatives
          if (slotsRes.data?.formatted?.length >= 2) {
            parsed.reply_message = `Infelizmente esse horário não está disponível. Que tal uma dessas opções?\n\n📅 ${slotsRes.data.formatted[0]}\n📅 ${slotsRes.data.formatted[1]}\n\nQual funciona melhor?`;
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
          const slotsRes = await supabase.functions.invoke("calcom-slots", {
            body: {
              company_id: companyId,
              lead_id: leadData?.id,
              enrollment_id: enrollment?.id,
              conversation_id: convId,
              preferred_channel: channelLabel,
            },
          });

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
    } else if (parsed.action === "pause" && enrollment) {
      await supabase
        .from("cadence_enrollments")
        .update({ status: "paused" })
        .eq("id", enrollment.id);
    }

    // Send auto-reply if needed
    if (parsed.reply_message) {
      await supabase.from("messages").insert({
        conversation_id: convId,
        content: parsed.reply_message,
        direction: "outbound",
        ai_suggested: true,
        metadata: {
          auto_reply: true,
          sentiment: parsed.sentiment,
          action: parsed.action,
          reasoning: parsed.reasoning,
          // FIX: Save offered slot datetimes for future context recovery
          ...(parsed.action === "schedule" || parsed.action === "reject_slots" ? { offered_slots: (heldSlots || []).map((s: any) => s.slot_datetime) } : {}),
        },
      });

      const replyChannel = convChannel || channel || "email";

      if (replyChannel === "email" && leadData?.email) {
        await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "cadence-outreach",
            recipientEmail: leadData.email,
            idempotencyKey: `auto-reply-${convId}-${Date.now()}`,
            templateData: {
              leadName: leadData.name,
              subject: `Re: ${leadData.company_name || leadData.name}`,
              messageBody: parsed.reply_message,
            },
          },
        });
      } else if (replyChannel === "whatsapp" && leadData?.phone) {
        const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
        const TWILIO_PHONE = Deno.env.get("TWILIO_WHATSAPP_NUMBER");
        if (LOVABLE_API_KEY && TWILIO_API_KEY && TWILIO_PHONE) {
          try {
            await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                "X-Connection-Api-Key": TWILIO_API_KEY,
                "Content-Type": "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                To: `whatsapp:${leadData.phone}`,
                From: `whatsapp:${TWILIO_PHONE}`,
                Body: parsed.reply_message,
              }),
            });
          } catch (e) {
            console.error("Twilio WhatsApp send error:", e);
          }
        }
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
          pause: "paused",
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
