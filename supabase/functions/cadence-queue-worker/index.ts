import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function retryDelayMinutes(attempts: number) {
  return Math.min(30, Math.max(2, attempts * 5));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Backend não configurado" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const requestedBatchSize = Number(body?.batch_size || DEFAULT_BATCH_SIZE);
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Number.isFinite(requestedBatchSize) ? requestedBatchSize : DEFAULT_BATCH_SIZE));
  const cadenceId = typeof body?.cadence_id === "string" ? body.cadence_id : null;
  const workerId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  try {
    let queueQuery = supabase
      .from("cadence_execution_queue")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", nowIso)
      .order("scheduled_for", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (cadenceId) queueQuery = queueQuery.eq("cadence_id", cadenceId);

    const { data: items, error: queueError } = await queueQuery;
    if (queueError) throw queueError;

    const results: Array<Record<string, unknown>> = [];

    for (const item of items || []) {
      const attempts = (item.attempts || 0) + 1;
      const claimTime = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabase
        .from("cadence_execution_queue")
        .update({
          status: "processing",
          attempts,
          locked_at: claimTime,
          locked_by: workerId,
          started_at: item.started_at || claimTime,
          last_error: null,
        })
        .eq("id", item.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();

      if (claimError) {
        results.push({ id: item.id, status: "claim_error", error: claimError.message });
        continue;
      }
      if (!claimed) {
        results.push({ id: item.id, status: "already_claimed" });
        continue;
      }

      try {
        const { data: enrollment, error: enrollmentError } = await supabase
          .from("cadence_enrollments")
          .select("id, status, meeting_scheduled")
          .eq("id", claimed.enrollment_id)
          .maybeSingle();

        if (enrollmentError) throw enrollmentError;
        if (!enrollment || enrollment.status !== "active" || enrollment.meeting_scheduled === true) {
          await supabase
            .from("cadence_execution_queue")
            .update({
              status: "cancelled",
              finished_at: new Date().toISOString(),
              last_error: "Enrollment não está ativo ou já tem reunião marcada",
            })
            .eq("id", claimed.id);
          results.push({ id: claimed.id, status: "cancelled" });
          continue;
        }

        await supabase
          .from("cadence_enrollments")
          .update({ next_execution_at: new Date(Date.now() - 1000).toISOString() })
          .eq("id", claimed.enrollment_id)
          .eq("status", "active");

        const { data: executorData, error: executorError } = await supabase.functions.invoke("cadence-executor", {
          body: {
            enrollment_id: claimed.enrollment_id,
            force_now: true,
            queue_item_id: claimed.id,
          },
        });

        if (executorError) {
          throw new Error(executorError.message || JSON.stringify(executorError));
        }

        const processed = Number(executorData?.processed || 0);
        if (processed <= 0) {
          throw new Error("Executor não processou o enrollment");
        }

        await supabase
          .from("cadence_execution_queue")
          .update({
            status: "done",
            finished_at: new Date().toISOString(),
            last_error: null,
            metadata: {
              ...(claimed.metadata || {}),
              executor_result: executorData,
            },
          })
          .eq("id", claimed.id);

        results.push({ id: claimed.id, status: "done", processed });
      } catch (itemError) {
        const message = itemError instanceof Error ? itemError.message : "Erro desconhecido";
        if (attempts < MAX_ATTEMPTS) {
          const retryAt = new Date(Date.now() + retryDelayMinutes(attempts) * 60 * 1000).toISOString();
          await supabase
            .from("cadence_execution_queue")
            .update({
              status: "pending",
              scheduled_for: retryAt,
              locked_at: null,
              locked_by: null,
              last_error: message,
            })
            .eq("id", claimed.id);
          results.push({ id: claimed.id, status: "retry", retry_at: retryAt, error: message });
        } else {
          await supabase
            .from("cadence_execution_queue")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              last_error: message,
            })
            .eq("id", claimed.id);
          results.push({ id: claimed.id, status: "failed", error: message });
        }
      }
    }

    return json({ worker_id: workerId, picked: items?.length || 0, results });
  } catch (error) {
    console.error("cadence-queue-worker error:", error);
    return json({ error: error instanceof Error ? error.message : "Erro desconhecido" }, 500);
  }
});