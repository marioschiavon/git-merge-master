import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    // Save inbound message
    await supabase.from("messages").insert({
      conversation_id: convId,
      content,
      direction: "inbound",
      ai_suggested: false,
    });

    // Auto-pause cadence enrollment if conversation is linked to one
    if (convId) {
      const { data: convData } = await supabase
        .from("conversations")
        .select("cadence_enrollment_id")
        .eq("id", convId)
        .maybeSingle();

      if (convData?.cadence_enrollment_id) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "lead_replied" } as any)
          .eq("id", convData.cadence_enrollment_id)
          .in("status", ["active", "completed"]);
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
        description: `${channelEmoji} Resposta recebida: ${content.substring(0, 150)}`,
        metadata: { direction: "inbound", channel: channelLabel },
      });
    }

    // Check for held slots (for confirm_slot context)
    let heldSlots: any[] = [];
    if (leadData?.id) {
      const { data: slots } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime, cal_booking_uid, status")
        .eq("lead_id", leadData.id)
        .eq("status", "held")
        .order("slot_datetime", { ascending: true });
      heldSlots = slots || [];
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
    }

    // Get conversation history
    const { data: messages } = await supabase
      .from("messages")
      .select("direction, content")
      .eq("conversation_id", convId)
      .order("sent_at", { ascending: true })
      .limit(20);

    // Find active enrollment for this lead
    const { data: enrollment } = await supabase
      .from("cadence_enrollments")
      .select("id, cadence_id")
      .eq("lead_id", leadData?.id)
      .in("status", ["active", "paused"])
      .maybeSingle();

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
        model: "google/gemini-2.5-flash",
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

    // Fallback: if AI says confirm_slot but no held slots exist, reclassify as reply
    if (parsed.action === "confirm_slot" && heldSlots.length < 2) {
      console.log("confirm_slot requested but no held slots found — falling back to reply");
      parsed.action = "reply";
      if (!parsed.reply_message) {
        parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
      }
    }

    // Fallback: if AI says reject_slots/check_availability but no held slots
    if ((parsed.action === "reject_slots" || parsed.action === "check_availability") && heldSlots.length === 0) {
      console.log(`${parsed.action} requested but no held slots found — falling back to reply`);
      parsed.action = "reply";
      if (!parsed.reply_message) {
        parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
      }
    }

    // Ensure reply_message is never null for action=reply
    if (parsed.action === "reply" && !parsed.reply_message) {
      parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
    }

    // Execute action based on AI decision
    if (parsed.action === "confirm_slot" && heldSlots.length >= 2) {
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
          // Format confirmation date for reply
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
    } else if (parsed.action === "reject_slots" && heldSlots.length >= 1) {
      // Cancel all held slots and offer new ones
      console.log(`Rejecting ${heldSlots.length} held slots for lead ${leadData?.id}`);
      const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");

      for (const slot of heldSlots) {
        // Cancel reservation on Cal.com
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
        // Mark as cancelled in DB
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
      }

      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "awaiting_slot_confirmation" } as any)
          .eq("id", enrollment.id);
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
