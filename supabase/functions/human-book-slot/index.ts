// Wrapper humano para agendar imediatamente a partir de um hold ou de uma data/hora.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { formatBRTLong } from "../_shared/datetime.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const admin = createClient(url, service);

    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { conversation_id, hold_id, start, notify_lead, guests, notes } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const cleanGuests: string[] = Array.isArray(guests)
      ? Array.from(new Set(
          guests
            .map((g: unknown) => String(g || "").trim().toLowerCase())
            .filter((g: string) => /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(g)),
        ))
      : [];

    const { data: conv } = await userClient
      .from("conversations")
      .select("id, lead_id, company_id, channel, leads(name, email)")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Caminho 1: confirmar a partir de um hold existente
    if (hold_id) {
      const r = await admin.functions.invoke("calcom-confirm-booking", {
        body: { lead_id: conv.lead_id, selected_slot_hold_id: hold_id, notes },
      });
      if (r.error || r.data?.error) {
        return new Response(JSON.stringify({ error: r.error?.message || r.data?.error || "Falha ao confirmar" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: hold } = await admin.from("slot_holds").select("slot_datetime").eq("id", hold_id).maybeSingle();
      const label = hold?.slot_datetime ? formatBRTLong(hold.slot_datetime) : "";

      if (cleanGuests.length > 0) {
        const bookingUid = r.data?.booking?.uid || r.data?.booking_uid;
        if (bookingUid) {
          await admin.functions.invoke("calcom-add-guests", {
            body: { booking_uid: bookingUid, guests: cleanGuests, lead_id: conv.lead_id, conversation_id },
          }).catch((e) => console.error("add-guests failed", e));
        }
      }

      const confirmMessage = `Reunião confirmada para ${label}. Você receberá o convite por e-mail. 🚀`;
      if (notify_lead) {
        await admin.functions.invoke("send-outbound-message", {
          headers: { Authorization: auth },
          body: { conversation_id, content: confirmMessage, ai_suggested: false, metadata: { actor: "human", action: "book_slot" } },
        });
      }
      return new Response(JSON.stringify({ ok: true, confirmed: true, message: confirmMessage }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Caminho 2: criar booking direto a partir de start ISO
    if (!start) {
      return new Response(JSON.stringify({ error: "hold_id ou start é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const r = await admin.functions.invoke("calcom-booking-create", {
      body: {
        lead_id: conv.lead_id,
        conversation_id,
        start,
        attendee_name: (conv as any).leads?.name,
        attendee_email: (conv as any).leads?.email,
        guests: cleanGuests,
        notes,
      },
    });
    if (r.error || r.data?.error) {
      const detail = r.data?.error || (await (r.error as any)?.context?.text?.().catch(() => null)) || r.error?.message || "Falha ao agendar";
      console.error("human-book-slot: calcom-booking-create failed:", detail, r.data);
      return new Response(JSON.stringify({ error: detail }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const label = formatBRTLong(start);
    const confirmMessage = `Reunião agendada para ${label}. Você receberá o convite por e-mail. 🚀`;
    if (notify_lead) {
      await admin.functions.invoke("send-outbound-message", {
        headers: { Authorization: auth },
        body: { conversation_id, content: confirmMessage, ai_suggested: false, metadata: { actor: "human", action: "book_slot" } },
      });
    }
    return new Response(JSON.stringify({ ok: true, confirmed: true, message: confirmMessage }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("human-book-slot error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
