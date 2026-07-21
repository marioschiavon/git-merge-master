import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chatCompletion } from "../_shared/ai-gateway.ts";

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

    let data;
    try {
      data = await chatCompletion({
        model: "openai/gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        _edgeName: "ai-reply",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /\b402\b/.test(msg) ? 402 : /\b429\b/.test(msg) ? 429 : 500;
      const userMsg = status === 402
        ? "Créditos de IA esgotados e fallback indisponível."
        : status === 429
        ? "Limite de requisições excedido."
        : "Erro ao analisar conversa";
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
      parsed = {
        tone_detected: "neutro",
        sentiment: "neutro",
        reasoning: "Não foi possível analisar automaticamente",
        suggested_reply: contentStr,
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
