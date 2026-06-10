import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchPageHtml(rawUrl: string): Promise<string | null> {
  let url = rawUrl.trim();
  if (!url.startsWith("http")) url = `https://${url}`;
  const candidates = [url];
  try {
    const u = new URL(url);
    if (!u.hostname.startsWith("www.")) candidates.push(`${u.protocol}//www.${u.hostname}${u.pathname}`);
  } catch {}
  for (const c of candidates) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(c, { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": UA } });
      clearTimeout(t);
      if (r.ok) return await r.text();
      await r.body?.cancel();
    } catch {}
  }
  return null;
}

function extractSocials(html: string) {
  const out: Record<string, string | null> = {
    instagram_url: null, facebook_url: null, linkedin_url: null, linkedin_company_url: null,
  };
  const ig = html.match(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (ig) out.instagram_url = `https://instagram.com/${ig[1].replace(/\/$/, "")}`;
  const fb = html.match(/https?:\/\/(?:www\.|web\.|m\.)?facebook\.com\/([A-Za-z0-9.\-]+)/i);
  if (fb && !["sharer", "plugins", "tr"].includes(fb[1].toLowerCase())) {
    out.facebook_url = `https://facebook.com/${fb[1].replace(/\/$/, "")}`;
  }
  const liC = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/([A-Za-z0-9\-_%]+)/i);
  if (liC) out.linkedin_company_url = `https://linkedin.com/company/${liC[1].replace(/\/$/, "")}`;
  const liP = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]+)/i);
  if (liP) out.linkedin_url = `https://linkedin.com/in/${liP[1].replace(/\/$/, "")}`;
  return out;
}

function htmlToText(raw: string) {
  return raw.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim().slice(0, 15000);
}

async function callAI(messages: any[]): Promise<string> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-flash", messages }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "";
}

function parseJsonBlob(s: string) {
  try {
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse((m ? m[1] : s).trim());
  } catch { return null; }
}

async function runApifyActor(token: string, actorId: string, input: any): Promise<any[] | null> {
  try {
    const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${token}&timeout=90`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 95000);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) {
      console.warn(`Apify ${actorId} ${r.status}: ${await r.text()}`);
      return null;
    }
    return await r.json();
  } catch (e) {
    console.warn(`Apify ${actorId} failed`, e);
    return null;
  }
}

function handleFromUrl(url: string, prefix: string): string | null {
  const m = url.match(new RegExp(`${prefix}/([A-Za-z0-9_.\\-]+)`, "i"));
  return m ? m[1] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { job_id } = await req.json();
    if (!job_id) return new Response(JSON.stringify({ error: "job_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: job, error: jobErr } = await supabase
      .from("lead_enrichment_jobs").select("*").eq("id", job_id).single();
    if (jobErr || !job) throw new Error("Job not found");

    await supabase.from("lead_enrichment_jobs")
      .update({ status: "processing", attempts: (job.attempts || 0) + 1 })
      .eq("id", job.id);

    const { data: lead } = await supabase.from("leads").select("*").eq("id", job.lead_id).single();
    if (!lead) throw new Error("Lead not found");

    const { data: company } = await supabase.from("companies").select("enrichment_settings").eq("id", job.company_id).single();
    const settings: any = company?.enrichment_settings || {};

    const { data: apifyIntegration } = await supabase
      .from("integrations").select("api_token, config")
      .eq("company_id", job.company_id).eq("provider", "apify").maybeSingle();
    const apifyToken = apifyIntegration?.api_token;

    const steps: any = { ...(job.steps_done || {}) };
    const leadPatch: any = {};

    // Step 1: discover socials from website (and analyze)
    let pageHtml: string | null = null;
    let pageText = "";
    if (lead.website && (settings.website_analysis || settings.discover_socials)) {
      pageHtml = await fetchPageHtml(lead.website);
      if (pageHtml) {
        pageText = htmlToText(pageHtml);
        if (settings.discover_socials) {
          const found = extractSocials(pageHtml);
          for (const k of Object.keys(found)) {
            if (!lead[k] && found[k]) leadPatch[k] = found[k];
          }
          steps.discover_socials = "ok";
        }
      } else {
        steps.discover_socials = "no_html";
      }
    }

    // Step 2: website AI analysis
    if (lead.website && settings.website_analysis && LOVABLE_API_KEY) {
      try {
        const content = pageText || `(Site indisponível; analise por nome/domínio: ${lead.website})`;
        const ai = await callAI([
          { role: "system", content: `Você é especialista em inteligência comercial B2B. Responda APENAS JSON: {"proposta_valor":"","produtos":[],"diferenciais":[],"publico_alvo":"","pain_points":[],"oportunidades_abordagem":[{"gancho":"","mensagem_sugerida":""}],"resumo":""}` },
          { role: "user", content: `Site ${lead.website} da empresa "${lead.company_name || lead.name}":\n\n${content}` },
        ]);
        const insights = parseJsonBlob(ai) || { resumo: ai };
        await supabase.from("lead_insights").upsert({
          lead_id: lead.id, company_id: lead.company_id, website_url: lead.website,
          insights, raw_summary: insights.resumo || ai, analyzed_at: new Date().toISOString(),
        }, { onConflict: "lead_id" });
        steps.website_analysis = "ok";
      } catch (e) {
        steps.website_analysis = `error: ${e instanceof Error ? e.message : e}`;
      }
    }

    // Apply socials discovered before running scrape
    if (Object.keys(leadPatch).length) {
      await supabase.from("leads").update(leadPatch).eq("id", lead.id);
      Object.assign(lead, leadPatch);
    }

    // Step 3: Apify scrape
    if (settings.apify_scrape && apifyToken) {
      const actors: any = settings.apify_actors || {};
      const tasks: Promise<void>[] = [];

      const upsertProfile = async (network: string, handle: string | null, url: string | null, raw: any) => {
        const first = Array.isArray(raw) ? raw[0] : raw;
        await supabase.from("lead_social_profiles").upsert({
          lead_id: lead.id, company_id: lead.company_id, network, handle, url,
          bio: first?.biography || first?.description || first?.about || null,
          followers: first?.followersCount || first?.followers || null,
          recent_posts: first?.latestPosts || first?.posts || null,
          raw: first || raw, scraped_at: new Date().toISOString(),
        }, { onConflict: "lead_id,network" });
      };

      if (actors.instagram !== false && lead.instagram_url) {
        const handle = handleFromUrl(lead.instagram_url, "instagram\\.com");
        if (handle) tasks.push((async () => {
          const r = await runApifyActor(apifyToken, "apify/instagram-profile-scraper", { usernames: [handle] });
          if (r) await upsertProfile("instagram", handle, lead.instagram_url, r);
        })());
      }
      if (actors.facebook !== false && lead.facebook_url) {
        tasks.push((async () => {
          const r = await runApifyActor(apifyToken, "apify/facebook-pages-scraper", { startUrls: [{ url: lead.facebook_url }] });
          if (r) await upsertProfile("facebook", handleFromUrl(lead.facebook_url, "facebook\\.com"), lead.facebook_url, r);
        })());
      }
      if (actors.linkedin_person !== false && lead.linkedin_url) {
        tasks.push((async () => {
          const r = await runApifyActor(apifyToken, "dev_fusion/linkedin-profile-scraper", { profileUrls: [lead.linkedin_url] });
          if (r) await upsertProfile("linkedin_person", handleFromUrl(lead.linkedin_url, "linkedin\\.com/in"), lead.linkedin_url, r);
        })());
      }
      if (actors.linkedin_company !== false && lead.linkedin_company_url) {
        tasks.push((async () => {
          const r = await runApifyActor(apifyToken, "apimaestro/linkedin-company", { companyUrls: [lead.linkedin_company_url] });
          if (r) await upsertProfile("linkedin_company", handleFromUrl(lead.linkedin_company_url, "linkedin\\.com/company"), lead.linkedin_company_url, r);
        })());
      }
      await Promise.allSettled(tasks);
      steps.apify_scrape = `ran ${tasks.length}`;
    }

    // Step 4: generate first message draft
    if (settings.generate_message && LOVABLE_API_KEY) {
      try {
        const { data: insights } = await supabase.from("lead_insights").select("insights").eq("lead_id", lead.id).maybeSingle();
        const { data: socials } = await supabase.from("lead_social_profiles").select("network, bio, recent_posts").eq("lead_id", lead.id);
        const socialSummary = (socials || []).map(s => `[${s.network}] bio: ${(s.bio || "").slice(0, 300)} | posts: ${JSON.stringify(s.recent_posts || []).slice(0, 500)}`).join("\n");
        const ai = await callAI([
          { role: "system", content: `Você é um SDR B2B sênior. Gere uma primeira abordagem altamente personalizada em PT-BR, curta (até 4 frases), com gancho específico baseado nos dados fornecidos. Responda APENAS JSON: {"subject":"","message":"","hook_used":"","sources":[]}` },
          { role: "user", content: `Lead: ${lead.name} (${lead.title || "cargo n/d"}) da ${lead.company_name || "empresa n/d"}.\n\nInsights do site:\n${JSON.stringify(insights?.insights || {}, null, 2)}\n\nRedes sociais:\n${socialSummary || "(nenhuma)"}` },
        ]);
        const draft = parseJsonBlob(ai) || { subject: null, message: ai, hook_used: null, sources: [] };
        const cadenceId: string | null = settings.default_cadence_id || null;
        if (cadenceId) {
          const { data: firstStep } = await supabase.from("cadence_steps")
            .select("id").eq("cadence_id", cadenceId).order("step_order", { ascending: true }).limit(1).maybeSingle();
          if (firstStep) {
            let { data: enrollment } = await supabase.from("cadence_enrollments")
              .select("id").eq("lead_id", lead.id).eq("cadence_id", cadenceId).maybeSingle();
            if (!enrollment) {
              const ins = await supabase.from("cadence_enrollments")
                .insert({ lead_id: lead.id, cadence_id: cadenceId, company_id: lead.company_id, status: "draft" })
                .select("id").single();
              enrollment = ins.data;
            }
            if (enrollment) {
              await supabase.from("cadence_custom_messages").upsert({
                enrollment_id: enrollment.id, step_id: firstStep.id, lead_id: lead.id,
                company_id: lead.company_id, subject: draft.subject, message: draft.message,
              }, { onConflict: "enrollment_id,step_id" });
            }
          }
        }
        steps.generate_message = { ok: true, hook: draft.hook_used };
      } catch (e) {
        steps.generate_message = `error: ${e instanceof Error ? e.message : e}`;
      }
    }

    await supabase.from("lead_enrichment_jobs").update({
      status: "completed", steps_done: steps, error: null,
    }).eq("id", job.id);
    await supabase.from("leads").update({
      enrichment_status: "completed", enrichment_updated_at: new Date().toISOString(),
    }).eq("id", lead.id);

    return new Response(JSON.stringify({ ok: true, steps }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("enrich-lead error", e);
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      const { job_id } = await req.clone().json().catch(() => ({}));
      if (job_id) {
        const { data: j } = await supabase.from("lead_enrichment_jobs").select("attempts, lead_id").eq("id", job_id).single();
        const failed = (j?.attempts || 0) >= 3;
        await supabase.from("lead_enrichment_jobs").update({
          status: failed ? "failed" : "pending",
          error: msg,
          next_run_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        }).eq("id", job_id);
        if (failed && j?.lead_id) {
          await supabase.from("leads").update({ enrichment_status: "failed", enrichment_updated_at: new Date().toISOString() }).eq("id", j.lead_id);
        }
      }
    } catch {}
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
