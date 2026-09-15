// Envia mensagem manual do SDR para o canal correto (Twilio para WhatsApp)
// e só então registra a mensagem na tabela messages com o delivery_status real.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getZApiConfig, sendWhatsAppViaZApi } from "../_shared/hook7-whatsapp.ts";
import { enqueueWhatsAppSend } from "../_shared/whatsapp-pacer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Não autenticado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { conversation_id, content, ai_suggested, metadata } = body || {};
    if (!conversation_id || !content?.toString().trim()) {
      return new Response(JSON.stringify({ error: "conversation_id e content são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Carrega conversa + lead (com phone/whatsapp) usando o cliente do usuário (respeita RLS)
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("id, company_id, channel, leads(id, name, email, phone, whatsapp)")
      .eq("id", conversation_id)
      .maybeSingle();

    if (convErr || !conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const channel = (conv as any).channel as string;
    const lead = (conv as any).leads as any;
    const companyId = (conv as any).company_id as string;

    let deliveryStatus: string = "sent";
    let deliveryMeta: Record<string, any> = {};

    if (channel === "whatsapp") {
      const toNumber = lead?.whatsapp || lead?.phone;
      if (!toNumber) {
        deliveryStatus = "failed";
        deliveryMeta = { delivery_error: "Lead sem telefone/WhatsApp cadastrado" };
      } else {
        const zCfg = await getZApiConfig(admin, companyId);
        if (!zCfg) {
          deliveryStatus = "queued";
          deliveryMeta = { delivery_error: "Nenhuma instância WhatsApp conectada" };
        } else {
          const r = await sendWhatsAppViaZApi(zCfg, toNumber, content);
          if (r.ok) {
            deliveryStatus = "delivered";
            deliveryMeta = { zapi_message_id: r.sid, zapi_status: r.status };
          } else {
            deliveryStatus = "queued";
            deliveryMeta = { zapi_status: r.status, zapi_error: r.error };
          }
        }
        // Rede de segurança: falhou o envio direto → enfileira com prioridade
        // alta e registra no histórico do lead, em vez de perder a resposta.
        if (deliveryStatus === "queued") {
          const q = await enqueueWhatsAppSend(admin, {
            companyId,
            toPhone: toNumber,
            body: String(content),
            leadId: lead?.id ?? null,
            conversationId: conversation_id,
            source: "manual_retry",
            replyMode: true,
          });
          deliveryMeta.requeued = q.ok;
          if (!q.ok) {
            deliveryStatus = "failed";
            deliveryMeta.requeue_error = q.error;
          }
          if (lead?.id) {
            await admin.from("lead_activities").insert({
              company_id: companyId,
              lead_id: lead.id,
              type: "whatsapp",
              description: q.ok
                ? "⏳ WhatsApp fora do ar — resposta na fila, será enviada assim que reconectar"
                : `❌ WhatsApp não enviado (conexão fora do ar): ${deliveryMeta.zapi_error ?? deliveryMeta.delivery_error ?? "sem instância conectada"}`,
            });
          }
        }
      }
    } else {
      // Outros canais (email/linkedin/manual) — apenas registra
      deliveryStatus = "pending_manual";
    }

    const { data: inserted, error: insErr } = await admin
      .from("messages")
      .insert({
        conversation_id,
        content,
        direction: "outbound",
        ai_suggested: !!ai_suggested,
        metadata: { ...(metadata || {}), delivery_status: deliveryStatus, ...deliveryMeta },
      })
      .select()
      .single();

    if (insErr) {
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: deliveryStatus !== "failed", message: inserted, delivery_status: deliveryStatus, ...deliveryMeta }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
