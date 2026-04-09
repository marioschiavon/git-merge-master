import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { conversationHistory, leadInfo, channel } = await req.json();

    if (!conversationHistory?.length) {
      return new Response(JSON.stringify({ error: "conversationHistory é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const systemPrompt = `Você é um especialista em vendas B2B no Brasil, analisando conversas entre SDRs e prospects.

Sua tarefa é:
1. Analisar o tom e sentimento da última mensagem recebida do prospect
2. Classificar a resposta (interesse, objeção, dúvida, rejeição, neutro)
3. Sugerir a melhor resposta para o SDR enviar

CLASSIFICAÇÃO DE SENTIMENTO:
- "interesse": prospect demonstra curiosidade ou vontade de saber mais
- "objeção": prospect levanta impedimento (preço, timing, concorrente)
- "dúvida": prospect pede mais informações
- "rejeição": prospect não quer continuar
- "neutro": resposta genérica sem sentimento claro

REGRAS PARA SUGESTÃO DE RESPOSTA:
- Se interesse: avançar para próximo passo (reunião, demo)
- Se objeção: contornar com empatia + prova social
- Se dúvida: responder objetivamente + CTA
- Se rejeição: agradecer educadamente, deixar porta aberta
- Se neutro: reengajar com pergunta aberta

${channel === "whatsapp" ? "Canal WhatsApp: mensagem curta, até 80 palavras" : ""}
${channel === "email" ? "Canal Email: até 100 palavras, profissional" : ""}
${channel === "linkedin" ? "Canal LinkedIn: até 100 palavras, tom profissional" : ""}

Responda APENAS com JSON válido:
{
  "tone_detected": "tom detectado na resposta do prospect",
  "sentiment": "interesse|objeção|dúvida|rejeição|neutro",
  "reasoning": "explicação breve de por que classificou assim",
  "suggested_reply": "texto sugerido para o SDR enviar"
}`;

    const historyFormatted = conversationHistory
      .map((m: any) => `[${m.direction === "outbound" ? "SDR" : "PROSPECT"}]: ${m.content}`)
      .join("\n");

    const userPrompt = `Dados do lead:
${leadInfo ? `- Nome: ${leadInfo.name || "N/A"}\n- Empresa: ${leadInfo.company_name || "N/A"}\n- Segmento: ${leadInfo.segment || "N/A"}` : "Sem dados adicionais"}

Histórico da conversa:
${historyFormatted}

Analise a última mensagem do prospect e sugira a resposta ideal.`;

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
      return new Response(JSON.stringify({ error: "Erro ao analisar conversa" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      parsed = {
        tone_detected: "neutro",
        sentiment: "neutro",
        reasoning: "Não foi possível analisar automaticamente",
        suggested_reply: content,
      };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-reply error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
