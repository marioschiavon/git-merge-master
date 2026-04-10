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

    if (!convId && lead_id) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, company_id, channel, leads(id, name, company_name, segment)")
        .eq("lead_id", lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (conv) {
        convId = conv.id;
        companyId = conv.company_id;
        leadData = (conv as any).leads;
      }
    } else if (convId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, company_id, channel, leads(id, name, company_name, segment)")
        .eq("id", convId)
        .maybeSingle();
      if (conv) {
        companyId = conv.company_id;
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

    // Get conversation history
    const { data: messages } = await supabase
      .from("messages")
      .select("direction, content")
      .eq("conversation_id", convId)
      .order("sent_at", { ascending: true })
      .limit(20);

    // Analyze with AI
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Você é um SDR autônomo de vendas B2B. Analise a resposta do prospect e decida a ação.

AÇÕES POSSÍVEIS:
- "reply": responder automaticamente (objeção, dúvida, neutro)
- "schedule": prospect demonstrou interesse em reunião → parar cadência e confirmar horário
- "pause": prospect rejeitou → pausar cadência educadamente

REGRAS:
- Se o prospect menciona "reunião", "agendar", "conversar", "demo", "horário" → action = "schedule"
- Se o prospect diz "não tenho interesse", "não quero", "remova", "pare" → action = "pause"
- Se objeção (preço, timing, concorrente) → contorne com empatia + prova social
- Se dúvida → responda objetivamente + CTA para reunião
- Mensagens curtas e naturais

Responda APENAS com JSON:
{
  "action": "reply|schedule|pause",
  "sentiment": "interesse|objeção|dúvida|rejeição|neutro",
  "reasoning": "explicação breve",
  "reply_message": "mensagem para enviar ao prospect (null se action=pause e não precisa responder)"
}`,
          },
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
      parsed = { action: "reply", sentiment: "neutro", reasoning: "Fallback", reply_message: null };
    }

    // Find active enrollment for this lead
    const { data: enrollment } = await supabase
      .from("cadence_enrollments")
      .select("id")
      .eq("lead_id", leadData?.id)
      .eq("status", "active")
      .maybeSingle();

    // Execute action
    if (parsed.action === "schedule" && enrollment) {
      await supabase
        .from("cadence_enrollments")
        .update({ status: "completed", meeting_scheduled: true, completed_at: new Date().toISOString() })
        .eq("id", enrollment.id);

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "Reunião agendada via SDR autônomo",
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

      // TODO: Send via actual channel (Twilio/Resend) when configured
    }

    // Log
    if (enrollment && leadData && companyId) {
      // Find latest step
      const { data: steps } = await supabase
        .from("cadence_steps")
        .select("id")
        .eq("cadence_id", enrollment.id)
        .limit(1);

      if (steps && steps.length > 0) {
        await supabase.from("execution_logs").insert({
          company_id: companyId,
          enrollment_id: enrollment.id,
          step_id: steps[0].id,
          lead_id: leadData.id,
          channel: channel || "whatsapp",
          action: parsed.action === "schedule" ? "scheduled" : parsed.action === "pause" ? "paused" : "replied",
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
