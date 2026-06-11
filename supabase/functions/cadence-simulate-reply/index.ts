// Simula uma resposta do lead numa cadência inteligente em modo simulação.
// Cria mensagem inbound, classifica intent, gera e insere a resposta da IA como outbound simulada.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { enrollment_id, reply_text, channel } = await req.json();
    if (!enrollment_id || !reply_text?.trim()) {
      return new Response(JSON.stringify({ error: "enrollment_id and reply_text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load enrollment (RLS enforces access)
    const { data: enrollment, error: enrErr } = await supabase
      .from("cadence_enrollments")
      .select("id, lead_id, cadence_id, cadences(company_id, simulation_mode)")
      .eq("id", enrollment_id)
      .maybeSingle();
    if (enrErr || !enrollment) {
      return new Response(JSON.stringify({ error: "enrollment not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cadence = (enrollment as any).cadences;
    if (!cadence?.simulation_mode) {
      return new Response(JSON.stringify({ error: "cadence is not in simulation_mode" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const companyId = cadence.company_id;
    const ch = channel || "whatsapp";

    // Find or create conversation
    let convId: string | null = null;
    const { data: byEnroll } = await supabase
      .from("conversations").select("id")
      .eq("lead_id", enrollment.lead_id)
      .eq("cadence_enrollment_id", enrollment_id).maybeSingle();
    if (byEnroll) convId = byEnroll.id;
    if (!convId) {
      const { data: newConv } = await supabase
        .from("conversations")
        .insert({ lead_id: enrollment.lead_id, company_id: companyId, channel: ch, cadence_enrollment_id: enrollment_id })
        .select("id").single();
      convId = newConv?.id || null;
    }
    if (!convId) throw new Error("could not create conversation");

    // Insert inbound (simulated) message
    await supabase.from("messages").insert({
      conversation_id: convId,
      content: reply_text,
      direction: "inbound",
      channel: ch,
      metadata: { simulated: true, source: "cadence_simulate" },
    });

    // Classify intent
    const { data: clf, error: clfErr } = await supabase.functions.invoke("classify-intent", {
      body: {
        company_id: companyId,
        lead_id: enrollment.lead_id,
        conversation_id: convId,
        message_content: reply_text,
        history: [],
      },
    });
    if (clfErr) console.error("classify-intent error", clfErr);

    const intentCategory = clf?.category || "info_request";
    const intentSub = clf?.sub_intent || null;

    // Load lead + recent history for the AI reply
    const [{ data: lead }, { data: histRows }] = await Promise.all([
      supabase.from("leads").select("name, company_name").eq("id", enrollment.lead_id).maybeSingle(),
      supabase.from("messages").select("direction, content").eq("conversation_id", convId).order("sent_at", { ascending: true }).limit(20),
    ]);

    // Generate AI reply
    let replyText: string | null = null;
    let replySubject: string | null = null;
    let replyMessageId: string | null = null;

    try {
      const { data: gen, error: genErr } = await supabase.functions.invoke("generate-reply", {
        body: {
          company_id: companyId,
          lead: { name: lead?.name, company_name: lead?.company_name },
          intent: { category: intentCategory, sub_intent: intentSub },
          history: histRows || [],
          channel: ch,
        },
      });
      if (genErr) console.error("generate-reply error", genErr);
      replyText = gen?.body || null;
      replySubject = gen?.subject || null;
    } catch (e) {
      console.error("generate-reply invoke failed", e);
    }

    if (replyText) {
      const { data: inserted } = await supabase.from("messages").insert({
        conversation_id: convId,
        content: replyText,
        direction: "outbound",
        channel: ch,
        ai_suggested: true,
        metadata: {
          simulated: true,
          source: "cadence_simulate",
          intent: intentCategory,
          subject: replySubject,
        },
      }).select("id").single();
      replyMessageId = inserted?.id || null;
    }

    return new Response(JSON.stringify({
      ok: true,
      intent: intentCategory,
      sub_intent: intentSub,
      conversation_id: convId,
      reply_text: replyText,
      reply_subject: replySubject,
      reply_message_id: replyMessageId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("cadence-simulate-reply error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
