import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { verifyMunicipiaToken } from "../_shared/municipia-token.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-municipia-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const HIER_LABEL: Record<string, string> = {
  educacao: "Secretaria de Educação",
  camara: "Câmara Municipal",
  geral: "Secretaria Geral",
  gabinete: "Gabinete do Prefeito",
};

interface EquipeMember { nome?: string; cargo?: string; email?: string; telefone?: string }
interface IncomingRow {
  municipio?: string;
  uf?: string;
  buscadoEm?: string;
  result?: {
    secretario?: string | null;
    cargo?: string | null;
    emails?: string[];
    telefones?: string[];
    horarioAtendimento?: string | null;
    equipe?: EquipeMember[];
    fonte?: string | null;
    hierarquia?: string | null;
  };
}

interface LeadDraft {
  source_id: string;
  name: string;
  title: string | null;
  email: string | null;
  secondary_email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  company_name: string;
  website: string | null;
  enrichment_data: Record<string, unknown>;
}

function slug(v: string) {
  return v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function draftsFromRow(row: IncomingRow, includeTeam: boolean): LeadDraft[] {
  const municipio = (row.municipio ?? "").trim();
  const uf = (row.uf ?? "").trim().toUpperCase() || null;
  const r = row.result ?? {};
  const hier = r.hierarquia ? (HIER_LABEL[r.hierarquia] ?? r.hierarquia) : null;
  const orgName = [municipio ? `Prefeitura de ${municipio}` : "Município", hier].filter(Boolean).join(" — ");
  const base = `${slug(municipio)}-${slug(uf ?? "")}-${slug(r.hierarquia ?? "geral")}`;
  const meta = {
    origem: "municipia",
    fonte: r.fonte ?? null,
    horario_atendimento: r.horarioAtendimento ?? null,
    hierarquia: hier,
    buscado_em: row.buscadoEm ?? null,
  };

  const out: LeadDraft[] = [];
  const emails = (r.emails ?? []).filter(Boolean);
  const phones = (r.telefones ?? []).filter(Boolean);
  const mainName = (r.secretario ?? "").trim() || (municipio ? `Contato ${municipio}` : "Contato");

  out.push({
    source_id: `${base}-principal`,
    name: mainName,
    title: r.cargo ?? null,
    email: emails[0] ?? null,
    secondary_email: emails[1] ?? null,
    phone: phones[0] ?? null,
    city: municipio || null,
    state: uf,
    company_name: orgName,
    website: r.fonte && /^https?:\/\//i.test(r.fonte) ? r.fonte : null,
    enrichment_data: { ...meta, emails, telefones: phones, equipe: r.equipe ?? [] },
  });

  if (includeTeam) {
    for (const m of r.equipe ?? []) {
      if (!m?.nome || (!m.email && !m.telefone)) continue;
      out.push({
        source_id: `${base}-equipe-${slug(m.nome)}`,
        name: m.nome,
        title: m.cargo ?? null,
        email: m.email ?? null,
        secondary_email: null,
        phone: m.telefone ?? null,
        city: municipio || null,
        state: uf,
        company_name: orgName,
        website: null,
        enrichment_data: { ...meta, membro_equipe: true },
      });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = req.headers.get("x-municipia-token") ?? "";
    let claims;
    try {
      claims = await verifyMunicipiaToken(token);
    } catch (e) {
      return json({ error: (e as Error).message }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const rows: IncomingRow[] = Array.isArray(body?.rows) ? body.rows : [];
    if (!rows.length) return json({ error: "Nenhum município enviado" }, 400);
    if (rows.length > 500) return json({ error: "Máximo de 500 municípios por envio" }, 400);
    const includeTeam = body?.include_team !== false;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const companyId = claims.company_id;

    const { data: integ } = await admin
      .from("municipia_integrations")
      .select("enabled")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!integ?.enabled) return json({ error: "Integração MunicipIA não habilitada" }, 403);

    const drafts = rows.flatMap((r) => draftsFromRow(r, includeTeam));
    let created = 0, updated = 0, skipped = 0;

    for (const d of drafts) {
      try {
        const { data: existing } = await admin
          .from("leads")
          .select("id")
          .eq("company_id", companyId)
          .eq("municipia_source_id", d.source_id)
          .maybeSingle();

        let matchId = existing?.id ?? null;
        if (!matchId && d.email) {
          const { data: byEmail } = await admin
            .from("leads").select("id").eq("company_id", companyId).ilike("email", d.email).maybeSingle();
          matchId = byEmail?.id ?? null;
        }
        if (!matchId && d.phone) {
          const { data: byPhone } = await admin
            .from("leads").select("id").eq("company_id", companyId).eq("phone", d.phone).maybeSingle();
          matchId = byPhone?.id ?? null;
        }

        const payload = {
          company_id: companyId,
          municipia_source_id: d.source_id,
          name: d.name,
          title: d.title,
          email: d.email,
          secondary_email: d.secondary_email,
          phone: d.phone,
          city: d.city,
          state: d.state,
          country: "Brasil",
          company_name: d.company_name,
          website: d.website,
          source: "municipia",
          enrichment_data: d.enrichment_data,
        };

        if (matchId) {
          const { error } = await admin.from("leads").update(payload).eq("id", matchId);
          if (error) { skipped++; continue; }
          updated++;
        } else {
          const { error } = await admin.from("leads").insert(payload);
          if (error) { skipped++; continue; }
          created++;
        }
      } catch {
        skipped++;
      }
    }

    await admin.from("municipia_integrations").update({
      last_import_at: new Date().toISOString(),
      last_import_count: created + updated,
      last_error: null,
    }).eq("company_id", companyId);

    await admin.from("audit_logs").insert({
      company_id: companyId,
      user_id: claims.user_id,
      event_type: "municipia.import",
      entity_type: "leads",
      message: `Importação MunicipIA: ${created} criados, ${updated} atualizados`,
      metadata: { created, updated, skipped, municipios: rows.length },
    }).then(() => null, () => null);

    return json({ success: true, created, updated, skipped });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
