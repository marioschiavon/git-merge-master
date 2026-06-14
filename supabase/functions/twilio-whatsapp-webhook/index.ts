// Webhook público que recebe mensagens de entrada do Twilio WhatsApp.
// Roteia para a empresa correta pelo número "To" e encaminha para inbound-webhook.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(s: string | null): string | null {
  if (!s) return null;
  const v = String(s).trim().replace(/^whatsapp:/i, "");
  return v.startsWith("+") ? v : `+${v.replace(/\D/g, "")}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Twilio sempre envia x-www-form-urlencoded
    const formData = await req.formData();
    const fromRaw = formData.get("From")?.toString() || null;
    const toRaw = formData.get("To")?.toString() || null;
    const body = formData.get("Body")?.toString() || "";
    const messageSid = formData.get("MessageSid")?.toString() || null;

    const fromPhone = normalizePhone(fromRaw);
    const toPhone = normalizePhone(toRaw);

    console.log("twilio-webhook in:", { fromPhone, toPhone, sid: messageSid, len: body.length });

    if (!fromPhone || !body) {
      return new Response("<Response/>", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/xml" },
      });
    }

    // Encontrar a empresa pelo número de WhatsApp (To)
    const { data: integrations } = await supabase
      .from("integrations")
      .select("company_id, config")
      .eq("provider", "twilio_whatsapp")
      .eq("status", "active");

    let companyId: string | null = null;
    for (const row of integrations || []) {
      const cfg = (row as any).config || {};
      if (normalizePhone(cfg.whatsapp_number) === toPhone) {
        companyId = row.company_id;
        break;
      }
    }
    // Fallback: se só houver uma empresa configurada (caso sandbox compartilhado)
    if (!companyId && (integrations || []).length === 1) {
      companyId = integrations![0].company_id;
    }
    if (!companyId) {
      console.warn("Nenhuma empresa encontrada para To=", toPhone);
      return new Response("<Response/>", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/xml" },
      });
    }

    // Encontrar lead pelo whatsapp ou telefone dentro da empresa
    const { data: leads } = await supabase
      .from("leads")
      .select("id, phone, whatsapp")
      .eq("company_id", companyId)
      .or("phone.not.is.null,whatsapp.not.is.null");

    const lead = (leads || []).find((l: any) => {
      const candidates = [l.whatsapp, l.phone].filter(Boolean).map(normalizePhone);
      return candidates.some((c) => c === fromPhone || (c && c.endsWith(fromPhone.slice(-10))));
    });


    if (!lead) {
      console.warn("Lead não encontrado para telefone:", fromPhone, "company:", companyId);
      // Registra mesmo assim em uma conversa órfã? Por ora, ignora.
      return new Response("<Response/>", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/xml" },
      });
    }

    // Garantir conversa de whatsapp existente, OU reaproveitar a mais recente
    let { data: conv } = await supabase
      .from("conversations")
      .select("id")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!conv) {
      const { data: newConv } = await supabase
        .from("conversations")
        .insert({ lead_id: lead.id, company_id: companyId, channel: "whatsapp" })
        .select("id")
        .single();
      conv = newConv;
    }

    // Dedup por provider_message_id (Twilio MessageSid). Se já existir, ignora.
    if (messageSid) {
      const { data: dup } = await supabase
        .from("messages")
        .select("id")
        .eq("provider", "twilio")
        .eq("provider_message_id", messageSid)
        .maybeSingle();
      if (dup) {
        console.log("twilio-webhook: duplicate MessageSid, skipping:", messageSid);
        return new Response("<Response/>", {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/xml" },
        });
      }
    }

    // Inserir mensagem com channel='whatsapp'
    await supabase.from("messages").insert({
      conversation_id: conv!.id,
      content: body,
      direction: "inbound",
      channel: "whatsapp",
      ai_suggested: false,
      metadata: { twilio_sid: messageSid, from: fromPhone, to: toPhone },
      provider: "twilio",
      provider_message_id: messageSid,
    });

    // Encaminha para o pipeline padrão (intenção, IA, etc.) pulando insert duplicado
    const invokeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/inbound-webhook`;
    fetch(invokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        lead_id: lead.id,
        conversation_id: conv!.id,
        content: body,
        channel: "whatsapp",
        skip_insert: true,
        provider: "twilio",
        provider_message_id: messageSid,
      }),
    }).catch((e) => console.error("inbound-webhook forward error:", e));

    // Resposta vazia obrigatória para Twilio
    return new Response("<Response/>", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  } catch (e: any) {
    console.error("twilio-whatsapp-webhook error:", e);
    return new Response("<Response/>", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/xml" },
    });
  }
});
