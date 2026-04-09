import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { baseScript, count = 3, tones, segment, channel } = await req.json();

    if (!baseScript) {
      return new Response(JSON.stringify({ error: "baseScript é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const tonesStr = tones?.length ? tones.join(", ") : "consultivo, direto, amigável";

    const systemPrompt = `Você é um especialista em vendas B2B no Brasil e copywriting de prospecção outbound.

Sua tarefa é gerar variações de um script de abordagem mantendo a essência da mensagem original, mas variando:
- Tom de voz
- Estrutura do texto
- Palavras-chave e expressões
- Ângulo de abordagem (dor, benefício, curiosidade, prova social)

Mantenha os placeholders {{nome}}, {{empresa}}, {{cargo}}, {{dor_principal}} quando presentes.
Cada variação deve ser distinta e testável em A/B.

Responda APENAS com um JSON válido:
{
  "variations": [
    { "tone": "tom_usado", "text": "texto da variação" }
  ]
}`;

    const userPrompt = `Script base:
"""
${baseScript}
"""

Gere ${count} variações usando os tons: ${tonesStr}
${segment ? `Segmento: ${segment}` : ""}
${channel ? `Canal: ${channel}` : ""}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      await response.text();
      if (status === 429) return new Response(JSON.stringify({ error: "Limite de requisições excedido." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Erro ao gerar variações" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      parsed = { variations: [{ tone: "original", text: content }] };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-variations error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
