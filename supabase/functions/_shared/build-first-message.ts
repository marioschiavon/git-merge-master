// Shared first-message builder. Used by agentic cadences to generate the
// initial outreach with the SAME criteria/tone engine used by static cadences
// (company knowledge + highlights + ai_instructions + lead insights + social).
//
// Returns { subject, message }. Does NOT send — caller is responsible for delivery.

export type FirstMessageInput = {
  supabase: any;
  lovableApiKey: string;
  companyId: string;
  lead: any;
  channel: "whatsapp" | "email";
  tone?: string | null;        // policy.tone_instructions
  goal?: string | null;        // policy.goal
  useHighlights?: boolean;     // default true
  useMentalTriggers?: boolean; // default false
  mentalTriggers?: string[];
};

export type FirstMessageOutput = {
  subject: string | null;
  message: string;
};

export async function buildFirstMessage(input: FirstMessageInput): Promise<FirstMessageOutput> {
  const {
    supabase, lovableApiKey, companyId, lead, channel,
    tone, goal,
    useHighlights = true,
    useMentalTriggers = false,
    mentalTriggers = [],
  } = input;

  const [knowledgeRes, highlightsRes, aiInstructionsRes, insightRes, socialRes] = await Promise.all([
    supabase.from("company_knowledge").select("title, content").eq("company_id", companyId).not("type", "in", "(highlights,ai_instructions)").limit(10),
    supabase.from("company_knowledge").select("content").eq("company_id", companyId).eq("type", "highlights").maybeSingle(),
    supabase.from("company_knowledge").select("content").eq("company_id", companyId).eq("type", "ai_instructions").maybeSingle(),
    supabase.from("lead_insights").select("insights, raw_summary").eq("lead_id", lead.id).maybeSingle(),
    supabase.from("lead_social_profiles").select("network, handle, bio, followers, posts_summary, recent_posts").eq("lead_id", lead.id),
  ]);

  const knowledgeContext = (knowledgeRes.data || [])
    .map((k: any) => `## ${k.title}\n${k.content}`)
    .join("\n\n");

  let insightsContext = "";
  if (insightRes.data?.insights) {
    const ins = insightRes.data.insights as any;
    if (ins.diferenciais?.length) {
      insightsContext = `\n\nDIFERENCIAIS DO PROSPECT (obtidos do website do lead):\n${ins.diferenciais.join(", ")}\n\nUse esses diferenciais para criar um gancho direto entre o que o prospect faz de melhor e como seu produto/serviço potencializa isso.`;
    }
  }

  let socialContext = "";
  const socialProfiles = socialRes.data || [];
  if (socialProfiles.length > 0) {
    const parts: string[] = [];
    for (const p of socialProfiles as any[]) {
      const hasContent = p.bio || p.posts_summary || (Array.isArray(p.recent_posts) && p.recent_posts.length > 0);
      if (!hasContent) continue;
      const lines: string[] = [];
      lines.push(`### ${p.network}${p.handle ? ` (@${p.handle})` : ""}${p.followers ? ` — ${p.followers} seguidores` : ""}`);
      if (p.bio) lines.push(`Bio: ${String(p.bio).slice(0, 400)}`);
      if (p.posts_summary) lines.push(`Resumo de posts: ${String(p.posts_summary).slice(0, 800)}`);
      if (Array.isArray(p.recent_posts) && p.recent_posts.length > 0) {
        const top = p.recent_posts.slice(0, 3).map((rp: any, i: number) => {
          const cap = rp?.caption || rp?.text || rp?.title || "";
          return `  ${i + 1}. ${String(cap).slice(0, 200)}`;
        }).filter((s: string) => s.trim().length > 4).join("\n");
        if (top.trim()) lines.push(`Últimos posts:\n${top}`);
      }
      parts.push(lines.join("\n"));
    }
    if (parts.length > 0) {
      socialContext = `\n\nSINAIS DE REDES SOCIAIS DO PROSPECT:\n${parts.join("\n\n")}\n\nQuando relevante, prefira referenciar um post/tema concreto recente em vez de gancho genérico. Nunca invente.`;
    }
  }

  const stepHighlights = (useHighlights && highlightsRes.data?.content)
    ? `\n\n=== DESTAQUES IMPORTANTES DA EMPRESA (use como argumentos de autoridade) ===\n${highlightsRes.data.content}\n\nOBRIGATÓRIO: Mencione pelo menos 1 destaque da empresa acima como argumento de credibilidade na mensagem.`
    : "";

  const triggersBlock = (useMentalTriggers && mentalTriggers.length > 0)
    ? `\n\nGATILHOS MENTAIS OBRIGATÓRIOS: Use os seguintes gatilhos mentais de vendas na mensagem de forma natural e persuasiva: ${mentalTriggers.join(", ")}. Integre-os ao texto sem ser óbvio ou forçado.`
    : "";

  const toneBlock = tone
    ? `\n\n=== TOM / INSTRUÇÕES DA CADÊNCIA ===\n${tone}`
    : "";

  const goalLine = goal ? `\nOBJETIVO DA CADÊNCIA: ${goal}` : "";

  const systemPrompt = `Você é um SDR especialista em vendas B2B no Brasil. Seu objetivo PRINCIPAL é agendar uma reunião com o prospect.
${goalLine}

${aiInstructionsRes.data?.content ? `=== INSTRUÇÕES OBRIGATÓRIAS DA EMPRESA (PRIORIDADE MÁXIMA — sobrescrevem qualquer outra regra abaixo) ===
${aiInstructionsRes.data.content}

Se as regras acima disserem que o prospect não tem fit com seu produto/serviço, NÃO force gancho — escreva uma abordagem neutra de apresentação e pergunte se faz sentido conversar.

` : ""}=== SEU PRODUTO/SERVIÇO (o que você vende) ===
${knowledgeContext || "Sem informações adicionais do produto."}
${stepHighlights}

=== DIFERENCIAIS DO PROSPECT ===
${insightsContext || "Sem diferenciais disponíveis do prospect."}

=== SINAIS DE REDES SOCIAIS DO PROSPECT (Instagram, LinkedIn, etc.) ===
${socialContext || "(sem dados de redes sociais)"}
${triggersBlock}${toneBlock}

CANAL: ${channel}
CONTEXTO: PRIMEIRO CONTATO (abertura da cadência)

REGRAS DE PERSONALIZAÇÃO:
- Faça um gancho com 1 diferencial do prospect APENAS SE houver relação clara e coerente com o produto/serviço (respeitando as INSTRUÇÕES OBRIGATÓRIAS DA EMPRESA acima)
- Se houver fit: estrutura sugerida — "Vi que vocês [diferencial do prospect] → nosso [produto/solução] potencializa isso porque [benefício concreto]"
- Se NÃO houver fit claro: NÃO invente conexão. Faça abordagem neutra focada no segmento do prospect e termine perguntando se faz sentido conversar.
- Nunca seja genérico, mas também nunca force uma ligação sem sentido

REGRAS GERAIS:
- Mantenha o tom profissional mas humano (respeite o TOM da cadência acima)
- ${channel === "whatsapp" ? "WhatsApp: mensagem curta, até 80 palavras, informal, sem assinatura formal" : ""}
- ${channel === "email" ? `Email: MÁXIMO 80 palavras. Estrutura obrigatória:
  1. HOOK (1 frase): Comece com algo específico do prospect que chame atenção
  2. CONEXÃO (1-2 frases): Ligue o hook diretamente a 1 benefício concreto do seu produto/serviço
  3. CTA (1 frase): Pergunta direta para agendar reunião de 15min
  - Subject: máximo 6 palavras, curioso, referenciando o negócio do prospect. NUNCA genérico.
  - PROIBIDO: "Meu nome é...", "Somos uma empresa...", "Gostaria de me apresentar...", introduções longas
  - Tom: direto, confiante, como se já conhecesse o mercado do prospect` : ""}
- SEMPRE inclua um CTA claro para agendar reunião

Responda APENAS com JSON:
{
  "subject": "assunto do email (apenas para email, null para outros canais)",
  "message": "mensagem personalizada para enviar"
}`;

  const userPrompt = `Dados do lead:
- Nome: ${lead.name}
- Email: ${lead.email || "N/A"}
- Telefone: ${lead.phone || lead.whatsapp || "N/A"}
- Empresa: ${lead.company_name || "N/A"}
- Cargo: ${lead.title || "N/A"}

Gere a PRIMEIRA mensagem (abertura da cadência).`;

  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  let subject: string | null = null;
  let message = "";

  if (aiRes.ok) {
    const aiData = await aiRes.json();
    const aiContent = aiData.choices?.[0]?.message?.content || "";
    try {
      const m = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiContent];
      const parsed = JSON.parse(m[1].trim());
      subject = parsed.subject ?? null;
      message = parsed.message || aiContent;
    } catch {
      message = aiContent;
    }
  } else {
    const errTxt = await aiRes.text();
    console.error("buildFirstMessage AI error", aiRes.status, errTxt);
    throw new Error(`AI gateway error ${aiRes.status}`);
  }

  if (channel !== "email") subject = null;
  return { subject, message };
}
