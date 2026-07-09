// Importa uma transcrição de reunião de kickoff como item de Base de Conhecimento
// protegido (origin='kickoff', locked=true). Só admin da Liderei (master_admin)
// pode chamar quando já existir kickoff — company_admin só na 1ª vez.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

async function summarizeKickoff(transcript: string): Promise<{ title: string; content: string }> {
  const fallback = { title: "Kickoff — resumo", content: transcript.slice(0, 12000) };
  if (!LOVABLE_API_KEY) return fallback;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              'Você recebe a transcrição de uma reunião de kickoff comercial. Extraia em PT-BR e responda APENAS JSON: {"title":"","content":""}. O "content" deve organizar: 1) O que a empresa vende, 2) Proposta de valor e diferenciais, 3) Público-alvo/ICP, 4) Dores que resolve, 5) Histórico (o que já funcionou, o que não funcionou), 6) Objetivos com prospecção, 7) Restrições e tom de voz. Use bullets objetivos, sem enrolação.',
          },
          { role: "user", content: transcript.slice(0, 60000) },
        ],
      }),
    });
    if (!r.ok) return fallback;
    const d = await r.json();
    const raw = d.choices?.[0]?.message?.content || "";
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const parsed = JSON.parse((m ? m[1] : raw).trim());
    if (parsed?.content) return { title: parsed.title || "Kickoff — resumo", content: parsed.content };
    return fallback;
  } catch {
    return fallback;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData } = await supabase.auth.getUser(jwt);
    if (!userData?.user) return json({ error: "unauthorized" }, 401);

    const { data: companyId } = await supabase.rpc("get_user_company_id", { _user_id: userData.user.id });
    if (!companyId) return json({ error: "no company" }, 403);

    const { data: isMaster } = await supabase.rpc("has_role", { _user_id: userData.user.id, _role: "master_admin" });

    const { transcript, title } = await req.json();
    if (!transcript || typeof transcript !== "string" || transcript.trim().length < 100) {
      return json({ error: "transcrição muito curta (mínimo 100 caracteres)" }, 400);
    }

    // company_admin só pode importar se ainda não existir kickoff
    if (!isMaster) {
      const { count } = await supabase.from("company_knowledge")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId).eq("origin", "kickoff");
      if ((count || 0) > 0) return json({ error: "Kickoff já existe. Solicite ao admin da Liderei para atualizar." }, 403);
    }

    const summary = await summarizeKickoff(transcript);
    const finalTitle = title || summary.title || "Base de Kickoff";

    // Usa SERVICE_KEY (bypass RLS) porque locked/origin bloqueia insert direto do cliente
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: inserted, error } = await admin.from("company_knowledge").insert({
      company_id: companyId,
      title: finalTitle,
      content: summary.content,
      type: "text",
      origin: "kickoff",
      locked: true,
      knowledge_type: "kickoff",
    }).select("id").single();
    if (error) return json({ error: error.message }, 500);

    // Dispara embedding
    admin.functions.invoke("embed-knowledge", { body: { knowledge_id: inserted.id } }).catch(() => {});

    return json({ ok: true, id: inserted.id, title: finalTitle });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(o: any, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
