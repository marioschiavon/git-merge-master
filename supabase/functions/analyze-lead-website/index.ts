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
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch lead
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, name, company_name, website, company_id")
      .eq("id", lead_id)
      .single();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: "Lead não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!lead.website) {
      return new Response(JSON.stringify({ error: "Lead não possui website cadastrado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch website content (best-effort: site é opcional, IA prossegue mesmo sem ele)
    let websiteUrl = lead.website.trim();
    if (!websiteUrl.startsWith("http")) websiteUrl = `https://${websiteUrl}`;

    async function tryFetch(url: string): Promise<string | null> {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          },
        });
        if (!res.ok) {
          await res.body?.cancel();
          return null;
        }
        return await res.text();
      } catch (_) {
        return null;
      } finally {
        clearTimeout(t);
      }
    }

    const candidates = [websiteUrl];
    try {
      const u = new URL(websiteUrl);
      if (!u.hostname.startsWith("www.")) candidates.push(`${u.protocol}//www.${u.hostname}${u.pathname}`);
      if (u.protocol === "https:") candidates.push(`http://${u.hostname}${u.pathname}`);
    } catch (_) { /* ignore */ }

    let raw: string | null = null;
    for (const c of candidates) {
      raw = await tryFetch(c);
      if (raw) break;
    }

    let pageContent = "";
    if (raw) {
      pageContent = raw
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 15000);
    } else {
      console.warn(`Não foi possível acessar ${websiteUrl} — prosseguindo apenas com nome da empresa`);
      pageContent = `(Conteúdo do site indisponível. Gere insights com base no nome da empresa e domínio: ${websiteUrl})`;
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Você é um especialista em inteligência comercial B2B. Analise o site de um prospect e extraia insights estratégicos para um SDR fazer uma primeira abordagem altamente personalizada.

Responda APENAS com JSON válido com esta estrutura:
{
  "proposta_valor": "qual o principal valor que a empresa entrega",
  "produtos": ["lista dos principais produtos/serviços"],
  "diferenciais": ["o que diferencia dos concorrentes"],
  "publico_alvo": "para quem vendem",
  "cases": ["cases de sucesso mencionados, se houver"],
  "pain_points": ["possíveis dores que esta empresa pode ter baseado no mercado em que atua"],
  "oportunidades_abordagem": [
    {
      "gancho": "o que usar como gancho na abordagem",
      "mensagem_sugerida": "exemplo de primeira mensagem personalizada"
    }
  ],
  "resumo": "resumo executivo de 2-3 frases sobre a empresa"
}`,
          },
          {
            role: "user",
            content: `Analise o site ${websiteUrl} da empresa "${lead.company_name || lead.name}" e gere insights para abordagem de vendas:\n\n${pageContent}`,
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const status = aiRes.status;
      await aiRes.text();
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em alguns minutos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados. Adicione créditos nas configurações." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "Erro ao processar análise" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    let insights;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      insights = JSON.parse(jsonMatch[1].trim());
    } catch {
      insights = { resumo: content };
    }

    // Save to DB
    const { data: saved, error: saveError } = await supabase
      .from("lead_insights")
      .upsert(
        {
          lead_id: lead.id,
          company_id: lead.company_id,
          website_url: websiteUrl,
          insights,
          raw_summary: insights.resumo || content,
          analyzed_at: new Date().toISOString(),
        },
        { onConflict: "lead_id" }
      )
      .select()
      .single();

    if (saveError) {
      console.error("Save error:", saveError);
      // Still return insights even if save fails
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
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
