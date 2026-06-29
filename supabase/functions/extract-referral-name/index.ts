// Extracts the full name of a referred contact from a lead's inbound message.
// Used as a fallback when the deterministic regex extractor detects a name
// context but fails to capture a confident full name (e.g. "Dra. Claudia",
// composite names, atypical punctuation).
//
// Input: { text: string }
// Output: { name: string | null, confidence: "high" | "low" }
//
// Server-to-server only. Cheap & fast model (gemini-3-flash-preview).

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { chatCompletion } from "../_shared/ai-gateway.ts";

const MAX_INPUT_CHARS = 500;

const SYSTEM_PROMPT = `Você extrai o nome COMPLETO de uma pessoa INDICADA em uma mensagem de WhatsApp/email em português brasileiro.

Regras:
- Retorne APENAS o nome da pessoa indicada (terceira pessoa), NUNCA o nome do remetente.
- Inclua o título quando citado: "Dr.", "Dra.", "Sr.", "Sra.", "Prof.".
- Se houver sobrenome, inclua-o.
- Não invente nome. Se não houver nome claro de uma pessoa indicada, retorne null.
- Retorne SOMENTE JSON válido no formato: {"name": string|null, "confidence": "high"|"low"}
- "high" = nome próprio explícito; "low" = só um título sem nome ou apelido genérico.

Exemplos:
Texto: "fala com a Dra. Claudia Silva"  → {"name":"Dra. Claudia Silva","confidence":"high"}
Texto: "pode falar com o Dr João"        → {"name":"Dr João","confidence":"high"}
Texto: "fala com a Dra"                   → {"name":null,"confidence":"low"}
Texto: "quem cuida disso é o financeiro" → {"name":null,"confidence":"low"}
Texto: "ok, obrigado"                     → {"name":null,"confidence":"low"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return new Response(
        JSON.stringify({ error: "missing 'text'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const truncated = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;

    const completion = await chatCompletion({
      model: "google/gemini-3-flash-preview",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Texto: """${truncated}"""` },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content;
    const rawStr = typeof raw === "string" ? raw : "";
    let parsed: { name?: unknown; confidence?: unknown } = {};
    try {
      parsed = JSON.parse(rawStr);
    } catch {
      // Tenta extrair JSON cercado por texto.
      const m = rawStr.match(/\{[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
      }
    }

    const nameRaw = typeof parsed.name === "string" ? parsed.name.trim() : null;
    const confidence: "high" | "low" = parsed.confidence === "high" ? "high" : "low";
    // Saneamento básico: limita comprimento, descarta vazio / "null".
    const name = nameRaw && nameRaw.toLowerCase() !== "null" && nameRaw.length <= 80
      ? nameRaw
      : null;

    return new Response(
      JSON.stringify({ name, confidence }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("extract-referral-name error:", err);
    // Fallback seguro: nunca quebra o caller — devolve null.
    return new Response(
      JSON.stringify({ name: null, confidence: "low", error: String(err) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
