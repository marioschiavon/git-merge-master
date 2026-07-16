// Shared Apollo.io HTTP client + helpers for edge functions.
// Docs: https://docs.apollo.io/reference/

const BASE = "https://api.apollo.io/api/v1";
const TIMEOUT_MS = 15000;
const RATE_LIMIT_PER_MIN = 30;
const CACHE_TTL_HOURS = 24;

export type SupabaseLike = { from: (t: string) => any };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const APOLLO_SENIORITIES = [
  "owner", "founder", "c_suite", "partner", "vp", "head", "director",
  "manager", "senior", "entry", "intern",
] as const;

export const APOLLO_EMPLOYEE_RANGES = [
  "1,10", "11,20", "21,50", "51,100", "101,200",
  "201,500", "501,1000", "1001,2000", "2001,5000", "5001,10000", "10001",
] as const;

export type ApolloPerson = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  seniority?: string | null;
  departments?: string[] | null;
  phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string; type?: string }> | null;
  organization?: {
    id?: string;
    name?: string;
    website_url?: string;
    primary_domain?: string;
    industry?: string;
    estimated_num_employees?: number;
    linkedin_url?: string;
  } | null;
};

export type ApolloSearchFilters = {
  q_keywords?: string;
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  organization_industries?: string[];
  organization_num_employees_ranges?: string[];
  per_page?: number;
};

// ---------------------------------------------------------------------------
// Telemetry + rate limit
// ---------------------------------------------------------------------------

async function logCall(supabase: SupabaseLike, args: {
  company_id: string;
  endpoint: string;
  status_code: number | null;
  credits_consumed: number | null;
  latency_ms: number;
  request_summary?: Record<string, unknown>;
  error?: string | null;
  triggered_by?: string | null;
}) {
  try {
    await supabase.from("apollo_api_calls").insert({
      company_id: args.company_id,
      endpoint: args.endpoint,
      status_code: args.status_code,
      credits_consumed: args.credits_consumed,
      latency_ms: args.latency_ms,
      request_summary: args.request_summary ?? {},
      error: args.error ?? null,
      triggered_by: args.triggered_by ?? null,
    });
  } catch { /* never fatal */ }
}

async function checkRateLimit(supabase: SupabaseLike, company_id: string) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from("apollo_api_calls")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company_id)
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_LIMIT_PER_MIN) {
    throw new Error(`Limite local de ${RATE_LIMIT_PER_MIN} chamadas/min atingido. Aguarde alguns segundos.`);
  }
}

// ---------------------------------------------------------------------------
// Low-level HTTP
// ---------------------------------------------------------------------------

export type ApolloCallOptions = {
  endpoint: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  apiKey: string;
  company_id: string;
  triggered_by?: string | null;
  supabase: SupabaseLike;
  request_summary?: Record<string, unknown>;
  skipRateLimit?: boolean;
};

export async function callApollo<T = any>(opts: ApolloCallOptions): Promise<T> {
  if (!opts.skipRateLimit) await checkRateLimit(opts.supabase, opts.company_id);

  const url = `${BASE}/${opts.endpoint}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const started = Date.now();

  let status: number | null = null;
  let creditsConsumed: number | null = null;
  let errorMsg: string | null = null;
  let parsed: any = null;

  try {
    const res = await fetch(url, {
      method: opts.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": opts.apiKey,
      },
      body: opts.method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
      signal: ctrl.signal,
    });
    status = res.status;

    const credHeader = res.headers.get("x-credits-consumed") ?? res.headers.get("x-credit-consumed");
    if (credHeader && !Number.isNaN(Number(credHeader))) creditsConsumed = Number(credHeader);

    const text = await res.text();
    parsed = text ? safeJson(text) : null;

    if (!res.ok) {
      const apiMsg = parsed?.error ?? parsed?.message ?? parsed?.errors?.[0]?.message ?? text.slice(0, 200);
      errorMsg = `Apollo ${res.status}: ${apiMsg}`;
      throw new Error(humanizeApolloError(res.status, apiMsg));
    }
    return parsed as T;
  } catch (e: any) {
    if (!errorMsg) errorMsg = e?.message ?? String(e);
    throw e;
  } finally {
    clearTimeout(timer);
    await logCall(opts.supabase, {
      company_id: opts.company_id,
      endpoint: opts.endpoint,
      status_code: status,
      credits_consumed: creditsConsumed,
      latency_ms: Date.now() - started,
      request_summary: opts.request_summary,
      error: errorMsg,
      triggered_by: opts.triggered_by ?? null,
    });
  }
}

function safeJson(text: string) { try { return JSON.parse(text); } catch { return null; } }

function humanizeApolloError(status: number, msg: string): string {
  if (status === 401 || status === 403) return "API key Apollo inválida ou sem permissão. Verifique em Apollo → Settings → API.";
  if (status === 404) return "Endpoint Apollo não encontrado (404). Pode ser uma versão de API desatualizada.";
  if (status === 422) return `Filtros inválidos: ${msg}`;
  if (status === 429) return "Apollo retornou 429 (rate limit). Aguarde alguns minutos.";
  if (status >= 500) return `Apollo está instável (${status}). Tente novamente em instantes.`;
  return msg || `Erro ${status} ao chamar Apollo.`;
}

// ---------------------------------------------------------------------------
// High-level: validate + search
// ---------------------------------------------------------------------------

export async function validateApolloKey(args: {
  apiKey: string; company_id: string; supabase: SupabaseLike; triggered_by?: string | null;
}): Promise<{ ok: true }> {
  await callApollo<any>({
    endpoint: "mixed_people/api_search",
    method: "POST",
    body: { page: 1, per_page: 1 },
    apiKey: args.apiKey,
    company_id: args.company_id,
    supabase: args.supabase,
    triggered_by: args.triggered_by,
    skipRateLimit: true,
  });
  return { ok: true };
}

export function normalizeFilters(f: ApolloSearchFilters, page = 1) {
  const clean: Record<string, unknown> = {
    page,
    per_page: Math.min(Math.max(f.per_page ?? 25, 1), 100),
  };
  if (f.q_keywords?.trim()) clean.q_keywords = f.q_keywords.trim();
  if (f.person_titles?.length) clean.person_titles = f.person_titles;
  if (f.person_seniorities?.length) clean.person_seniorities = f.person_seniorities;
  if (f.person_locations?.length) clean.person_locations = f.person_locations;
  if (f.organization_locations?.length) clean.organization_locations = f.organization_locations;
  if (f.organization_industries?.length) clean.organization_industries = f.organization_industries;
  if (f.organization_num_employees_ranges?.length)
    clean.organization_num_employees_ranges = f.organization_num_employees_ranges;
  return clean;
}

export async function hashFilters(filters: Record<string, unknown>): Promise<string> {
  const sorted = JSON.stringify(filters, Object.keys(filters).sort());
  const buf = new TextEncoder().encode(sorted);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function searchPeopleWithCache(args: {
  supabase: SupabaseLike;
  company_id: string;
  triggered_by?: string | null;
  apiKey: string;
  filters: ApolloSearchFilters;
  page: number;
}) {
  const normalized = normalizeFilters(args.filters, args.page);
  const filtersWithoutPage = { ...normalized };
  delete (filtersWithoutPage as any).page;
  const queryHash = await hashFilters(filtersWithoutPage);
  const nowIso = new Date().toISOString();

  const { data: cached } = await args.supabase
    .from("apollo_search_cache")
    .select("results, total_entries")
    .eq("company_id", args.company_id)
    .eq("query_hash", queryHash)
    .eq("page", args.page)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (cached?.results) {
    const people = (cached.results as any)?.people ?? [];
    const pagination = (cached.results as any)?.pagination ?? {
      page: args.page, per_page: normalized.per_page,
      total_entries: cached.total_entries ?? people.length, total_pages: 1,
    };
    return { people, pagination, fromCache: true };
  }

  const data = await callApollo<{ people: ApolloPerson[]; pagination: any }>({
    endpoint: "mixed_people/api_search",
    method: "POST",
    body: normalized,
    apiKey: args.apiKey,
    company_id: args.company_id,
    supabase: args.supabase,
    triggered_by: args.triggered_by,
    request_summary: { filters: filtersWithoutPage, page: args.page },
  });

  const people = data?.people ?? [];
  const pagination = data?.pagination ?? {
    page: args.page, per_page: normalized.per_page,
    total_entries: people.length, total_pages: 1,
  };

  try {
    const expires = new Date(Date.now() + CACHE_TTL_HOURS * 3600_000).toISOString();
    await args.supabase.from("apollo_search_cache").upsert({
      company_id: args.company_id,
      query_hash: queryHash,
      filters: filtersWithoutPage,
      results: { people, pagination },
      total_entries: pagination?.total_entries ?? people.length,
      page: args.page,
      expires_at: expires,
    }, { onConflict: "company_id,query_hash,page" });
  } catch { /* ignore */ }

  return { people, pagination, fromCache: false };
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function isUsableEmail(email: unknown, status?: unknown): boolean {
  if (!email || typeof email !== "string") return false;
  const lower = email.toLowerCase();
  if (lower.includes("email_not_unlocked")) return false;
  if (lower.includes("domain.com") && lower.startsWith("email_")) return false;
  if (typeof status === "string") {
    const s = status.toLowerCase();
    if (s === "unavailable" || s === "bounced" || s === "locked") return false;
  }
  return true;
}

export function mapPersonToLeadPayload(p: ApolloPerson, company_id: string): Record<string, any> {
  const fullName =
    (p.name && p.name.trim()) ||
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim() ||
    (isUsableEmail(p.email, p.email_status) ? (p.email as string) : null) ||
    `Apollo #${p.id}`;

  // Categorize phones by type when available
  const phones = p.phone_numbers ?? [];
  const pick = (t: string) =>
    phones.find((ph) => (ph.type ?? "").toLowerCase().includes(t))?.sanitized_number ??
    phones.find((ph) => (ph.type ?? "").toLowerCase().includes(t))?.raw_number ??
    null;
  const primaryPhone = phones[0]?.sanitized_number ?? phones[0]?.raw_number ?? null;
  const mobilePhone = pick("mobile") ?? pick("cell");
  const corporatePhone = pick("work") ?? pick("office") ?? pick("corporate") ?? pick("direct");

  const org = p.organization ?? null;
  const usableEmail = isUsableEmail(p.email, p.email_status) ? p.email : null;

  const address = [p.city, p.state, p.country].filter(Boolean).join(", ") || null;
  const department = Array.isArray(p.departments) && p.departments.length
    ? p.departments.join(", ")
    : null;

  return {
    company_id,
    name: fullName,
    first_name: p.first_name ?? null,
    last_name: p.last_name ?? null,
    email: usableEmail,
    title: p.title ?? null,
    company_name: org?.name ?? null,
    website: org?.website_url ?? null,
    linkedin_url: p.linkedin_url ?? null,
    linkedin_company_url: org?.linkedin_url ?? null,
    address,
    city: p.city ?? null,
    state: p.state ?? null,
    country: p.country ?? null,
    seniority: p.seniority ?? null,
    department,
    industry: org?.industry ?? null,
    employee_count: typeof org?.estimated_num_employees === "number" ? org.estimated_num_employees : null,
    phone: primaryPhone,
    mobile_phone: mobilePhone,
    corporate_phone: corporatePhone,
    source: "apollo",
    apollo_person_id: p.id,
  };
}

// Only fills missing fields; never overwrites.
export function mergeLeadPatch(existing: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
  const patch: Record<string, any> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "company_id") continue;
    if (v == null || v === "") continue;
    const cur = existing?.[k];
    const empty = cur == null || cur === "" || (Array.isArray(cur) && cur.length === 0);
    if (empty) patch[k] = v;
  }
  if (incoming.apollo_person_id && !existing?.apollo_person_id) {
    patch.apollo_person_id = incoming.apollo_person_id;
  }
  return patch;
}
