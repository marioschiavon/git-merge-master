import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sends a gentle 2-day follow-up to leads who said "I'll forward internally"
// (referral_stage='aguardando_encaminhamento_interno') and have not yet been pinged.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, name, email, phone, whatsapp, company_id, company_name, referral_context")
      .eq("referral_stage", "aguardando_encaminhamento_interno")
      .is("referral_followup_sent_at", null)
      .lte("updated_at", twoDaysAgo)
      .limit(50);

    if (error) throw error;

    const results: any[] = [];
    for (const lead of leads || []) {
      try {
        // Latest conversation for this lead
        const { data: conv } = await supabase
          .from("conversations")
          .select("id, channel")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const channel = conv?.channel || "email";
        const msg = `Oi ${lead.name?.split(" ")[0] || ""}! Tudo bem? Só passando para saber se conseguiu encaminhar para o responsável. Sem pressão — se precisar de algum material para apoiar, é só me avisar. Obrigado!`;

        if (channel === "email" && lead.email && conv?.id) {
          // Reuse gmail-send (shared workspace connector Gmail — always available)
          {
            // Pull last rfc id for threading
            const { data: priorMsgs } = await supabase
              .from("messages")
              .select("rfc_message_id, metadata")
              .eq("conversation_id", conv.id)
              .not("rfc_message_id", "is", null)
              .order("sent_at", { ascending: true });

            const lastRfc = priorMsgs?.[priorMsgs.length - 1]?.rfc_message_id || null;
            const allRfc = (priorMsgs || []).map((m: any) => m.rfc_message_id).filter(Boolean);
            const subjectBase = (priorMsgs || []).map((m: any) => m.metadata?.subject).find((s: any) => typeof s === "string") || (lead.company_name || lead.name || "Acompanhamento");
            const subject = /^re:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;

            await supabase.functions.invoke("gmail-send", {
              body: {
                to: lead.email,
                subject,
                text: msg,
                conversation_id: conv.id,
                company_id: lead.company_id,
                lead_id: lead.id,
                in_reply_to_rfc_id: lastRfc,
                references: allRfc.length ? allRfc.join(" ") : lastRfc,
              },
            });
          }
        } else if (conv?.id) {
          await supabase.from("messages").insert({
            conversation_id: conv.id,
            content: msg,
            direction: "outbound",
            ai_suggested: true,
            metadata: { referral_followup: true, channel, pending_send: channel !== "email" },
          });
        }

        await supabase
          .from("leads")
          .update({ referral_followup_sent_at: new Date().toISOString() } as any)
          .eq("id", lead.id);

        await supabase.from("lead_activities").insert({
          company_id: lead.company_id,
          lead_id: lead.id,
          type: "referral",
          description: "🔁 Follow-up automático com indicador (2 dias)",
          metadata: { referral_followup: true, channel },
        });

        results.push({ lead_id: lead.id, sent: true });
      } catch (e) {
        console.error("Follow-up error for lead", lead.id, e);
        results.push({ lead_id: lead.id, sent: false, error: (e as Error).message });
      }
    }

    return new Response(JSON.stringify({ processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("referral-followup-cron exception:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
