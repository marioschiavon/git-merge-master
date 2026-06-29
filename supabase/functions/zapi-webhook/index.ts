// Webhook público que recebe mensagens de entrada da Z-API (evento "ReceivedCallback").
// Roteia para a empresa correta pelo instanceId e encaminha para inbound-webhook.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toE164(digits: string | null | undefined): string | null {
  if (!digits) return null;
  const onlyDigits = String(digits).replace(/\D/g, "");
  if (!onlyDigits) return null;
  return `+${onlyDigits}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const payload = await req.json().catch(() => ({} as any));
    // Z-API payload (texto): { type:"ReceivedCallback", instanceId, messageId, phone, fromMe, text:{ message } , ... }
    const type = payload?.type || null;
    const fromMe = !!payload?.fromMe;
    const instanceId = payload?.instanceId || payload?.instance_id || null;
    const messageId = payload?.messageId || null;
    const phoneRaw = payload?.phone || null;
    const text: string =
      payload?.text?.message ||
      payload?.message?.text ||
      payload?.body ||
      "";

    const fromPhone = toE164(phoneRaw);

    console.log("zapi-webhook in:", { type, instanceId, fromPhone, fromMe, messageId, len: text.length });

    // Ignora callbacks que não são de mensagem recebida
    if (fromMe || !fromPhone || !text) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Encontra a empresa pelo instance_id na config da integração
    const { data: integrations } = await supabase
      .from("integrations")
      .select("company_id, config")
      .eq("provider", "zapi_whatsapp")
      .eq("status", "active");

    let companyId: string | null = null;
    for (const row of integrations || []) {
      const cfg = (row as any).config || {};
      if (cfg.instance_id && String(cfg.instance_id) === String(instanceId)) {
        companyId = row.company_id;
        break;
      }
    }
    if (!companyId && (integrations || []).length === 1) {
      companyId = integrations![0].company_id;
    }
    if (!companyId) {
      console.warn("zapi-webhook: nenhuma empresa para instanceId=", instanceId);
      return new Response(JSON.stringify({ ok: true, skipped: "no_company" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Localiza o lead pelo telefone dentro da empresa
    const { data: leads } = await supabase
      .from("leads")
      .select("id, phone, whatsapp")
      .eq("company_id", companyId)
      .or("phone.not.is.null,whatsapp.not.is.null");

    const fromDigits = fromPhone.replace(/\D/g, "");
    // Gera variantes BR: com e sem o 9º dígito após o DDD (ex.: 5541997211537 <-> 554197211537)
    function brVariants(d: string): string[] {
      const out = new Set<string>([d]);
      if (d.startsWith("55") && d.length >= 12) {
        const ddi = d.slice(0, 2);
        const ddd = d.slice(2, 4);
        const rest = d.slice(4);
        // sem 9 -> com 9
        if (rest.length === 8) out.add(`${ddi}${ddd}9${rest}`);
        // com 9 -> sem 9
        if (rest.length === 9 && rest.startsWith("9")) out.add(`${ddi}${ddd}${rest.slice(1)}`);
      }
      return Array.from(out);
    }
    const fromVariants = brVariants(fromDigits);
    const lead = (leads || []).find((l: any) => {
      const cands = [l.whatsapp, l.phone]
        .filter(Boolean)
        .flatMap((p: string) => brVariants(p.replace(/\D/g, "")));
      return cands.some((c) =>
        fromVariants.some(
          (f) => c === f || c.endsWith(f.slice(-10)) || f.endsWith(c.slice(-10)),
        ),
      );
    });

    if (!lead) {
      console.warn("zapi-webhook: lead não encontrado para", fromPhone, "company:", companyId);
      return new Response(JSON.stringify({ ok: true, skipped: "no_lead" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Conversation: reaproveita a mais recente do lead
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

    // Dedup por provider_message_id (Z-API messageId). Se já existir, ignora.
    if (messageId) {
      const { data: dup } = await supabase
        .from("messages")
        .select("id")
        .eq("provider", "zapi")
        .eq("provider_message_id", String(messageId))
        .maybeSingle();
      if (dup) {
        console.log("zapi-webhook: duplicate messageId, skipping:", messageId);
        return new Response(JSON.stringify({ ok: true, deduped: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Insere a mensagem recebida
    await supabase.from("messages").insert({
      conversation_id: conv!.id,
      content: text,
      direction: "inbound",
      channel: "whatsapp",
      ai_suggested: false,
      metadata: { zapi_message_id: messageId, from: fromPhone, instance_id: instanceId },
      provider: "zapi",
      provider_message_id: messageId ? String(messageId) : null,
    });

    // Encaminha para o pipeline (intenção, IA) pulando o insert duplicado
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
        content: text,
        channel: "whatsapp",
        skip_insert: true,
        provider: "zapi",
        provider_message_id: messageId ? String(messageId) : null,
      }),
    }).catch((e) => console.error("inbound-webhook forward error:", e));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("zapi-webhook error:", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
