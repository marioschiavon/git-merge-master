import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chatCompletion } from "../_shared/ai-gateway.ts";

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

    let data;
    try {
      data = await chatCompletion({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        _edgeName: "ai-variations",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /\b402\b/.test(msg) ? 402 : /\b429\b/.test(msg) ? 429 : 500;
      const userMsg = status === 402
        ? "Créditos de IA esgotados e fallback indisponível."
        : status === 429
        ? "Limite de requisições excedido."
        : "Erro ao gerar variações";
      return new Response(JSON.stringify({ error: userMsg }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const content = data.choices?.[0]?.message?.content ?? "";
    const contentStr = typeof content === "string" ? content : "";

    let parsed;
    try {
      const jsonMatch = contentStr.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, contentStr];
      parsed = JSON.parse((jsonMatch[1] as string).trim());
    } catch {
      parsed = { variations: [{ tone: "original", text: contentStr }] };
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
