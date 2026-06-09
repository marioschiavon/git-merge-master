import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Worker that dispatches a single action from lead_action_queue.
 * Accepts either { action_id } (load from queue) or { action_type, params, lead_id, company_id } (inline).
 * Marks queue row as done/failed when invoked with action_id.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    let actionRow: any = null;

    if (body.action_id) {
      const { data, error } = await supabase
        .from("lead_action_queue")
        .select("*")
        .eq("id", body.action_id)
        .maybeSingle();
      if (error || !data) {
        return new Response(JSON.stringify({ error: "ação não encontrada" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      actionRow = data;
    } else {
      actionRow = {
        id: null,
        company_id: body.company_id,
        lead_id: body.lead_id,
        conversation_id: body.conversation_id || null,
        action_type: body.action_type,
        params: body.params || {},
      };
    }

    const { action_type, params = {}, lead_id, company_id, conversation_id } = actionRow;
    let result: any = { ok: true };
    let error: string | null = null;

    try {
      switch (action_type) {
        case "update_lead_score": {
          const delta = Number(params.delta) || 0;
          const { data: l } = await supabase.from("leads").select("score").eq("id", lead_id).maybeSingle();
          const newScore = (l?.score || 0) + delta;
          await supabase.from("leads").update({ score: newScore }).eq("id", lead_id);
          result = { new_score: newScore, delta };
          break;
        }
        case "disqualify_lead": {
          await supabase.from("leads").update({ status: "lost" as any }).eq("id", lead_id);
          result = { status: "lost" };
          break;
        }
        case "mark_opt_out": {
          await supabase.from("leads").update({ status: "lost" as any }).eq("id", lead_id);
          if ((actionRow as any).lead_email || params.email) {
            const email = params.email || (actionRow as any).lead_email;
            await supabase.from("suppressed_emails").upsert({ email, reason: "opt_out" } as any);
          }
          result = { opted_out: true };
          break;
        }
        case "stop_sequence": {
          await supabase
            .from("cadence_enrollments")
            .update({ status: "paused", paused_reason: "opt_out_or_rejection" } as any)
            .eq("lead_id", lead_id)
            .in("status", ["active", "paused"]);
          result = { paused: true };
          break;
        }
        case "handoff_to_human": {
          await supabase
            .from("leads")
            .update({ handoff_required: true, handoff_reason: params.reason || "intent_escalation", handoff_at: new Date().toISOString() } as any)
            .eq("id", lead_id);
          result = { handoff: true };
          break;
        }
        case "schedule_followup": {
          const days = Number(params.days) || 2;
          const scheduledFor = new Date(Date.now() + days * 86400000).toISOString();
          await supabase.from("lead_action_queue").insert({
            company_id, lead_id, conversation_id,
            action_type: "send_reply" as any,
            params: { followup: true, ...(params.message ? { message: params.message } : {}) },
            scheduled_for: scheduledFor,
            triggered_by: "schedule_followup",
          });
          result = { scheduled_for: scheduledFor };
          break;
        }
        case "send_reply": {
          // If params.message provided, send directly; otherwise mark as pending for human review
          if (!params.message) {
            result = { skipped: "no message provided — expected generate-reply first" };
          } else {
            await supabase.from("messages").insert({
              conversation_id,
              content: params.message,
              direction: "outbound",
              ai_suggested: true,
              metadata: { source: "execute-action", action_type } as any,
            });
            result = { sent: true };
          }
          break;
        }
        case "create_new_contact":
        case "mark_current_contact_as_referrer":
        case "send_material":
        case "send_email":
        case "send_calendar_link":
        case "suggest_meeting_times":
        case "create_cal_booking":
        case "ask_clarifying_question":
        case "create_call_task":
        case "recover_no_show":
        case "request_info_from_lead": {
          // Stubs: log as pending-human or no-op until wired to specific integrations
          result = { stub: true, action_type, note: "Ação registrada — integração específica pendente" };
          break;
        }
        default:
          error = `action_type desconhecido: ${action_type}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    if (actionRow.id) {
      await supabase.from("lead_action_queue").update({
        status: error ? "failed" : "done",
        executed_at: new Date().toISOString(),
        attempts: ((actionRow as any).attempts || 0) + 1,
        result,
        error,
      }).eq("id", actionRow.id);
    }

    return new Response(JSON.stringify({ ok: !error, result, error }), {
      status: error ? 500 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("execute-action error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
