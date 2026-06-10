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

function normalizeInstagramPosts(raw: any[]): any[] {
  return (raw || []).slice(0, 30).map((p: any) => ({
    caption: (p.caption || "").slice(0, 600),
    hashtags: p.hashtags || [],
    mentions: p.mentions || [],
    likes: p.likesCount ?? null,
    comments: p.commentsCount ?? null,
    timestamp: p.timestamp || null,
    url: p.url || (p.shortCode ? `https://instagram.com/p/${p.shortCode}` : null),
    type: p.type || p.productType || null,
  })).filter((p) => p.caption || p.url);
}

function summarizePosts(posts: any[]): string {
  return posts.slice(0, 12).map((p) => {
    const date = p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10) : "—";
    const tags = (p.hashtags || []).slice(0, 5).map((t: string) => `#${t}`).join(" ");
    const cap = (p.caption || "").replace(/\s+/g, " ").slice(0, 220);
    return `- ${date}: "${cap}"${tags ? ` (${tags})` : ""}`;
  }).join("\n");
}

function stripHtmlForText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function normalizePhoneBR(raw: string): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^00/, "").replace(/^0+/, "");
  if (d.length < 10 || d.length > 13) return null;
  if (!d.startsWith("55")) {
    if (d.length === 10 || d.length === 11) d = "55" + d;
    else return null;
  }
  if (d.length !== 12 && d.length !== 13) return null;
  const ddd = d.slice(2, 4);
  if (Number(ddd) < 11 || Number(ddd) > 99) return null;
  const rest = d.slice(4);
  if (/^(\d)\1+$/.test(rest)) return null;
  return "+" + d;
}

function siteDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    return u.hostname.replace(/^www\./, "");
  } catch { return null; }
}

function extractContacts(rawHtml: string, domain?: string | null): { email: string | null; phone: string | null; whatsapp: string | null } {
  const clean = stripHtmlForText(rawHtml);
  const text = clean.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  let whatsapp: string | null = null;
  for (const m of rawHtml.matchAll(/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp:\/\/send)[^"'\s<>]*?(?:phone=)?(\+?\d[\d\s\-().]{8,20})/gi)) {
    const n = normalizePhoneBR(m[1]);
    if (n) { whatsapp = n; break; }
  }

  let email: string | null = null;
  const emails = [...text.matchAll(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase());
  const blacklist = /^(noreply|no-reply|wordpress|postmaster|mailer-daemon|donotreply|example)@/i;
  const cleaned = emails.filter((e) => !blacklist.test(e) && !/\.(png|jpe?g|gif|svg|webp)@/i.test(e));
  if (cleaned.length) {
    if (domain) {
      const same = cleaned.find((e) => e.endsWith("@" + domain.toLowerCase()));
      email = same || cleaned[0];
    } else email = cleaned[0];
  }

  let phone: string | null = null;
  for (const m of text.matchAll(/(\+?55\s*)?\(?\s*(\d{2})\s*\)?[\s.\-]*(9?\d{4})[\s.\-]*(\d{4})/g)) {
    const n = normalizePhoneBR(m[0]);
    if (n) { phone = n; break; }
  }
  return { email, phone, whatsapp };
}

function extractContactsFromSocial(profile: any): { email: string | null; phone: string | null; whatsapp: string | null } {
  const out = { email: null as string | null, phone: null as string | null, whatsapp: null as string | null };
  const raw = profile?.raw || {};
  const bio = profile?.bio || "";
  const owner = raw.owner || raw.firstPost?.owner || {};

  const emailFields = [raw.businessEmail, raw.publicEmail, raw.email, owner.businessEmail, owner.publicEmail];
  for (const e of emailFields) {
    if (typeof e === "string" && /@/.test(e)) { out.email = e.toLowerCase(); break; }
  }
  const phoneFields = [raw.businessPhoneNumber, raw.contactPhone, raw.phone, owner.businessPhoneNumber];
  for (const p of phoneFields) {
    const n = p ? normalizePhoneBR(String(p)) : null;
    if (n) { out.phone = n; break; }
  }

  const text = String(bio);
  if (!out.email) {
    const m = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
    if (m) out.email = m[0].toLowerCase();
  }
  if (!out.phone) {
    const m = text.match(/(\+?55\s*)?\(?\s*\d{2}\s*\)?[\s.\-]*9?\d{4}[\s.\-]*\d{4}/);
    if (m) {
      const n = normalizePhoneBR(m[0]);
      if (n) out.phone = n;
    }
  }

  const links: string[] = [];
  if (raw.externalUrl) links.push(String(raw.externalUrl));
  if (raw.website) links.push(String(raw.website));
  if (Array.isArray(raw.websites)) links.push(...raw.websites.map((w: any) => typeof w === "string" ? w : w?.url).filter(Boolean));
  if (Array.isArray(raw.bioLinks)) links.push(...raw.bioLinks.map((w: any) => w?.url || w?.link).filter(Boolean));
  for (const l of [...links, text]) {
    const m = String(l).match(/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp:\/\/send)[^\s"'<>]*?(?:phone=)?(\+?\d[\d\s\-().]{8,20})/i);
    if (m) {
      const n = normalizePhoneBR(m[1]);
      if (n) { out.whatsapp = n; break; }
    }
  }
  return out;
}

async function fetchContactPages(website: string): Promise<string | null> {
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    const base = `${u.protocol}//${u.hostname}`;
    for (const path of ["/contato", "/contact", "/fale-conosco", "/contact-us"]) {
      const html = await fetchPageHtml(base + path);
      if (html) return html;
    }
  } catch {}
  return null;
}

async function runJob(job_id: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  // Global timeout guard: if pipeline exceeds 220s, mark failed and bail
  const startedAt = Date.now();
  const TIMEOUT_MS = 220_000;
  let timeoutHandle: any;
  const timeoutPromise = new Promise<never>((_, rej) => {
    timeoutHandle = setTimeout(() => rej(new Error("enrich-lead overall timeout (220s)")), TIMEOUT_MS);
  });

  try {
    await Promise.race([(async () => {
    const { data: job, error: jobErr } = await supabase
      .from("lead_enrichment_jobs").select("*").eq("id", job_id).single();
    if (jobErr || !job) throw new Error("Job not found");

    await supabase.from("lead_enrichment_jobs")
      .update({ status: "processing", attempts: (job.attempts || 0) + 1, updated_at: new Date().toISOString() })
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
    const autofillSrc: any = {};

    const autofill = settings.autofill_contacts !== false; // default ON

    // Step 1: fetch website HTML (used for socials, analysis, and contact autofill)
    let pageHtml: string | null = null;
    let pageText = "";
    const needsHtml = !!lead.website && (settings.website_analysis || settings.discover_socials || autofill);
    if (needsHtml) {
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
        if (autofill) {
          const dom = siteDomain(lead.website);
          let contacts = extractContacts(pageHtml, dom);
          // try contact pages if nothing found
          if (!contacts.email && !contacts.phone && !contacts.whatsapp) {
            const ch = await fetchContactPages(lead.website);
            if (ch) contacts = extractContacts(ch, dom);
          }
          if (!lead.email && contacts.email) { leadPatch.email = contacts.email; autofillSrc.email = "website"; }
          if (!lead.phone && contacts.phone) { leadPatch.phone = contacts.phone; autofillSrc.phone = "website"; }
          if (!lead.whatsapp && contacts.whatsapp) { leadPatch.whatsapp = contacts.whatsapp; autofillSrc.whatsapp = "website"; }
        }
      } else {
        steps.discover_socials = steps.discover_socials || "no_html";
      }
    }


    // Step 2: website AI analysis
    if (lead.website && settings.website_analysis !== false && LOVABLE_API_KEY) {
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
          const limit = Math.max(3, Math.min(30, Number(actors.instagram_posts_limit) || 12));
          const r = await runApifyActor(apifyToken, "apify/instagram-scraper", {
            directUrls: [lead.instagram_url],
            resultsType: "posts",
            resultsLimit: limit,
            addParentData: true,
          });
          if (r && Array.isArray(r) && r.length) {
            const posts = normalizeInstagramPosts(r);
            const first: any = r[0] || {};
            const owner: any = first.owner || {};
            await supabase.from("lead_social_profiles").upsert({
              lead_id: lead.id, company_id: lead.company_id, network: "instagram",
              handle: first.ownerUsername || owner.username || handle,
              url: lead.instagram_url,
              bio: owner.biography || first.ownerFullName || null,
              followers: owner.followersCount || first.ownerFollowersCount || null,
              recent_posts: posts,
              posts_summary: summarizePosts(posts),
              raw: { sampleSize: r.length, owner, firstPost: first },
              scraped_at: new Date().toISOString(),
            }, { onConflict: "lead_id,network" });
          }
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

    // Step 3.5: autofill contacts from social profiles (in order: instagram > facebook > linkedin)
    if (autofill) {
      const missing = !lead.email || !lead.phone || !lead.whatsapp;
      if (missing) {
        const { data: profiles } = await supabase
          .from("lead_social_profiles")
          .select("network, bio, raw")
          .eq("lead_id", lead.id);
        const priority = ["instagram", "facebook", "linkedin_company", "linkedin_person"];
        const sorted = (profiles || []).slice().sort(
          (a: any, b: any) => priority.indexOf(a.network) - priority.indexOf(b.network),
        );
        for (const p of sorted) {
          const c = extractContactsFromSocial(p);
          if (!lead.email && !leadPatch.email && c.email) { leadPatch.email = c.email; autofillSrc.email = p.network; }
          if (!lead.phone && !leadPatch.phone && c.phone) { leadPatch.phone = c.phone; autofillSrc.phone = p.network; }
          if (!lead.whatsapp && !leadPatch.whatsapp && c.whatsapp) { leadPatch.whatsapp = c.whatsapp; autofillSrc.whatsapp = p.network; }
        }
      }
      // Fallback: derive whatsapp from a valid BR cell phone
      const finalPhone = leadPatch.phone || lead.phone;
      if (!lead.whatsapp && !leadPatch.whatsapp && finalPhone) {
        const digits = String(finalPhone).replace(/\D/g, "");
        // BR cell: 55 + DDD + 9XXXXXXXX (13 digits)
        if (digits.length === 13 && digits.startsWith("55") && digits[4] === "9") {
          leadPatch.whatsapp = "+" + digits;
          autofillSrc.whatsapp = "phone_derived";
        }
      }
      if (Object.keys(autofillSrc).length) steps.autofill = autofillSrc;
      if (autofillSrc.whatsapp && !lead.whatsapp_source) {
        leadPatch.whatsapp_source = autofillSrc.whatsapp;
      }
      if (Object.keys(leadPatch).length) {
        await supabase.from("leads").update(leadPatch).eq("id", lead.id);
        Object.assign(lead, leadPatch);
      }
    }


    // Step 4: generate first message draft
    if (settings.generate_message && LOVABLE_API_KEY) {
      try {
        const { data: insights } = await supabase.from("lead_insights").select("insights").eq("lead_id", lead.id).maybeSingle();
        const { data: socials } = await supabase.from("lead_social_profiles").select("network, bio, posts_summary, recent_posts").eq("lead_id", lead.id);
        const socialSummary = (socials || []).map((s: any) => {
          const parts = [`[${s.network}] bio: ${(s.bio || "—").slice(0, 300)}`];
          if (s.posts_summary) parts.push(`[${s.network}] últimos posts:\n${s.posts_summary}`);
          else if (s.recent_posts) parts.push(`[${s.network}] posts: ${JSON.stringify(s.recent_posts).slice(0, 500)}`);
          return parts.join("\n");
        }).join("\n\n");
        const ai = await callAI([
          { role: "system", content: `Você é um SDR B2B sênior. Gere uma primeira abordagem altamente personalizada em PT-BR, curta (até 4 frases). Combine sinais do WEBSITE e das REDES SOCIAIS (Instagram, Facebook, LinkedIn). Se houver bio/posts com tema concreto, cite-o no gancho; caso contrário, ancore em proposta de valor ou diferencial do site. Evite elogios genéricos. Responda APENAS JSON: {"subject":"","message":"","hook_used":"","sources":[]}` },
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
      status: "completed", steps_done: steps, error: null, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    await supabase.from("leads").update({
      enrichment_status: "completed", enrichment_updated_at: new Date().toISOString(),
    }).eq("id", lead.id);
    })(), timeoutPromise]);
  } catch (e) {
    console.error("enrich-lead error", e);
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const { data: j } = await supabase.from("lead_enrichment_jobs").select("attempts, lead_id").eq("id", job_id).single();
      const failed = (j?.attempts || 0) >= 3;
      await supabase.from("lead_enrichment_jobs").update({
        status: failed ? "failed" : "pending",
        error: msg,
        next_run_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job_id);
      if (failed && j?.lead_id) {
        await supabase.from("leads").update({ enrichment_status: "failed", enrichment_updated_at: new Date().toISOString() }).eq("id", j.lead_id);
      }
    } catch {}
  } finally {
    clearTimeout(timeoutHandle);
  }
  console.log(`enrich-lead job ${job_id} done in ${Date.now() - startedAt}ms`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { job_id } = await req.json();
    if (!job_id) return new Response(JSON.stringify({ error: "job_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Run in background so request returns immediately (avoids client/cron timeouts)
    // @ts-ignore EdgeRuntime is provided at runtime
    EdgeRuntime.waitUntil(runJob(job_id));

    return new Response(JSON.stringify({ ok: true, accepted: true, job_id }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
