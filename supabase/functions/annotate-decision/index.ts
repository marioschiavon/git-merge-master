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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const decision_id = (body?.decision_id || "").toString();
    const note = (body?.note || "").toString().trim();
    if (!decision_id || !note) {
      return new Response(JSON.stringify({ error: "decision_id and note are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: decision } = await supabase
      .from("cadence_agent_decisions").select("*").eq("id", decision_id).maybeSingle();
    if (!decision) {
      return new Response(JSON.stringify({ error: "decision not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const company_id: string = decision.company_id;
    const lead_id: string | null = decision.lead_id || null;

    // Snapshot
    let lead: any = null;
    if (lead_id) {
      const { data } = await supabase.from("leads")
        .select("id, name, email, company_name, stage, metadata, whatsapp, phone")
        .eq("id", lead_id).maybeSingle();
      lead = data || null;
    }

    let conversation_id: string | null = null;
    let recent_messages: any[] = [];
    if (lead_id) {
      const { data: convs } = await supabase
        .from("conversations").select("id").eq("lead_id", lead_id)
        .order("created_at", { ascending: false }).limit(5);
      const convIds = (convs || []).map((c: any) => c.id);
      conversation_id = convIds[0] || null;
      if (convIds.length) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("id, conversation_id, direction, content, sent_at, metadata")
          .in("conversation_id", convIds)
          .order("sent_at", { ascending: false })
          .limit(20);
        recent_messages = (msgs || []).reverse();
      }
    }

    const context_snapshot = {
      decision: {
        id: decision.id,
        action: decision.action,
        channel: decision.channel,
        hook: decision.hook ?? null,
        subject: decision.subject ?? null,
        message: decision.message ?? decision.body ?? null,
        rationale: decision.rationale ?? null,
        intent: decision.intent ?? null,
        confidence: decision.confidence ?? null,
        cadence_id: decision.cadence_id ?? null,
        enrollment_id: decision.enrollment_id ?? null,
        decided_at: decision.decided_at ?? decision.created_at ?? null,
      },
      lead,
      recent_messages,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("message_annotations")
      .insert({
        company_id,
        author_user_id: userId,
        source_kind: "cadence_agent_decision",
        source_id: decision.id,
        lead_id,
        conversation_id,
        note,
        human_action: "none",
        final_content: decision.message ?? null,
        context_snapshot,
      })
      .select("id").single();
    if (insErr) throw new Error(insErr.message);

    return new Response(JSON.stringify({ ok: true, id: inserted.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("annotate-decision fatal:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
