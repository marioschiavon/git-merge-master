// Revokes a connected email grant and deletes the row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { revokeGrant } from "../_shared/nylas.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const auth = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { grant_row_id } = await req.json();
    if (!grant_row_id) {
      return new Response(JSON.stringify({ error: "missing grant_row_id" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: row } = await admin
      .from("user_email_grants")
      .select("id, user_id, grant_id")
      .eq("id", grant_row_id)
      .maybeSingle();
    if (!row) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Only owner or master_admin can disconnect
    if (row.user_id !== user.id) {
      const { data: isMaster } = await admin.rpc("has_role", {
        _user_id: user.id,
        _role: "master_admin",
      });
      if (!isMaster) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    try {
      await revokeGrant(row.grant_id);
    } catch (e) {
      console.warn("nylas revoke warning (continuing to delete row)", e);
    }

    await admin.from("user_email_grants").delete().eq("id", row.id);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("email-disconnect error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
