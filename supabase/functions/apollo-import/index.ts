import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { mapPersonToLeadPayload, mergeLeadPatch } from "../_shared/apollo.ts";
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

    const { company_id, people, lead_list_id, enrich_limit } = await req.json();
    if (!company_id) return json({ error: "company_id obrigatório" }, 400);
    if (!Array.isArray(people) || people.length === 0) return json({ error: "people vazio" }, 400);
    if (people.length > 100) return json({ error: "máximo 100 por vez" }, 400);
    try { await requireCompanyMember(user.id, company_id); }
    catch (e) { return json({ error: (e as Error).message }, e instanceof HttpError ? e.status : 403); }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Volume control: only the first N NEWLY inserted leads are queued for enrichment.
    // Beyond that, insert leads with enrichment_status='not_queued' — trigger will skip them.
    const enrichCap = typeof enrich_limit === "number" && enrich_limit >= 0 ? enrich_limit : null;
    let enrichedInsertsSoFar = 0;

    let created = 0, updated = 0, skipped = 0, held = 0;

    for (const person of people) {
      if (!person?.id) { skipped++; continue; }
      const payload = mapPersonToLeadPayload(person, company_id);
      if (lead_list_id) (payload as any).lead_list_id = lead_list_id;

      // 1) dedup by apollo_person_id
      const { data: byApollo } = await admin
        .from("leads").select("*")
        .eq("company_id", company_id).eq("apollo_person_id", person.id).maybeSingle();
      if (byApollo?.id) {
        const patch = mergeLeadPatch(byApollo, payload);
        if (Object.keys(patch).length) await admin.from("leads").update(patch).eq("id", byApollo.id);
        updated++; continue;
      }

      // 2) dedup by email
      if (payload.email) {
        const { data: byEmail } = await admin
          .from("leads").select("*")
          .eq("company_id", company_id).ilike("email", payload.email).maybeSingle();
        if (byEmail?.id) {
          const patch = mergeLeadPatch(byEmail, payload);
          if (Object.keys(patch).length) await admin.from("leads").update(patch).eq("id", byEmail.id);
          updated++; continue;
        }
      }

      // 3) dedup by linkedin_url
      if (payload.linkedin_url) {
        const { data: byLi } = await admin
          .from("leads").select("*")
          .eq("company_id", company_id).eq("linkedin_url", payload.linkedin_url).maybeSingle();
        if (byLi?.id) {
          const patch = mergeLeadPatch(byLi, payload);
          if (Object.keys(patch).length) await admin.from("leads").update(patch).eq("id", byLi.id);
          updated++; continue;
        }
      }

      if (enrichCap !== null && enrichedInsertsSoFar >= enrichCap) {
        (payload as any).enrichment_status = "not_queued";
      }
      const { error: insErr } = await admin.from("leads").insert(payload);
      if (insErr) { skipped++; continue; }
      created++;
      if ((payload as any).enrichment_status === "not_queued") held++;
      else enrichedInsertsSoFar++;
    }

    return json({ success: true, created, updated, skipped, held });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}
