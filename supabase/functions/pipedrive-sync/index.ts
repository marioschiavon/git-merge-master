import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function fetchAllPersons(apiToken: string) {
  const persons: any[] = [];
  let start = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `https://api.pipedrive.com/v1/persons?api_token=${apiToken}&start=${start}&limit=${limit}`
    );
    const data = await res.json();

    if (data.success && data.data) {
      persons.push(...data.data);
      hasMore = data.additional_data?.pagination?.more_items_in_collection ?? false;
      start += limit;
    } else {
      hasMore = false;
    }
  }

  return persons;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { company_id } = body;

    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get integration token
    const { data: integration, error: intError } = await supabase
      .from("integrations")
      .select("*")
      .eq("company_id", company_id)
      .eq("provider", "pipedrive")
      .eq("status", "active")
      .single();

    if (intError || !integration) {
      return new Response(
        JSON.stringify({ error: "Integração com Pipedrive não encontrada ou inativa" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch persons from Pipedrive
    const persons = await fetchAllPersons(integration.api_token);

    // Upsert leads
    let synced = 0;
    let errors = 0;

    for (const person of persons) {
      const email = person.email?.[0]?.value || null;
      const phone = person.phone?.[0]?.value || null;

      const { error } = await supabase.from("leads").upsert(
        {
          company_id,
          pipedrive_id: person.id,
          name: person.name || "Sem nome",
          email,
          phone,
          company_name: person.org_name || null,
          title: person.job_title || null,
          source: "pipedrive",
          pipedrive_data: person,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "company_id,pipedrive_id" }
      );

      if (error) {
        errors++;
      } else {
        synced++;
      }
    }

    // Update last_synced_at on integration
    await supabase
      .from("integrations")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", integration.id);

    return new Response(
      JSON.stringify({
        success: true,
        total_from_pipedrive: persons.length,
        synced,
        errors,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
