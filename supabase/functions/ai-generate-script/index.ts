import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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
      const text = await response.text();
      console.error("AI gateway error:", status, text);
      if (status === 429) return new Response(JSON.stringify({ error: "Limite de requisições excedido. Tente novamente em instantes." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Erro ao gerar script" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response (may be wrapped in markdown code block)
    let parsed;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      parsed = { name: `${segment} - ${channel}`, subject: null, script: content };
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
