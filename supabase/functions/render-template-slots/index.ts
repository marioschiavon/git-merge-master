// Renderiza slots {{ai:...}} de um template usando o Lovable AI Gateway.
// Input: { body, lead_id?, lead?, context? }
// Output: { rendered_body, slot_values }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLOT_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { body, lead_id, lead: leadIn, context } = await req.json();
    if (typeof body !== "string") return json({ error: "body required" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    let lead = leadIn || null;
    if (!lead && lead_id) {
      const { data } = await supabase.from("leads").select("*").eq("id", lead_id).maybeSingle();
      lead = data;
    }
    lead = lead || {};

    // Parse slots
    const slots: { key: string; prompt: string }[] = [];
    let rendered = body;
    let idx = 0;
    // First substitute lead fields
    rendered = rendered.replace(SLOT_RE, (raw, inner) => {
      const t = String(inner).trim();
      if (t.toLowerCase().startsWith("ai:")) return raw;
      const path = t.toLowerCase().startsWith("lead.") ? t.slice(5) : t;
      const val = getField(lead, path);
      return val ?? "";
    });
    // Collect AI slots
    rendered.replace(SLOT_RE, (raw, inner) => {
      const t = String(inner).trim();
      if (t.toLowerCase().startsWith("ai:")) {
        slots.push({ key: `ai_${idx++}`, prompt: t.slice(3).trim() });
      }
      return raw;
    });

    let slotValues: Record<string, string> = {};
    if (slots.length > 0) {
      const leadCtx = JSON.stringify({
        name: lead.name, title: lead.title, company: lead.company_name,
        website: lead.website, industry: lead.industry,
      }).slice(0, 1500);
      const extra = context ? JSON.stringify(context).slice(0, 1500) : "";
      const sys = `Você gera trechos curtos e específicos para serem encaixados em uma mensagem de prospecção em português brasileiro. Tom consultivo. Responda APENAS com JSON {"values":{"<key>":"<texto>"}}. Texto curto, 1 frase, sem emojis, sem aspas externas, sem repetir o nome.`;
      const slotsDesc = slots.map(s => `- ${s.key}: ${s.prompt}`).join("\n");
      const prompt = `LEAD: ${leadCtx}\n${extra ? `CONTEXTO: ${extra}\n` : ""}\nGere os seguintes trechos:\n${slotsDesc}`;
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": LOVABLE_API_KEY,
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sys },
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        return json({ error: `AI ${r.status}: ${t}` }, r.status === 429 || r.status === 402 ? r.status : 500);
      }
      const data = await r.json();
      try {
        const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
        slotValues = parsed.values || parsed || {};
      } catch {
        slotValues = {};
      }
    }

    // Substitute AI slots
    let k = 0;
    rendered = rendered.replace(SLOT_RE, (raw, inner) => {
      const t = String(inner).trim();
      if (!t.toLowerCase().startsWith("ai:")) return raw;
      const key = `ai_${k++}`;
      return slotValues[key] ?? "";
    });

    return json({ rendered_body: rendered, slot_values: slotValues });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function getField(obj: any, path: string): string {
  if (!obj) return "";
  return path.split(".").reduce((a: any, p) => (a == null ? a : a[p]), obj) ?? "";
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
