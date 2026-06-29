import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { lead_id } = await req.json();
    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, name, company_name, website, company_id, email, phone, whatsapp, whatsapp_source")
      .eq("id", lead_id).single();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: "Lead não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!lead.website) {
      return new Response(JSON.stringify({ error: "Lead não possui website cadastrado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let websiteUrl = lead.website.trim();
    if (!websiteUrl.startsWith("http")) websiteUrl = `https://${websiteUrl}`;

    async function tryFetch(url: string): Promise<string | null> {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(url, {
          redirect: "follow", signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          },
        });
        if (!res.ok) { await res.body?.cancel(); return null; }
        return await res.text();
      } catch { return null; } finally { clearTimeout(t); }
    }

    const candidates = [websiteUrl];
    try {
      const u = new URL(websiteUrl);
      if (!u.hostname.startsWith("www.")) candidates.push(`${u.protocol}//www.${u.hostname}${u.pathname}`);
      if (u.protocol === "https:") candidates.push(`http://${u.hostname}${u.pathname}`);
    } catch {}

    let raw: string | null = null;
    for (const c of candidates) { raw = await tryFetch(c); if (raw) break; }

    let pageContent = "";
    if (raw) {
      pageContent = raw
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ").trim().slice(0, 15000);

      // Extract WhatsApp / phone from raw HTML if lead doesn't have one yet
      try {
        const normalizeBR = (s: string): string | null => {
          let d = String(s || "").replace(/\D/g, "");
          if (!d) return null;
          d = d.replace(/^00/, "").replace(/^0+/, "");
          if (d.length < 10 || d.length > 13) return null;
          if (!d.startsWith("55")) {
            if (d.length === 10 || d.length === 11) d = "55" + d;
            else return null;
          }
          if (d.length !== 12 && d.length !== 13) return null;
          const ddd = Number(d.slice(2, 4));
          if (ddd < 11 || ddd > 99) return null;
          if (/^(\d)\1+$/.test(d.slice(4))) return null;
          return "+" + d;
        };

        let wa: string | null = null;
        let waSrc: string | null = null;
        for (const m of raw.matchAll(/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp:\/\/send)[^"'\s<>]*?(?:phone=)?(\+?\d[\d\s\-().]{8,20})/gi)) {
          const n = normalizeBR(m[1]);
          if (n) { wa = n; waSrc = "wa.me"; break; }
        }
        let phone: string | null = null;
        if (!wa) {
          for (const m of pageContent.matchAll(/(\+?55\s*)?\(?\s*\d{2}\s*\)?[\s.\-]*9?\d{4}[\s.\-]*\d{4}/g)) {
            const n = normalizeBR(m[0]);
            if (n) { phone = n; break; }
          }
        }

        const patch: any = {};
        if (!lead.whatsapp && wa) {
          patch.whatsapp = wa;
          patch.whatsapp_source = waSrc || "website";
        } else if (!lead.whatsapp && phone) {
          const digits = phone.replace(/\D/g, "");
          if (digits.length === 13 && digits[4] === "9") {
            patch.whatsapp = phone;
            patch.whatsapp_source = "website";
          }
        }
        if (!lead.phone && (wa || phone)) patch.phone = wa || phone;
        if (Object.keys(patch).length) {
          await supabase.from("leads").update(patch).eq("id", lead.id);
        }
      } catch (e) {
        console.warn("whatsapp extraction failed:", e);
      }
    } else {
      pageContent = `(Conteúdo do site indisponível. Gere insights com base no nome da empresa e domínio: ${websiteUrl})`;
    }

    // Load OUR company knowledge so the AI knows what WE sell
    const [knowledgeRes, highlightsRes, aiInstructionsRes] = await Promise.all([
      supabase.from("company_knowledge").select("title, content")
        .eq("company_id", lead.company_id)
        .not("type", "in", "(highlights,ai_instructions)").limit(10),
      supabase.from("company_knowledge").select("content")
        .eq("company_id", lead.company_id).eq("type", "highlights").maybeSingle(),
      supabase.from("company_knowledge").select("content")
        .eq("company_id", lead.company_id).eq("type", "ai_instructions").maybeSingle(),
    ]);
    const ourKnowledge = (knowledgeRes.data || []).map((k: any) => `## ${k.title}\n${k.content}`).join("\n\n");
    const ourHighlights = highlightsRes.data?.content || "";
    const ourInstructions = aiInstructionsRes.data?.content || "";

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `Você é um especialista em inteligência comercial B2B atuando como SDR.

${ourInstructions ? `=== INSTRUÇÕES OBRIGATÓRIAS DA NOSSA EMPRESA (PRIORIDADE MÁXIMA) ===
${ourInstructions}

Se as regras acima indicarem que este prospect não tem fit, NÃO force conexão — gere uma abordagem neutra e marque fit_score baixo.

` : ""}=== O QUE NOSSA EMPRESA VENDE (use SEMPRE como referência para ganchos e mensagens) ===
${ourKnowledge || "(sem base de conhecimento cadastrada)"}
${ourHighlights ? `\n\nDIFERENCIAIS NOSSOS:\n${ourHighlights}` : ""}

Tarefa: analise o site do PROSPECT e extraia insights estratégicos para uma primeira abordagem altamente personalizada. Em "oportunidades_abordagem", CONECTE EXPLICITAMENTE algo concreto do prospect com o que NÓS vendemos (acima). Nunca invente fato sobre o prospect.

Responda APENAS JSON válido com esta estrutura:
{
  "proposta_valor": "qual o principal valor que o PROSPECT entrega",
  "produtos": ["principais produtos/serviços do prospect"],
  "diferenciais": ["o que diferencia o prospect"],
  "publico_alvo": "para quem o prospect vende",
  "cases": ["cases do prospect, se houver"],
  "pain_points": ["dores prováveis do prospect"],
  "fit_score": "high|medium|low",
  "fit_reason": "por que faz (ou não) sentido nossa solução para este prospect",
  "oportunidades_abordagem": [
    {
      "gancho": "fato específico do site do prospect",
      "conexao": "como isso liga ao que NÓS vendemos",
      "mensagem_sugerida": "primeira mensagem curta em PT-BR, citando o gancho e nossa proposta"
    }
  ],
  "resumo": "2-3 frases sobre o prospect"
}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Site ${websiteUrl} da empresa "${lead.company_name || lead.name}":\n\n${pageContent}` },
        ],
      }),
    });

    if (!aiRes.ok) {
      const status = aiRes.status;
      await aiRes.text();
      if (status === 429) return new Response(JSON.stringify({ error: "Limite de requisições excedido." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Erro ao processar análise" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let insights;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      insights = JSON.parse(jsonMatch[1].trim());
    } catch { insights = { resumo: content }; }

    const { data: saved, error: saveError } = await supabase
      .from("lead_insights")
      .upsert({
        lead_id: lead.id, company_id: lead.company_id, website_url: websiteUrl,
        insights, raw_summary: insights.resumo || content,
        analyzed_at: new Date().toISOString(),
      }, { onConflict: "lead_id" }).select().single();

    if (saveError) {
      console.error("Save error:", saveError);
      return new Response(JSON.stringify({ insights, saved: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ insights, saved: true, id: saved.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-lead-website error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
