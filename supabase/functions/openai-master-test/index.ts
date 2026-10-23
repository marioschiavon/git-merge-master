import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser, requireRole, jsonResponse, errorResponse } from "../_shared/tenant-auth.ts";
import { getFallbackKeys } from "../_shared/ai-fallback.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { user } = await requireUser(req);
    await requireRole(user.id, "master_admin");
    const body = await req.json().catch(() => ({}));
    const keys = await getFallbackKeys();
    if (!keys.openai) {
      return jsonResponse({ ok: false, configured: false, message: "Chave OpenAI não configurada" }, 200, corsHeaders);
    }
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${keys.openai}` },
    });
    if (!r.ok) {
      const text = await r.text();
      return jsonResponse(
        { ok: false, configured: true, status: r.status, message: text.slice(0, 300) },
        200,
        corsHeaders,
      );
    }
    if (body?.completion_test === true) {
      const catalog = await r.json();
      const supported = ["gpt-4o-mini", "gpt-4o"].every(model =>
        catalog.data?.some((entry: { id: string }) => entry.id === model));
      if (!supported) return jsonResponse({ ok: false, configured: true, message: "Modelos de contingência indisponíveis na conta OpenAI." }, 200, corsHeaders);
      const completion = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${keys.openai}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Responda somente OK. Teste de conexão." }], max_tokens: 8 }),
      });
      const result = await completion.json();
      if (!completion.ok || !result.choices?.[0]?.message?.content) {
        return jsonResponse({ ok: false, configured: true, status: completion.status, message: result.error?.message || "A OpenAI não retornou resposta ao teste." }, 200, corsHeaders);
      }
      return jsonResponse({ ok: true, configured: true, status: completion.status, models_available: true, completion_verified: true, message: "Chave OpenAI e geração de resposta verificadas." }, 200, corsHeaders);
    }
    return jsonResponse({ ok: true, configured: true, status: r.status, message: "Chave OpenAI OK." }, 200, corsHeaders);
  } catch (e) {
    return errorResponse(e, corsHeaders);
  }
});
