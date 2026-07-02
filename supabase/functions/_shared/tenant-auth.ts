// Shared tenant authorization helpers for Edge Functions.
// Usage:
//   const { user, supabase } = await requireUser(req);
//   await requireCompanyMember(supabase, user.id, companyId);
//
// requireUser validates the JWT via supabase.auth.getClaims(). The returned
// Supabase client is scoped to the caller (RLS applies).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface AuthedUser {
  id: string;
  email?: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export function errorResponse(err: unknown, headers: HeadersInit = {}) {
  if (err instanceof HttpError) {
    return jsonResponse({ error: err.message }, err.status, headers);
  }
  const message = err instanceof Error ? err.message : "Internal error";
  return jsonResponse({ error: message }, 500, headers);
}

export async function requireUser(req: Request): Promise<{
  user: AuthedUser;
  supabase: SupabaseClient;
  token: string;
}> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing bearer token");
  }
  const token = authHeader.slice(7);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new HttpError(500, "Supabase env not configured");

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    throw new HttpError(401, "Invalid session");
  }

  return {
    user: { id: data.claims.sub as string, email: data.claims.email as string | undefined },
    supabase,
    token,
  };
}

/**
 * Verifies the user belongs to the given company. Uses a service-role client
 * to bypass RLS on company_members so the check is authoritative.
 */
export async function requireCompanyMember(userId: string, companyId: string): Promise<void> {
  if (!companyId) throw new HttpError(400, "company_id is required");
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) throw new HttpError(500, "Supabase env not configured");

  const admin = createClient(url, service);

  // master_admin bypass
  const { data: rolesData } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const roles = (rolesData ?? []).map((r) => r.role);
  if (roles.includes("master_admin")) return;

  const { data, error } = await admin
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(403, "Not a member of this company");
}

export async function requireRole(userId: string, role: "master_admin" | "company_admin" | "user"): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) throw new HttpError(500, "Supabase env not configured");
  const admin = createClient(url, service);
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(403, `Requires role: ${role}`);
}

/**
 * Convenience: resolves the caller's company_id (first membership) when
 * the client doesn't pass one explicitly.
 */
export async function getCallerCompanyId(userId: string): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return null;
  const admin = createClient(url, service);
  const { data } = await admin
    .from("company_members")
    .select("company_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return data?.company_id ?? null;
}
