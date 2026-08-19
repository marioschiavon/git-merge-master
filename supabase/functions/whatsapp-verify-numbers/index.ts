// Verifica se os telefones dos leads existem no WhatsApp (Hook7/Evolution).
// Modos:
//   - { lead_ids: [...] }        → verifica esses leads (sob demanda, UI)
//   - { scan: true, limit: N }   → varre pendentes de todas as empresas (cron)
// Nunca marca inválido em caso de erro: resultado desconhecido fica intocado.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { checkPhonesOnWhatsApp, getHook7SendInstance } from "../_shared/hook7-whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CHUNK = 15;
const RECHECK_DAYS = 30;

function digits(v: string | null | undefined): string {
  return String(v || "").replace(/\D/g, "");
}

// deno-lint-ignore no-explicit-any
async function verifyCompany(admin: any, companyId: string, leads: any[]) {
  const out = { checked: 0, valid: 0, invalid: 0, unknown: 0, error: null as string | null };
  const inst = await getHook7SendInstance(admin, companyId);
  if (!inst) {
    out.unknown = leads.length;
    out.error = "Nenhuma instância WhatsApp conectada";
    return out;
  }

  for (let i = 0; i < leads.length; i += CHUNK) {
    const slice = leads.slice(i, i + CHUNK);
    const byPhone = new Map<string, string[]>(); // phone → lead ids
    for (const l of slice) {
      const p = digits(l.whatsapp || l.phone);
      if (!p) continue;
      byPhone.set(p, [...(byPhone.get(p) || []), l.id]);
    }
    if (!byPhone.size) continue;

    const r = await checkPhonesOnWhatsApp(admin, inst, [...byPhone.keys()]);
    if (!r.ok) {
      out.error = r.error || "falha na verificação";
      out.unknown += slice.length;
      break; // endpoint indisponível: não insiste
    }

    const nowIso = new Date().toISOString();
    for (const [phone, ids] of byPhone) {
      const exists = r.results.get(phone);
      if (typeof exists !== "boolean") {
        out.unknown += ids.length;
        continue;
      }
      await admin.from("leads").update({
        whatsapp_valid: exists,
        whatsapp_checked_at: nowIso,
        whatsapp_check_error: null,
      }).in("id", ids);
      out.checked += ids.length;
      if (exists) out.valid += ids.length;
      else out.invalid += ids.length;
    }
    // Pequena pausa entre blocos: consultas em rajada são sinal de spam.
    if (i + CHUNK < leads.length) await new Promise((res) => setTimeout(res, 1200));
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const leadIds: string[] = Array.isArray(body.lead_ids) ? body.lead_ids : [];
    const scan = body.scan === true;

    // ---- modo cron: varre pendentes de todas as empresas ----
    if (scan) {
      const limit = Math.min(Number(body.limit) || 300, 1000);
      const staleBefore = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
      const { data: leads } = await admin
        .from("leads")
        .select("id, company_id, phone, whatsapp, whatsapp_checked_at")
        .or(`whatsapp_checked_at.is.null,whatsapp_checked_at.lt.${staleBefore}`)
        .or("whatsapp.not.is.null,phone.not.is.null")
        .limit(limit);

      const grouped = new Map<string, any[]>();
      for (const l of leads || []) {
        if (!l.company_id) continue;
        if (!digits(l.whatsapp || l.phone)) continue;
        grouped.set(l.company_id, [...(grouped.get(l.company_id) || []), l]);
      }
      const perCompany: Record<string, unknown> = {};
      for (const [cid, rows] of grouped) {
        perCompany[cid] = await verifyCompany(admin, cid, rows);
      }
      return json({ ok: true, companies: grouped.size, results: perCompany });
    }

    // ---- modo sob demanda: exige usuário autenticado da empresa ----
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const { data: userData } = await admin.auth.getUser(jwt);
    if (!userData?.user) return json({ error: "unauthorized" }, 401);
    const { data: companyId } = await admin.rpc("get_user_company_id", { _user_id: userData.user.id });
    if (!companyId) return json({ error: "no company" }, 403);
    if (!leadIds.length) return json({ error: "lead_ids vazio" }, 400);

    const { data: leads } = await admin
      .from("leads")
      .select("id, company_id, phone, whatsapp")
      .eq("company_id", companyId)
      .in("id", leadIds.slice(0, 500));

    const withPhone = (leads || []).filter((l: any) => digits(l.whatsapp || l.phone));
    const skipped = (leads?.length || 0) - withPhone.length;
    const result = await verifyCompany(admin, companyId, withPhone);
    return json({ ok: true, ...result, skipped_no_phone: skipped });
  } catch (e) {
    console.error("whatsapp-verify-numbers error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
