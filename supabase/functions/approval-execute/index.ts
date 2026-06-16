import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getZApiConfig, sendWhatsAppViaZApi } from "../_shared/zapi-whatsapp.ts";

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

    // Authenticate the caller
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
    const { approval_id, action, edited_payload, rejection_reason } = body as {
      approval_id: string;
      action: "approve" | "reject";
      edited_payload?: Record<string, any>;
      rejection_reason?: string;
    };
    if (!approval_id || !action) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: approval } = await supabase
      .from("approval_requests").select("*").eq("id", approval_id).maybeSingle();
    if (!approval || approval.status !== "pending") {
      return new Response(JSON.stringify({ error: "approval not found or not pending" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === Reject ===
    if (action === "reject") {
      await supabase.from("approval_requests").update({
        status: "rejected",
        rejection_reason: rejection_reason || null,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      }).eq("id", approval_id);

      if (approval.lead_id) {
        await supabase.from("lead_activities").insert({
          company_id: approval.company_id,
          lead_id: approval.lead_id,
          type: "system",
          description: `❌ Aprovação rejeitada${rejection_reason ? ": " + rejection_reason : ""}`,
          metadata: { approval_id, kind: approval.kind },
        });
      }

      // For cadence steps: pause the enrollment so it doesn't keep re-firing.
      if (approval.enrollment_id && (approval.kind === "first_message" || approval.kind === "cadence_step")) {
        await supabase.from("cadence_enrollments").update({
          status: "paused",
          paused_reason: "hitl_rejected",
          next_execution_at: null,
        }).eq("id", approval.enrollment_id);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === Approve (with optional edits) ===
    const finalPayload = { ...(approval.payload || {}), ...(edited_payload || {}) };
    const isEdited = !!edited_payload && Object.keys(edited_payload).length > 0;

    // Send according to kind
    let executionError: string | null = null;

    try {
      if (approval.kind === "first_message" || approval.kind === "cadence_step") {
        const isAgentic = !!(approval.payload?.agentic) || !finalPayload.step_id;

        if (isAgentic && approval.enrollment_id) {
          // Agentic cadence: reactivate enrollment and re-invoke decider with override.
          await supabase.from("cadence_enrollments").update({
            status: "active",
            paused_reason: null,
            next_execution_at: new Date().toISOString(),
          }).eq("id", approval.enrollment_id);

          await supabase.functions.invoke("cadence-agent-decide", {
            body: {
              enrollment_id: approval.enrollment_id,
              bypass_hitl: true,
              override_decision: {
                action: "send",
                channel: approval.channel,
                hook: finalPayload.hook || null,
                subject: finalPayload.subject ?? null,
                message: finalPayload.message ?? finalPayload.body ?? "",
                rationale: "Aprovado por humano via HITL.",
              },
            },
          });
        } else if (approval.enrollment_id && finalPayload.step_id) {
          // Step-based cadence: save custom message and trigger executor with bypass.
          await supabase.from("cadence_custom_messages").upsert({
            enrollment_id: approval.enrollment_id,
            step_id: finalPayload.step_id,
            lead_id: approval.lead_id,
            company_id: approval.company_id,
            subject: finalPayload.subject ?? null,
            message: finalPayload.message ?? finalPayload.body ?? "",
          }, { onConflict: "enrollment_id,step_id" });

          await supabase.from("cadence_enrollments").update({
            next_execution_at: new Date().toISOString(),
            status: "active",
            paused_reason: null,
          }).eq("id", approval.enrollment_id);

          await supabase.functions.invoke("cadence-executor", {
            body: { enrollment_id: approval.enrollment_id, bypass_hitl: true },
          });
        }
      } else if (approval.kind === "sdr_reply" || approval.kind === "sensitive_action") {
        // Send directly through gmail/zapi based on channel.
        const channel = approval.channel || "email";
        const subject = finalPayload.subject ?? null;
        const message = finalPayload.message ?? finalPayload.body ?? "";
        const conversationId = approval.conversation_id;

        if (channel === "email") {
          const { data: lead } = await supabase
            .from("leads").select("email").eq("id", approval.lead_id).maybeSingle();
          if (!lead?.email) throw new Error("lead sem email");
          const { error: sendErr } = await supabase.functions.invoke("gmail-send", {
            body: {
              to: lead.email,
              subject: subject || "Continuando nossa conversa",
              html: message.replace(/\n/g, "<br/>"),
              text: message,
              lead_id: approval.lead_id,
              company_id: approval.company_id,
              conversation_id: conversationId,
              extra_metadata: { approval_id, hitl_approved: true },
            },
          });
          if (sendErr) throw new Error(sendErr.message);
        } else if (channel === "whatsapp") {
          const { data: lead } = await supabase
            .from("leads").select("whatsapp, phone").eq("id", approval.lead_id).maybeSingle();
          const to = lead?.whatsapp || lead?.phone;
          if (!to) throw new Error("lead sem whatsapp/phone");
          const cfg = await getZApiConfig(supabase, approval.company_id);
          if (!cfg) throw new Error("z-api não configurada");
          const r = await sendWhatsAppViaZApi(cfg, to, message);
          if (!r.ok) throw new Error(r.error || `zapi http ${r.status}`);
          if (conversationId) {
            await supabase.from("messages").insert({
              conversation_id: conversationId,
              content: message,
              direction: "outbound",
              ai_suggested: true,
              metadata: { approval_id, hitl_approved: true, zapi_message_id: r.sid, channel },
            });
          }
        } else {
          // linkedin / manual
          if (conversationId) {
            await supabase.from("messages").insert({
              conversation_id: conversationId,
              content: message,
              direction: "outbound",
              ai_suggested: true,
              metadata: { approval_id, hitl_approved: true, channel, pending_manual: true },
            });
          }
        }
      }
    } catch (e: any) {
      executionError = e?.message || String(e);
      console.error("approval execution failed:", executionError);
    }

    await supabase.from("approval_requests").update({
      status: executionError ? "failed" : (isEdited ? "edited_sent" : "approved"),
      edited_payload: isEdited ? edited_payload : null,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      execution_error: executionError,
    }).eq("id", approval_id);

    if (approval.lead_id) {
      await supabase.from("lead_activities").insert({
        company_id: approval.company_id,
        lead_id: approval.lead_id,
        type: "system",
        description: executionError
          ? `⚠️ Aprovação executada com erro: ${executionError}`
          : (isEdited ? "✅ Aprovação enviada (com edições)" : "✅ Aprovação enviada"),
        metadata: { approval_id, kind: approval.kind, channel: approval.channel },
      });
    }

    return new Response(JSON.stringify({ ok: !executionError, error: executionError }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("approval-execute fatal:", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
