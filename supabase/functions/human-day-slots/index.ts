// Lista os horários disponíveis no Cal.com para um dia específico (sem reservar holds).
// Usado pelo painel humano para o operador escolher um horário e agendar/remarcar.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { resolveEventTypeId } from "../_shared/calcom.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TZ = "America/Sao_Paulo";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { conversation_id, date } = await req.json();
    if (!conversation_id || !date) {
      return new Response(JSON.stringify({ error: "conversation_id e date (YYYY-MM-DD) são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(JSON.stringify({ error: "date deve estar no formato YYYY-MM-DD" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verifica acesso à conversa (RLS via userClient)
    const { data: conv } = await userClient
      .from("conversations").select("id").eq("id", conversation_id).maybeSingle();
    if (!conv) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const CALCOM_API_KEY = Deno.env.get("CALCOM_API_KEY");
    if (!CALCOM_API_KEY) throw new Error("CALCOM_API_KEY not configured");

    const eventTypeId = await resolveEventTypeId(CALCOM_API_KEY);

    // Janela em UTC cobrindo o dia em SPT (00:00 a 23:59 SPT)
    // SPT = UTC-3 (sem DST atualmente)
    const startUtc = `${date}T03:00:00.000Z`;
    const endDate = new Date(`${date}T03:00:00.000Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endUtc = endDate.toISOString();

    const u = new URL("https://api.cal.com/v2/slots");
    u.searchParams.set("eventTypeId", String(eventTypeId));
    u.searchParams.set("start", startUtc);
    u.searchParams.set("end", endUtc);

    const r = await fetch(u.toString(), {
      headers: {
        Authorization: `Bearer ${CALCOM_API_KEY}`,
        "cal-api-version": "2024-09-04",
      },
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("cal.com slots error", r.status, t);
      return new Response(JSON.stringify({ error: `Cal.com ${r.status}` }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const j = await r.json();
    const data = (j?.data || {}) as Record<string, Array<{ start: string }>>;

    // Cal.com agrupa por dia local; juntamos tudo e filtramos pelo dia SPT.
    const all: { start: string; label: string }[] = [];
    for (const day of Object.keys(data)) {
      for (const s of data[day] || []) {
        const sptDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(new Date(s.start));
        const y = sptDate.find((p) => p.type === "year")?.value;
        const m = sptDate.find((p) => p.type === "month")?.value;
        const d = sptDate.find((p) => p.type === "day")?.value;
        const key = `${y}-${m}-${d}`;
        if (key === date) all.push({ start: s.start, label: fmtTime(s.start) });
      }
    }
    all.sort((a, b) => a.start.localeCompare(b.start));

    return new Response(JSON.stringify({ ok: true, slots: all }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("human-day-slots error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
