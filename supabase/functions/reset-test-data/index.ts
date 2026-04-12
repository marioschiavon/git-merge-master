import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claimsData, error: claimsErr } = await supabaseUser.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claimsData.claims.sub;

    // Get company_id
    const { data: member } = await supabaseAdmin
      .from("company_members")
      .select("company_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!member?.company_id) {
      return new Response(JSON.stringify({ error: "No company found" }), { status: 400, headers: corsHeaders });
    }

    const companyId = member.company_id;

    // 1. Delete messages for company conversations
    const { data: convIds } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("company_id", companyId);

    if (convIds && convIds.length > 0) {
      const ids = convIds.map((c: any) => c.id);
      await supabaseAdmin.from("messages").delete().in("conversation_id", ids);
    }

    // 2. Delete conversations
    await supabaseAdmin.from("conversations").delete().eq("company_id", companyId);

    // 3. Delete slot_holds
    await supabaseAdmin.from("slot_holds").delete().eq("company_id", companyId);

    // 4. Delete meeting activities
    await supabaseAdmin.from("lead_activities").delete().eq("company_id", companyId).eq("type", "meeting");

    // 5. Reset enrollments that had meetings
    const { data: enrollments } = await supabaseAdmin
      .from("cadence_enrollments")
      .select("id")
      .eq("company_id", companyId)
      .eq("meeting_scheduled", true);

    if (enrollments && enrollments.length > 0) {
      for (const e of enrollments) {
        await supabaseAdmin
          .from("cadence_enrollments")
          .update({ status: "active", meeting_scheduled: false, completed_at: null })
          .eq("id", e.id);
      }
    }

    return new Response(JSON.stringify({ success: true, company_id: companyId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("reset-test-data error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
