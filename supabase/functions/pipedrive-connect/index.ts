import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.4/cors";

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
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!,
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
    const { api_token, company_id } = body;

    if (!api_token || !company_id) {
      return new Response(JSON.stringify({ error: "api_token e company_id são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate token with Pipedrive API
    const pipedriveRes = await fetch(
      `https://api.pipedrive.com/v1/users/me?api_token=${api_token}`
    );
    const pipedriveData = await pipedriveRes.json();

    if (!pipedriveRes.ok || !pipedriveData.success) {
      return new Response(
        JSON.stringify({ error: "Token inválido do Pipedrive", details: pipedriveData }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiDomain = pipedriveData.data?.company_domain
      ? `${pipedriveData.data.company_domain}.pipedrive.com`
      : null;

    // Upsert integration
    const { data, error } = await supabase
      .from("integrations")
      .upsert(
        {
          company_id,
          provider: "pipedrive",
          api_token,
          api_domain: apiDomain,
          status: "active",
        },
        { onConflict: "company_id,provider" }
      )
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        integration: data,
        pipedrive_user: pipedriveData.data?.name,
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
