// Helper para chamadas Resend via connector gateway Lovable.
const GATEWAY = "https://connector-gateway.lovable.dev/resend";

export class ResendNotConfiguredError extends Error {
  constructor() { super("Resend connector não configurado"); this.name = "ResendNotConfiguredError"; }
}

function keys() {
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!lovableKey || !resendKey) throw new ResendNotConfiguredError();
  return { lovableKey, resendKey };
}

export async function resendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { lovableKey, resendKey } = keys();
  const url = `${GATEWAY}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${lovableKey}`);
  headers.set("X-Connection-Api-Key", resendKey);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return await fetch(url, { ...init, headers });
}

export async function resendJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await resendFetch(path, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`Resend ${init.method || "GET"} ${path} ${r.status}: ${text}`);
  return text ? JSON.parse(text) : ({} as T);
}
