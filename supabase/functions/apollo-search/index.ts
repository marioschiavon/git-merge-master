import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { searchPeopleWithCache } from "../_shared/apollo.ts";
import { requireCompanyMember, HttpError } from "../_shared/tenant-auth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autorizado" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Não autorizado" }, 401);

    const { company_id, filters, page } = await req.json();
    if (!company_id) return json({ error: "company_id obrigatório" }, 400);
    try { await requireCompanyMember(user.id, company_id); }
    catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 403); }

    const pageNum = Math.min(Math.max(Number(page ?? 1), 1), 5);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: integ } = await admin
      .from("integrations")
      .select("api_token, status")
      .eq("company_id", company_id)
      .eq("provider", "apollo")
      .maybeSingle();
    if (!integ || integ.status !== "active" || !integ.api_token) {
      return json({ error: "Apollo não está conectado." }, 400);
    }

    const result = await searchPeopleWithCache({
      supabase: admin,
      company_id,
      triggered_by: user.id,
      apiKey: integ.api_token,
      filters: filters ?? {},
      page: pageNum,
    });

    // Dedup hints
    const emails = result.people.map((p: any) => p.email).filter(Boolean) as string[];
    const ids = result.people.map((p: any) => p.id).filter(Boolean) as string[];
    const existingEmails: string[] = [];
    const existingApolloIds: string[] = [];
    if (emails.length) {
      const { data } = await admin.from("leads").select("email")
        .eq("company_id", company_id).in("email", emails);
      for (const r of data ?? []) if (r.email) existingEmails.push(String(r.email).toLowerCase());
    }
    if (ids.length) {
      const { data } = await admin.from("leads").select("apollo_person_id")
        .eq("company_id", company_id).in("apollo_person_id", ids);
      for (const r of data ?? []) if (r.apollo_person_id) existingApolloIds.push(r.apollo_person_id);
    }

    return json({ ...result, existingEmails, existingApolloIds });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
