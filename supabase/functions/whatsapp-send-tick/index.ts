// Cron worker (a cada 15-30s) que drena `whatsapp_send_queue` respeitando:
//  - business_hours da company
//  - caps hora/dia por instância (com warm-up nos primeiros 7 dias)
//  - cooldown por lead (evita 2 mensagens em minutos)
//
// Falhas incrementam attempts; após 3 tentativas vira status='failed'.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendWhatsAppViaHook7 } from "../_shared/hook7-whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH = 20;
const MAX_ATTEMPTS = 3;

// Warm-up ramp: primeiros N dias após warmup_started_at.
function warmupCaps(daysConnected: number, base: { hourly: number; daily: number }) {
  if (daysConnected < 1) return { hourly: Math.min(5, base.hourly), daily: Math.min(20, base.daily) };
  if (daysConnected < 2) return { hourly: Math.min(6, base.hourly), daily: Math.min(30, base.daily) };
  if (daysConnected < 4) return { hourly: Math.min(8, base.hourly), daily: Math.min(45, base.daily) };
  if (daysConnected < 7) return { hourly: Math.min(12, base.hourly), daily: Math.min(65, base.daily) };
  return { hourly: base.hourly, daily: base.daily };
}

// Retorna o próximo instante permitido pelo business_hours (mesma lógica do
// cadence-agent-decide). Se `from` já está dentro da janela, retorna `from`.
function nextAllowedSlot(from: Date, bh: any): Date {
  const tz = bh?.tz || "America/Sao_Paulo";
  const days: number[] = bh?.days || [1, 2, 3, 4, 5];
  const [sH] = (bh?.start || "09:00").split(":").map(Number);
  const [eH] = (bh?.end || "18:00").split(":").map(Number);
  const inTz = (d: Date) => new Date(d.toLocaleString("en-US", { timeZone: tz }));

  let candidate = new Date(from);
  for (let i = 0; i < 14 * 24; i++) {
    const local = inTz(candidate);
    const dow = local.getDay();
    const hour = local.getHours();
    if (days.includes(dow) && hour >= sH && hour < eH) return candidate;
    candidate = new Date(candidate.getTime() + 60 * 60 * 1000);
  }
  return candidate;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Puxa itens vencidos
  const { data: items, error } = await supabase
    .from("whatsapp_send_queue")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH);

  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];
  const instanceCapsCache = new Map<string, any>();
  const bhCache = new Map<string, any>();

  for (const item of items || []) {
    try {
      // Marca como sending com claim otimista (evita corrida entre ticks)
      const { data: claimed } = await supabase
        .from("whatsapp_send_queue")
        .update({ status: "sending", attempts: (item.attempts || 0) + 1 })
        .eq("id", item.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      // Carrega instância + caps
      let inst = instanceCapsCache.get(item.instance_id);
      if (!inst) {
        const { data } = await supabase
          .from("hook7_instances")
          .select("id, external_name, status, daily_send_cap, hourly_send_cap, warmup_started_at, phone_number")
          .eq("id", item.instance_id)
          .maybeSingle();
        inst = data;
        instanceCapsCache.set(item.instance_id, inst);
      }
      if (!inst || inst.status !== "connected") {
        await reschedule(supabase, item.id, 30, "instance_disconnected");
        results.push({ id: item.id, reschedule: "instance_disconnected" });
        continue;
      }

      // Business hours
      let bh = bhCache.get(item.company_id);
      if (bh === undefined) {
        const { data } = await supabase
          .from("companies").select("business_hours").eq("id", item.company_id).maybeSingle();
        bh = data?.business_hours ?? null;
        bhCache.set(item.company_id, bh);
      }
      if (bh) {
        const next = nextAllowedSlot(new Date(), bh);
        if (next.getTime() > Date.now() + 30_000) {
          // Fora da janela → reagenda com pequeno jitter
          const jitterSec = 30 + Math.floor(Math.random() * 120);
          const when = new Date(next.getTime() + jitterSec * 1000);
          await supabase.from("whatsapp_send_queue").update({
            status: "pending",
            scheduled_for: when.toISOString(),
            last_error: "outside_business_hours",
          }).eq("id", item.id);
          results.push({ id: item.id, reschedule: "outside_business_hours" });
          continue;
        }
      }

      // Warm-up + caps por instância
      const started = inst.warmup_started_at ? new Date(inst.warmup_started_at).getTime() : Date.now();
      const daysConnected = (Date.now() - started) / 86_400_000;
      const caps = warmupCaps(daysConnected, {
        hourly: inst.hourly_send_cap ?? 15,
        daily: inst.daily_send_cap ?? 80,
      });

      const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
      const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
      const [{ count: hourCount }, { count: dayCount }] = await Promise.all([
        supabase.from("whatsapp_send_queue")
          .select("id", { count: "exact", head: true })
          .eq("instance_id", inst.id).eq("status", "sent")
          .gte("sent_at", oneHourAgo),
        supabase.from("whatsapp_send_queue")
          .select("id", { count: "exact", head: true })
          .eq("instance_id", inst.id).eq("status", "sent")
          .gte("sent_at", oneDayAgo),
      ]);
      if ((hourCount ?? 0) >= caps.hourly) {
        await reschedule(supabase, item.id, 60 * 60, "hourly_cap_reached");
        results.push({ id: item.id, reschedule: "hourly_cap" });
        continue;
      }
      if ((dayCount ?? 0) >= caps.daily) {
        await reschedule(supabase, item.id, 60 * 60 * 6, "daily_cap_reached");
        results.push({ id: item.id, reschedule: "daily_cap" });
        continue;
      }

      // Cooldown por lead (20min default por instância)
      if (item.lead_id) {
        const { data: instRow } = await supabase
          .from("hook7_instances").select("lead_cooldown_minutes")
          .eq("id", inst.id).maybeSingle();
        const cooldownMin = instRow?.lead_cooldown_minutes ?? 20;
        const cutoff = new Date(Date.now() - cooldownMin * 60_000).toISOString();
        const { data: recentConv } = await supabase
          .from("conversations").select("id").eq("lead_id", item.lead_id).eq("channel", "whatsapp");
        const convIds = (recentConv || []).map((c: any) => c.id);
        if (convIds.length > 0) {
          const { data: recentMsg } = await supabase
            .from("messages")
            .select("id, sent_at")
            .in("conversation_id", convIds)
            .eq("direction", "outbound")
            .gte("sent_at", cutoff)
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (recentMsg) {
            const jitter = 60 + Math.floor(Math.random() * 240);
            await reschedule(supabase, item.id, cooldownMin * 60 + jitter, "lead_cooldown");
            results.push({ id: item.id, reschedule: "lead_cooldown" });
            continue;
          }
        }
      }

      // Envia
      const r = await sendWhatsAppViaHook7(supabase, {
        id: inst.id,
        external_name: inst.external_name,
        phone_number: inst.phone_number,
      }, item.to_phone, item.body);

      if (!r.ok) {
        if ((item.attempts || 0) + 1 >= MAX_ATTEMPTS) {
          await supabase.from("whatsapp_send_queue").update({
            status: "failed",
            last_error: r.error || `HTTP ${r.status}`,
          }).eq("id", item.id);
          results.push({ id: item.id, failed: r.error });
        } else {
          await reschedule(supabase, item.id, 5 * 60, r.error || `HTTP ${r.status}`);
          results.push({ id: item.id, retry: r.error });
        }
        continue;
      }

      // Sucesso: grava messages (se houver conversation) e marca sent
      let messageId: string | null = null;
      if (item.conversation_id) {
        const { data: msg } = await supabase.from("messages").insert({
          conversation_id: item.conversation_id,
          content: item.body,
          direction: "outbound",
          ai_suggested: item.source !== "manual",
          metadata: {
            source: item.source,
            zapi_message_id: r.sid,
            delivery_status: "delivered",
            approval_id: item.approval_id,
            queue_id: item.id,
          },
        }).select("id").maybeSingle();
        messageId = msg?.id ?? null;
      }

      await supabase.from("whatsapp_send_queue").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_message_id: messageId,
        last_error: null,
      }).eq("id", item.id);

      results.push({ id: item.id, sent: true, sid: r.sid });
    } catch (e) {
      console.error("whatsapp-send-tick error", e);
      await reschedule(
        supabase,
        item.id,
        5 * 60,
        e instanceof Error ? e.message : String(e),
      );
      results.push({ id: item.id, error: String(e) });
    }
  }

  return json({ processed: results.length, results });
});

async function reschedule(supabase: any, id: string, addSeconds: number, err: string) {
  const when = new Date(Date.now() + addSeconds * 1000).toISOString();
  await supabase.from("whatsapp_send_queue").update({
    status: "pending",
    scheduled_for: when,
    last_error: err,
  }).eq("id", id);
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
