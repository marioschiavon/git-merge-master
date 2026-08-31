import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  credsFromIntegration,
  createBitrixClient,
  configIsReady,
  normalizeFieldMap,
  buildEntityFields,
  type BitrixClient,
  type BitrixConfig,
  type BitrixFieldTarget,
} from "../_shared/bitrix.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_JOBS = 20;
const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 25, 60, 120];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function findOrCreateContact(
  bitrix: BitrixClient,
  lead: Record<string, any>,
  contactFields: Record<string, unknown>,
): Promise<number | null> {
  const email = String(lead.email ?? "").trim();
  const phone = String(lead.whatsapp ?? lead.phone ?? "").trim();

  let existingId: number | null = null;
  if (email) {
    const res = await bitrix.call<any>("crm.contact.list", {
      filter: { EMAIL: email },
      select: ["ID"],
    });
    const list = Array.isArray(res) ? res : (res?.items ?? []);
    if (list.length) existingId = Number(list[0].ID);
  }
  if (!existingId && phone) {
    const res = await bitrix.call<any>("crm.contact.list", {
      filter: { PHONE: phone },
      select: ["ID"],
    });
    const list = Array.isArray(res) ? res : (res?.items ?? []);
    if (list.length) existingId = Number(list[0].ID);
  }

  const fields: Record<string, unknown> = { ...contactFields };

  if (existingId) {
    // Nunca sobrescrever cegamente: só preenche o que estiver vazio no CRM do cliente.
    const codes = Object.keys(fields);
    if (!codes.length) return existingId;
    const current = await bitrix.call<any>("crm.contact.get", { id: existingId });
    const patch: Record<string, unknown> = {};
    for (const code of codes) {
      const value = current?.[code];
      const isEmpty =
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (isEmpty) patch[code] = fields[code];
    }
    if (Object.keys(patch).length) {
      await bitrix.call("crm.contact.update", { id: existingId, fields: patch });
    }
    return existingId;
  }

  if (!fields.NAME) {
    const fallback = String(lead.name ?? "").trim() || email || phone;
    if (!fallback) return null;
    fields.NAME = fallback;
  }
  fields.OPENED = "Y";

  const id = await bitrix.call<number>("crm.contact.add", { fields });
  return id ? Number(id) : null;
}

async function findOrCreateCompany(
  bitrix: BitrixClient,
  companyName: string,
): Promise<number | null> {
  const title = companyName.trim();
  if (!title) return null;
  const res = await bitrix.call<any>("crm.company.list", {
    filter: { "%TITLE": title },
    select: ["ID"],
  });
  const list = Array.isArray(res) ? res : (res?.items ?? []);
  if (list.length) return Number(list[0].ID);
  const id = await bitrix.call<number>("crm.company.add", {
    fields: { TITLE: title, OPENED: "Y" },
  });
  return id ? Number(id) : null;
}

async function conversationSummary(
  supabase: ReturnType<typeof createClient>,
  leadId: string,
): Promise<string> {
  const { data: convs } = await supabase
    .from("conversations")
    .select("id, summary")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1);
  const conv = convs?.[0];
  if (!conv) return "";
  if (conv.summary) return String(conv.summary);

  const { data: msgs } = await supabase
    .from("messages")
    .select("direction, content, sent_at")
    .eq("conversation_id", conv.id)
    .order("sent_at", { ascending: false })
    .limit(12);
  return (msgs ?? [])
    .reverse()
    .map((m: any) => `${m.direction === "inbound" ? "Lead" : "IA"}: ${m.content ?? ""}`)
    .join("\n")
    .slice(0, 4000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Backend não configurado" }, 500);

  const supabase = createClient(url, serviceKey);
  const nowIso = new Date().toISOString();

  const { data: jobs, error: queueError } = await supabase
    .from("bitrix_sync_queue")
    .select("*")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(MAX_JOBS);

  if (queueError) return json({ error: queueError.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  const clients = new Map<string, { client: BitrixClient; config: BitrixConfig } | null>();

  for (const job of jobs ?? []) {
    const attempts = (job.attempts ?? 0) + 1;
    try {
      await supabase
        .from("bitrix_sync_queue")
        .update({ status: "running", attempts })
        .eq("id", job.id);

      // Integração da empresa (cacheada por execução)
      if (!clients.has(job.company_id)) {
        const { data: integration } = await supabase
          .from("integrations")
          .select("api_domain, api_token, config, status")
          .eq("company_id", job.company_id)
          .eq("provider", "bitrix24")
          .maybeSingle();
        const cfg = (integration?.config ?? null) as BitrixConfig | null;
        if (!integration || integration.status !== "active" || !configIsReady(cfg)) {
          clients.set(job.company_id, null);
        } else {
          clients.set(job.company_id, {
            client: createBitrixClient(credsFromIntegration(integration as never)),
            config: cfg!,
          });
        }
      }

      const entry = clients.get(job.company_id);
      if (!entry) {
        await supabase
          .from("bitrix_sync_queue")
          .update({
            status: "skipped",
            last_error: "Integração do Bitrix24 ausente, inativa ou sem mapeamento completo.",
          })
          .eq("id", job.id);
        results.push({ id: job.id, status: "skipped" });
        continue;
      }

      const { client: bitrix, config } = entry;
      const fieldMap: Record<string, BitrixFieldTarget> = normalizeFieldMap(
        config.field_map ?? null,
      );

      const { data: lead } = await supabase
        .from("leads")
        .select("*")
        .eq("id", job.lead_id)
        .maybeSingle();
      if (!lead) {
        await supabase
          .from("bitrix_sync_queue")
          .update({ status: "skipped", last_error: "Lead não encontrado." })
          .eq("id", job.id);
        results.push({ id: job.id, status: "skipped" });
        continue;
      }

      const { data: existingDeal } = await supabase
        .from("bitrix_deals")
        .select("*")
        .eq("company_id", job.company_id)
        .eq("lead_id", job.lead_id)
        .maybeSingle();

      if (job.event === "create_deal") {
        if (existingDeal) {
          await supabase
            .from("bitrix_sync_queue")
            .update({ status: "done", last_error: null })
            .eq("id", job.id);
          results.push({ id: job.id, status: "done", reason: "já existia" });
          continue;
        }

        const leadRow = lead as Record<string, unknown>;
        const contactFields = buildEntityFields(leadRow, fieldMap, "contact");
        const contactId = await findOrCreateContact(bitrix, lead, contactFields);
        const companyBitrixId = lead.company_name
          ? await findOrCreateCompany(bitrix, String(lead.company_name))
          : null;

        const dealFields: Record<string, unknown> = {
          CATEGORY_ID: config.category_id,
          STAGE_ID: config.stage_created,
          OPENED: "Y",
          ...buildEntityFields(leadRow, fieldMap, "deal"),
        };
        // TITLE é obrigatório no Bitrix: nunca pode ficar em branco.
        if (!dealFields.TITLE) {
          dealFields.TITLE = `${lead.name ?? "Lead"}${
            lead.company_name ? ` — ${lead.company_name}` : ""
          }`;
        }
        if (config.source_id) dealFields.SOURCE_ID = config.source_id;
        if (contactId) dealFields.CONTACT_ID = contactId;
        if (companyBitrixId) dealFields.COMPANY_ID = companyBitrixId;

        const dealId = await bitrix.call<number>("crm.deal.add", {
          fields: dealFields,
          params: { REGISTER_SONET_EVENT: "Y" },
        });

        await supabase.from("bitrix_deals").insert({
          company_id: job.company_id,
          lead_id: job.lead_id,
          deal_id: Number(dealId),
          contact_id: contactId,
          bitrix_company_id: companyBitrixId,
          current_stage: config.stage_created,
        });

        await supabase
          .from("bitrix_sync_queue")
          .update({ status: "done", last_error: null })
          .eq("id", job.id);
        results.push({ id: job.id, status: "done", deal_id: dealId });
        continue;
      }

      if (job.event === "move_stage") {
        if (!existingDeal) {
          // Garante que o negócio seja criado antes e adia este job.
          await supabase
            .from("bitrix_sync_queue")
            .upsert(
              {
                company_id: job.company_id,
                lead_id: job.lead_id,
                event: "create_deal",
                status: "pending",
                attempts: 0,
                next_attempt_at: new Date().toISOString(),
              },
              { onConflict: "lead_id,event" },
            );
          await supabase
            .from("bitrix_sync_queue")
            .update({
              status: "pending",
              attempts: Math.max(0, attempts - 1),
              last_error: "Aguardando criação do negócio.",
              next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
            })
            .eq("id", job.id);
          results.push({ id: job.id, status: "deferred" });
          continue;
        }

        const summary = await conversationSummary(supabase, job.lead_id);
        const reason = (job.payload as any)?.reason ?? null;
        const comment = [
          "Atendimento transferido para humano pela Leaderei.",
          reason ? `Motivo: ${reason}` : null,
          summary ? `\nResumo da conversa:\n${summary}` : null,
        ].filter(Boolean).join("\n");

        await bitrix.call("crm.deal.update", {
          id: existingDeal.deal_id,
          fields: {
            STAGE_ID: config.stage_handoff,
            COMMENTS: comment,
            ...buildEntityFields(lead as Record<string, unknown>, fieldMap, "deal"),
          },
          params: { REGISTER_SONET_EVENT: "Y" },
        });

        await supabase
          .from("bitrix_deals")
          .update({ current_stage: config.stage_handoff })
          .eq("id", existingDeal.id);

        await supabase
          .from("bitrix_sync_queue")
          .update({ status: "done", last_error: null })
          .eq("id", job.id);
        results.push({ id: job.id, status: "done", moved: true });
        continue;
      }

      await supabase
        .from("bitrix_sync_queue")
        .update({ status: "skipped", last_error: `Evento desconhecido: ${job.event}` })
        .eq("id", job.id);
      results.push({ id: job.id, status: "skipped" });
    } catch (err) {
      const message = (err as Error)?.message ?? "Erro desconhecido";
      const delayMin = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
      const exhausted = attempts >= MAX_ATTEMPTS;
      await supabase
        .from("bitrix_sync_queue")
        .update({
          status: exhausted ? "failed" : "pending",
          attempts,
          last_error: message.slice(0, 1000),
          next_attempt_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
        })
        .eq("id", job.id);
      results.push({ id: job.id, status: exhausted ? "failed" : "retry", error: message });
    }
  }

  return json({ ok: true, processed: results.length, results });
});
