// Cron worker: processa enrollments com first_message_status='pending_generation'.
// Gera a 1ª mensagem via buildFirstMessage e cria approval_request (kind='first_message').
// Quando a cadência tem auto_approve_first_message=true e o limite diário ainda permite,
// marca a approval_request como 'approved' (auto-aprovação). O envio efetivo segue o
// fluxo padrão (approval-execute / cadence-executor).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildFirstMessage } from "../_shared/build-first-message.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const BATCH = 8;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: pending, error } = await supabase
    .from("cadence_enrollments")
    .select("id, lead_id, cadence_id, company_id")
    .eq("first_message_status", "pending_generation")
    .order("enrolled_at", { ascending: true })
    .limit(BATCH);

  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];
  for (const enr of pending || []) {
    try {
      await supabase
        .from("cadence_enrollments")
        .update({ first_message_status: "generating" })
        .eq("id", enr.id);

      const [{ data: lead }, { data: cadence }] = await Promise.all([
        supabase.from("leads").select("*").eq("id", enr.lead_id).maybeSingle(),
        supabase.from("cadences").select("*").eq("id", enr.cadence_id).maybeSingle(),
      ]);
      if (!lead || !cadence) {
        await supabase
          .from("cadence_enrollments")
          .update({ first_message_status: "failed" })
          .eq("id", enr.id);
        results.push({ id: enr.id, error: "lead/cadence not found" });
        continue;
      }

      const channel: "email" | "whatsapp" = (cadence.type === "whatsapp") ? "whatsapp" : "email";

      const built = await buildFirstMessage({
        supabase,
        lovableApiKey: LOVABLE_API_KEY,
        companyId: enr.company_id,
        lead,
        channel,
      });

      // Resolve batch_id e quota diária
      let batchId: string | null = null;
      const { data: ld } = await supabase
        .from("leads").select("lead_list_id").eq("id", enr.lead_id).maybeSingle();
      if (ld?.lead_list_id) batchId = ld.lead_list_id;

      const auto = !!cadence.auto_approve_first_message;
      let allowAuto = false;
      if (auto) {
        const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
        const { count } = await supabase
          .from("approval_requests")
          .select("id", { count: "exact", head: true })
          .eq("cadence_id", enr.cadence_id)
          .eq("kind", "first_message")
          .eq("status", "approved")
          .gte("approved_at", startOfDay.toISOString());
        const max = cadence.auto_approve_max_per_day ?? 50;
        allowAuto = (count ?? 0) < max;
      }

      const initialStatus = allowAuto ? "approved" : "pending";

      const insertRow: any = {
        company_id: enr.company_id,
        lead_id: enr.lead_id,
        enrollment_id: enr.id,
        cadence_id: enr.cadence_id,
        kind: "first_message",
        channel,
        action: "send",
        payload: { subject: built.subject, body: built.message, step_index: 0 },
        context: { source: "batch_pipeline", auto_approved: allowAuto },
        status: initialStatus,
        batch_id: batchId,
      };
      if (allowAuto) {
        insertRow.approved_at = new Date().toISOString();
      }

      await supabase.from("approval_requests").insert(insertRow);

      await supabase
        .from("cadence_enrollments")
        .update({ first_message_status: allowAuto ? "auto_approved" : "pending_approval" })
        .eq("id", enr.id);

      await supabase.from("lead_activities").insert({
        company_id: enr.company_id,
        lead_id: enr.lead_id,
        type: "system",
        description: allowAuto
          ? "⚡ 1ª mensagem gerada e auto-aprovada (modo full-auto)"
          : "✍️ 1ª mensagem gerada — aguardando aprovação",
        metadata: { cadence_id: enr.cadence_id, enrollment_id: enr.id, auto: allowAuto },
      });

      results.push({ id: enr.id, ok: true, auto: allowAuto });
    } catch (e) {
      console.error("generate-pending-first-messages error", e);
      await supabase
        .from("cadence_enrollments")
        .update({ first_message_status: "failed" })
        .eq("id", enr.id);
      results.push({ id: enr.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ processed: results.length, results });
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
