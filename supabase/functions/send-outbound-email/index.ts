// Envia email outbound exclusivamente via Nylas (contas pessoais conectadas via OAuth).
// O envio via Resend/domínio da empresa foi descontinuado — o Resend segue apenas
// para RECEBIMENTO (MX/inbound webhook).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { sendMessage as nylasSendMessage } from "../_shared/nylas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Registra a tentativa de entrega para acompanhamento na ficha do lead/empresa.
async function logDelivery(supabase: any, row: Record<string, unknown>) {
  try {
    await supabase.from("email_delivery_log").insert(row);
  } catch (e) {
    console.error("email_delivery_log insert failed:", (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const {
      to, subject, html, text, lead_id, conversation_id,
      provider_thread_id, gmail_thread_id, // aceita nome antigo por compat
      company_id, extra_metadata,
      email_grant_id, // preferência explícita (cadência/aprovação)
    } = body ?? {};
    const threadId = provider_thread_id || gmail_thread_id || null;

    if (!to || !subject || (!html && !text)) {
      return jsonResponse({ error: "Campos obrigatórios: to, subject, html|text" }, 400);
    }

    // Resolve company_id a partir do conversation/lead se não vier explícito.
    let companyId: string | null = company_id ?? null;
    if (!companyId && conversation_id) {
      const { data: conv } = await supabase
        .from("conversations").select("company_id").eq("id", conversation_id).maybeSingle();
      companyId = conv?.company_id ?? null;
    }
    if (!companyId && lead_id) {
      const { data: lead } = await supabase
        .from("leads").select("company_id").eq("id", lead_id).maybeSingle();
      companyId = lead?.company_id ?? null;
    }
    if (!companyId) {
      return jsonResponse({ error: "company_id não resolvido" }, 400);
    }

    // ============================================================
    // Resolve o grant Nylas ativo:
    //   1) usa email_grant_id passado explicitamente (se ativo e da mesma empresa);
    //   2) senão, pega o grant ativo mais antigo da empresa.
    // ============================================================
    let grant: any = null;
    if (email_grant_id) {
      const { data } = await supabase
        .from("user_email_grants")
        .select("id, grant_id, email, display_name, status, company_id")
        .eq("id", email_grant_id)
        .maybeSingle();
      if (data && data.status === "active" && data.company_id === companyId) {
        grant = data;
      }
    }
    if (!grant) {
      const { data } = await supabase
        .from("user_email_grants")
        .select("id, grant_id, email, display_name, status, company_id")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      grant = data ?? null;
    }

    const deliverySource = (extra_metadata && typeof extra_metadata === "object")
      ? ((extra_metadata as any).source ?? null)
      : null;

    if (!grant) {
      await logDelivery(supabase, {
        company_id: companyId,
        lead_id: lead_id ?? null,
        conversation_id: conversation_id ?? null,
        recipient_email: String(to),
        subject: subject ?? null,
        provider: "nylas",
        status: "failed",
        error_message: "Nenhuma caixa de email pessoal (Nylas) conectada para esta empresa",
        source: deliverySource,
      });
      return jsonResponse({
        error: "Nenhuma caixa de email pessoal (Nylas) conectada para esta empresa",
        code: "no_active_email_grant",
      }, 412);
    }

    // Native threading via Nylas: use replyToMessageId if metadata provides it.
    const replyToMessageId = (extra_metadata && typeof extra_metadata === "object")
      ? (extra_metadata as any).nylas_reply_to_message_id ?? null
      : null;

    let sendResult;
    try {
      sendResult = await nylasSendMessage({
        grantId: grant.grant_id,
        to: String(to),
        fromName: grant.display_name || undefined,
        subject,
        bodyHtml: html || `<p>${escapeHtml(text)}</p>`,
        bodyText: text,
        replyToMessageId: replyToMessageId || undefined,
      });
    } catch (e) {
      const msg = (e as Error).message;
      console.error("nylas send failed:", msg);
      await supabase.from("user_email_grants")
        .update({ last_error: msg.slice(0, 500) })
        .eq("id", grant.id);
      await logDelivery(supabase, {
        company_id: companyId,
        lead_id: lead_id ?? null,
        conversation_id: conversation_id ?? null,
        recipient_email: String(to),
        subject: subject ?? null,
        provider: "nylas",
        from_email: grant.email,
        status: "failed",
        error_message: msg.slice(0, 500),
        source: deliverySource,
      });
      return jsonResponse({
        error: "Falha ao enviar via email pessoal",
        code: "nylas_send_failed",
        details: msg,
      }, 502);
    }

    // Persist outbound message
    let conversationId = conversation_id;
    if (!conversationId && lead_id) {
      const { data: existing } = await supabase
        .from("conversations").select("id")
        .eq("lead_id", lead_id).eq("channel", "email")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) conversationId = existing.id;
      else {
        const { data: newConv } = await supabase
          .from("conversations")
          .insert({ lead_id, company_id: companyId, channel: "email" })
          .select("id").single();
        conversationId = newConv?.id;
      }
    }

    if (conversationId) {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        content: text || html,
        direction: "outbound",
        ai_suggested: false,
        provider_message_id: sendResult.id,
        provider_thread_id: sendResult.thread_id || threadId,
        rfc_message_id: sendResult.message_id_header,
        email_provider: "nylas",
        metadata: {
          subject, channel: "email", via: "nylas",
          sender_email: grant.email,
          grant_id: grant.id,
          ...(extra_metadata && typeof extra_metadata === "object" ? extra_metadata : {}),
        },
      });
    }

    // Increment daily counter (warm-up tracking)
    const today = new Date().toISOString().slice(0, 10);
    const { data: cur } = await supabase
      .from("user_email_grants")
      .select("daily_sent_count, daily_sent_date")
      .eq("id", grant.id).maybeSingle();
    const sameDay = cur?.daily_sent_date === today;
    await supabase.from("user_email_grants").update({
      daily_sent_count: sameDay ? (cur?.daily_sent_count ?? 0) + 1 : 1,
      daily_sent_date: today,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    }).eq("id", grant.id);

    return jsonResponse({
      success: true,
      provider: "nylas",
      provider_message_id: sendResult.id,
      gmail_message_id: sendResult.id, // alias legado
      provider_thread_id: sendResult.thread_id || threadId,
      rfc_message_id: sendResult.message_id_header,
      conversation_id: conversationId,
      from: grant.email,
    });
  } catch (err) {
    console.error("send-outbound-email exception:", err);
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
