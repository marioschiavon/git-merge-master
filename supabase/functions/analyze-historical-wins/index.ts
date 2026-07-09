// Analisa cadências com maior taxa de booking por empresa e escreve um item
// bloqueado de Base de Conhecimento (knowledge_type='historical_wins') que a IA
// injeta em novas mensagens. Rodar sob demanda ou via cron.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

async function analyzeCompany(supabase: any, companyId: string): Promise<{ updated: boolean; reason?: string }> {
  // Pega enrollments com booking
  const { data: enrollments } = await supabase
    .from("cadence_enrollments")
    .select("id, cadence_id, meeting_scheduled, status")
    .eq("company_id", companyId);
  if (!enrollments?.length) return { updated: false, reason: "sem enrollments" };

  // Agrupa por cadência
  const byCadence: Record<string, { total: number; wins: number }> = {};
  for (const e of enrollments) {
    const b = (byCadence[e.cadence_id] ||= { total: 0, wins: 0 });
    b.total++;
    if (e.meeting_scheduled) b.wins++;
  }
  const ranked = Object.entries(byCadence)
    .filter(([, v]) => v.total >= 5)
    .map(([cid, v]) => ({ cadence_id: cid, total: v.total, wins: v.wins, rate: v.wins / v.total }))
    .sort((a, b) => b.rate - a.rate);
  if (!ranked.length) return { updated: false, reason: "cadências com <5 enrollments" };

  const topCut = Math.max(1, Math.ceil(ranked.length * 0.2));
  const top = ranked.slice(0, topCut).filter((r) => r.wins > 0);
  if (!top.length) return { updated: false, reason: "nenhuma cadência com booking" };

  // Coleta primeiras mensagens que geraram booking
  const winIds = top.map((t) => t.cadence_id);
  const { data: winEnrolls } = await supabase
    .from("cadence_enrollments").select("id, cadence_id")
    .in("cadence_id", winIds).eq("meeting_scheduled", true).limit(30);
  const enrollIds = (winEnrolls || []).map((e: any) => e.id);
  if (!enrollIds.length) return { updated: false, reason: "sem enrollments vencedoras" };

  const { data: msgs } = await supabase.from("cadence_custom_messages")
    .select("subject, message, enrollment_id")
    .in("enrollment_id", enrollIds).limit(20);
  const sampleMessages = (msgs || []).map((m: any) => `— ${m.subject ? `Assunto: ${m.subject}\n` : ""}${(m.message || "").slice(0, 500)}`).join("\n\n");
  if (!sampleMessages.trim()) return { updated: false, reason: "sem mensagens" };

  if (!LOVABLE_API_KEY) return { updated: false, reason: "sem LOVABLE_API_KEY" };
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Você analisa mensagens de prospecção que resultaram em reuniões agendadas. Extraia padrões em PT-BR e responda com 6-10 bullets objetivos cobrindo: tom, tipo de gancho, tamanho ideal, tipo de CTA e o que evitar. Não invente — só use o que aparece nos exemplos." },
        { role: "user", content: `Mensagens vencedoras (que resultaram em reunião):\n\n${sampleMessages}` },
      ],
    }),
  });
  if (!r.ok) return { updated: false, reason: `AI ${r.status}` };
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content?.trim();
  if (!content) return { updated: false, reason: "AI vazio" };

  // Upsert único por empresa
  const { data: existing } = await supabase.from("company_knowledge")
    .select("id").eq("company_id", companyId).eq("knowledge_type", "historical_wins").maybeSingle();
  if (existing) {
    await supabase.from("company_knowledge").update({
      content, updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    await supabase.from("company_knowledge").insert({
      company_id: companyId,
      title: "Aprendizados de cadências vencedoras",
      content,
      type: "text",
      origin: "admin",
      locked: true,
      knowledge_type: "historical_wins",
    });
  }
  return { updated: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const companyId: string | undefined = body?.company_id;

    let companyIds: string[] = [];
    if (companyId) companyIds = [companyId];
    else {
      const { data } = await supabase.from("companies").select("id").eq("status", "active");
      companyIds = (data || []).map((c: any) => c.id);
    }

    const results: any[] = [];
    for (const cid of companyIds) {
      try {
        const r = await analyzeCompany(supabase, cid);
        results.push({ company_id: cid, ...r });
      } catch (e) {
        results.push({ company_id: cid, updated: false, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
