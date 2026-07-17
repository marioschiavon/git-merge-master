import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { enqueueWhatsAppSend } from "../_shared/whatsapp-pacer.ts";
import { getEmailReplyContext } from "../_shared/email-thread.ts";

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
    const { approval_id, action, edited_payload, rejection_reason, note } = body as {
      approval_id: string;
      action: "approve" | "reject";
      edited_payload?: Record<string, any>;
      rejection_reason?: string;
      note?: string;
    };
    if (!approval_id || !action) {
      return new Response(JSON.stringify({ error: "missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const trimmedNote = (note || "").toString().trim();
    const trimmedReason = (rejection_reason || "").toString().trim();

    const { data: approval } = await supabase
      .from("approval_requests").select("*").eq("id", approval_id).maybeSingle();
    if (!approval || approval.status !== "pending") {
      return new Response(JSON.stringify({ error: "approval not found or not pending" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper: persist annotation for approve/reject flows.
    async function saveAnnotation(params: {
      human_action: "approved" | "edited" | "rejected";
      final_content: string | null;
      edited_payload_in?: Record<string, any> | null;
      execution_error?: string | null;
      note_text: string;
    }) {
      try {
        let recent_messages: any[] = [];
        if (approval.conversation_id) {
          const { data: msgs } = await supabase
            .from("messages")
            .select("id, conversation_id, direction, content, sent_at, metadata")
            .eq("conversation_id", approval.conversation_id)
            .order("sent_at", { ascending: false })
            .limit(20);
          recent_messages = (msgs || []).reverse();
        }
        let lead: any = null;
        if (approval.lead_id) {
          const { data } = await supabase.from("leads")
            .select("id, name, email, company_name, stage, metadata")
            .eq("id", approval.lead_id).maybeSingle();
          lead = data || null;
        }
        await supabase.from("message_annotations").insert({
          company_id: approval.company_id,
          author_user_id: userId,
          source_kind: "approval_request",
          source_id: approval.id,
          lead_id: approval.lead_id,
          conversation_id: approval.conversation_id,
          note: params.note_text,
          human_action: params.human_action,
          final_content: params.final_content,
          context_snapshot: {
            approval: {
              id: approval.id,
              kind: approval.kind,
              channel: approval.channel,
              action: approval.action,
              original_payload: approval.payload,
              edited_payload: params.edited_payload_in || null,
              context: approval.context || {},
              cadence_id: approval.cadence_id,
              enrollment_id: approval.enrollment_id,
            },
            rejection_reason: params.human_action === "rejected" ? (trimmedReason || null) : null,
            execution_error: params.execution_error ?? null,
            lead,
            recent_messages,
          },
        });
      } catch (annotErr: any) {
        console.error("annotation save failed:", annotErr?.message || annotErr);
      }
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
          description: `❌ Aprovação rejeitada — operador assumiu a conversa${rejection_reason ? ": " + rejection_reason : ""}`,
          metadata: { approval_id, kind: approval.kind, human_takeover: true },
        });
      }

      // Pausa o enrollment ligado e ATIVA o human_takeover na conversa para que
      // a IA não tente responder nem disparar o próximo passo. O operador assume.
      if (approval.enrollment_id && (approval.kind === "first_message" || approval.kind === "cadence_step")) {
        await supabase.from("cadence_enrollments").update({
          status: "paused",
          paused_reason: "hitl_rejected",
          next_execution_at: null,
        }).eq("id", approval.enrollment_id);
      }
      if (approval.conversation_id) {
        await supabase.from("conversations").update({
          human_takeover: true,
          human_taken_at: new Date().toISOString(),
          human_taken_by: userId,
          human_takeover_reason: "rejected_approval",
        }).eq("id", approval.conversation_id);
      }
      if (approval.lead_id) {
        await supabase
          .from("pending_inbound_runs")
          .update({ status: "cancelled", last_error: "human_takeover" })
          .eq("lead_id", approval.lead_id)
          .in("status", ["pending", "running"]);
      }

      // Salva anotação sempre que houver nota ou motivo — vira aprendizado para a IA.
      const rejectNote = trimmedNote || trimmedReason;
      if (rejectNote) {
        await saveAnnotation({
          human_action: "rejected",
          final_content: null,
          edited_payload_in: null,
          execution_error: null,
          note_text: rejectNote,
        });
      }

      return new Response(JSON.stringify({ ok: true, takeover: true, conversation_id: approval.conversation_id }), {
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
          const threadCtx = await getEmailReplyContext(supabase, conversationId);
          const { error: sendErr } = await supabase.functions.invoke("send-outbound-email", {
            body: {
              to: lead.email,
              subject: threadCtx.reply_subject || subject || "Continuando nossa conversa",
              html: message.replace(/\n/g, "<br/>"),
              text: message,
              lead_id: approval.lead_id,
              company_id: approval.company_id,
              conversation_id: conversationId,
              in_reply_to_rfc_id: threadCtx.in_reply_to_rfc_id,
              references: threadCtx.references,
              provider_thread_id: threadCtx.provider_thread_id,
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

    // Save annotation if user provided a note
    if (trimmedNote) {
      await saveAnnotation({
        human_action: isEdited ? "edited" : "approved",
        final_content: finalPayload.message ?? finalPayload.body ?? null,
        edited_payload_in: edited_payload || null,
        execution_error: executionError,
        note_text: trimmedNote,
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
