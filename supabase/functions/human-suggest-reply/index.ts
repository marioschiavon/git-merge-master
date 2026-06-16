// Sugere uma resposta para o operador humano usando o histórico da conversa.
// Reusa o gateway de IA (mesmo da ai-reply) com contexto enriquecido.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { conversation_id, intent_hint } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id é obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Use service role to fetch (auth already validated above; RLS on conversations
    // with joined leads can return null even when the user has access).
    const admin = createClient(url, serviceKey);

    // Verify the caller belongs to the same company (or is master_admin).
    const { data: conv, error: convErr } = await admin
      .from("conversations")
      .select("id, channel, company_id, leads(id, name, company_name)")
      .eq("id", conversation_id)
      .maybeSingle();
    if (convErr || !conv) {
      console.error("human-suggest-reply: conversation not found", { conversation_id, convErr });
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: membership } = await admin
      .from("company_members")
      .select("company_id")
      .eq("user_id", userData.user.id)
      .eq("company_id", (conv as any).company_id)
      .maybeSingle();
    const { data: isMaster } = await admin.rpc("has_role", { _user_id: userData.user.id, _role: "master_admin" });
    if (!membership && !isMaster) {
      return new Response(JSON.stringify({ error: "Sem acesso a esta conversa" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: msgs } = await admin
      .from("messages")
      .select("direction, content, sent_at")
      .eq("conversation_id", conversation_id)
      .neq("direction", "system")
      .order("sent_at", { ascending: true })
      .limit(40);

    const lead = (conv as any).leads;
    const channel = (conv as any).channel;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const channelHint = channel === "whatsapp"
      ? "Canal WhatsApp: mensagem curta, até 80 palavras, tom direto."
      : channel === "email"
        ? "Canal Email: até 120 palavras, profissional, pode ter saudação e despedida."
        : "Canal: tom profissional, conciso.";

    const systemPrompt = `Você é um copiloto de vendas B2B (SDR) em português do Brasil.
Um operador humano está conduzindo a conversa e pediu uma sugestão de resposta.
${channelHint}
${intent_hint ? `Intenção desejada: ${intent_hint}` : ""}

Responda APENAS com JSON válido neste formato:
{
  "sentiment": "interesse|objeção|dúvida|rejeição|neutro",
  "reasoning": "1-2 frases sobre a leitura do prospect",
  "suggested_reply": "texto pronto para o operador enviar"
}`;

    const historyFormatted = (msgs || [])
      .map((m: any) => `[${m.direction === "outbound" ? "SDR" : "PROSPECT"}]: ${m.content}`)
      .join("\n");

    const userPrompt = `Lead: ${lead?.name || "N/A"} — Empresa: ${lead?.company_name || "N/A"}

Histórico:
${historyFormatted || "(sem histórico)"}

Sugira a resposta ideal para o SDR enviar agora.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return new Response(JSON.stringify({ error: "Limite de IA atingido. Tente novamente em instantes." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (status === 402) return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Erro ao gerar sugestão" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    let parsed: any;
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      parsed = { sentiment: "neutro", reasoning: "", suggested_reply: content };
    }

    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("human-suggest-reply error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
