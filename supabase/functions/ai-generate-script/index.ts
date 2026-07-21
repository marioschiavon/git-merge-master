import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { chatCompletion } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { segment, channel, tone, companyContext } = await req.json();

    if (!segment || !channel || !tone) {
      return new Response(JSON.stringify({ error: "segment, channel e tone são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Você é um especialista em vendas B2B no Brasil, com profundo conhecimento em prospecção outbound e geração de demanda.

Sua função é criar scripts de abordagem para SDRs (Sales Development Representatives) que sejam:
- Naturais e não robóticos
- Adaptados ao segmento/indústria do prospect
- Com o tom adequado ao contexto
- Usando linguagem brasileira natural (não de Portugal)
- Com placeholders para personalização: {{nome}}, {{empresa}}, {{cargo}}, {{dor_principal}}

REGRAS POR TOM:
- "formal": linguagem profissional, tratamento por "senhor/senhora", sem gírias
- "consultivo": postura de consultor, perguntas abertas, foco em dor do cliente
- "direto": objetivo, curto, vai direto ao ponto sem rodeios
- "amigável": casual mas profissional, usa "você", tom leve

REGRAS POR CANAL:
- "email": assunto + corpo, formato HTML leve, até 150 palavras no corpo
- "whatsapp": mensagem curta (até 80 palavras), informal, sem formatação pesada
- "linkedin": mensagem de conexão (até 300 caracteres) OU InMail (até 100 palavras)

REGRAS POR SEGMENTO:
- Adapte o vocabulário ao segmento (ex: "escritório" para advocacia, "clínica" para odontologia)
- Mencione dores comuns do segmento
- Use referências do mercado quando relevante

Responda APENAS com um JSON válido no formato:
{
  "name": "Nome sugerido para o script",
  "subject": "Assunto do email (apenas para canal email, null para outros)",
  "script": "O texto completo do script com placeholders"
}`;

    const userPrompt = `Crie um script de abordagem com estas especificações:
- Segmento: ${segment}
- Canal: ${channel}
- Tom: ${tone}
${companyContext ? `- Contexto adicional: ${companyContext}` : ""}`;

    let data;
    try {
      data = await chatCompletion({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        _edgeName: "ai-generate-script",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /\b402\b/.test(msg) ? 402 : /\b429\b/.test(msg) ? 429 : 500;
      const userMsg = status === 402
        ? "Créditos de IA esgotados e fallback indisponível."
        : status === 429
        ? "Limite de requisições excedido. Tente novamente em instantes."
        : "Erro ao gerar script";
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
      parsed = { name: `${segment} - ${channel}`, subject: null, script: contentStr };
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-generate-script error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
