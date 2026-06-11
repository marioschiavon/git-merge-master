// Simula uma resposta do lead numa cadência inteligente em modo simulação.
// Cria mensagem inbound, classifica intent, retorna o resultado.
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

    // Insert inbound message
    await supabase.from("messages").insert({
      conversation_id: convId,
      content: reply_text,
      direction: "inbound",
      metadata: { simulated: true, source: "cadence_simulate" },
    });

    // Classify intent (uses service role internally)
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

    return new Response(JSON.stringify({
      ok: true,
      intent: clf?.category || null,
      sub_intent: clf?.sub_intent || null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("cadence-simulate-reply error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
