// Compute a display name for leads that don't have a personal name yet
// (lead_kind='company'). Priority: company_name → website host → instagram handle → fallback.
export function computeLeadDisplayName(input: {
  name?: string | null;
  company_name?: string | null;
  website?: string | null;
  instagram_url?: string | null;
  linkedin_company_url?: string | null;
}): string {
  const n = (input.name || "").trim();
  if (n) return n;

  const company = (input.company_name || "").trim();
  if (company) return company;

  const fromHost = (url?: string | null): string | null => {
    if (!url) return null;
    try {
      const u = new URL(url.startsWith("http") ? url : `https://${url}`);
      const host = u.hostname.replace(/^www\./, "");
      return host || null;
    } catch {
      return null;
    }
  };

  const site = fromHost(input.website);
  if (site) return site;

  const ig = (input.instagram_url || "").trim();
  if (ig) {
    const handle = ig.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/+$/, "");
    if (handle) return `@${handle}`;
  }

  const liHost = fromHost(input.linkedin_company_url);
  if (liHost) return liHost;

  return "Contato sem nome";
}

export function hasAnyCompanySignal(input: {
  company_name?: string | null;
  website?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  instagram_url?: string | null;
  linkedin_company_url?: string | null;
  email?: string | null;
}): boolean {
  return Boolean(
    input.company_name?.trim() ||
    input.website?.trim() ||
    input.whatsapp?.trim() ||
    input.phone?.trim() ||
    input.instagram_url?.trim() ||
    input.linkedin_company_url?.trim() ||
    input.email?.trim()
  );
}
