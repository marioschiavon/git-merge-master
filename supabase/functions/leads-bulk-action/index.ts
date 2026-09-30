// Ações em lote sobre leads: enviar N leads para uma cadência ou descartá-los.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);

    const { data: companyId } = await supabase.rpc("get_user_company_id", { _user_id: userData.user.id });
    if (!companyId) return json({ error: "no company" }, 403);

    const body = await req.json();
    const leadIds: string[] = Array.isArray(body.lead_ids) ? body.lead_ids : [];
    const action: string = body.action;
    const cadenceId: string | null = body.cadence_id || null;

    if (!["enroll", "discard", "delete_preview", "delete", "undo_import"].includes(action)) return json({ error: "action inválida" }, 400);

    // Chunk helper: evita URLs gigantes (erro em seleções grandes, ex.: 683 leads)
    const CHUNK = 100;
    const chunks = <T,>(arr: T[], size = CHUNK): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Leads que já tiveram contato: matrícula em cadência ou mensagem registrada.
    const contactedSet = async (ids: string[]) => {
      const out = new Set<string>();
      for (const part of chunks(ids)) {
        const { data: enr } = await admin.from("cadence_enrollments").select("lead_id").in("lead_id", part);
        for (const r of enr || []) out.add((r as any).lead_id);
        const { data: convs } = await admin.from("conversations").select("id, lead_id").in("lead_id", part);
        const convIds = (convs || []).map((c: any) => c.id);
        for (const cp of chunks(convIds)) {
          const { data: msgs } = await admin.from("messages").select("conversation_id").in("conversation_id", cp);
          const withMsg = new Set((msgs || []).map((m: any) => m.conversation_id));
          for (const c of convs || []) if (withMsg.has((c as any).id)) out.add((c as any).lead_id);
        }
      }
      return out;
    };
    const deleteMany = async (ids: string[]) => {
      let deleted = 0; const failed: string[] = [];
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        const res = await Promise.all(batch.map((id) => supabase.rpc("delete_lead_cascade", { p_lead_id: id })));
        res.forEach((r, k) => (r.error ? failed.push(batch[k]) : deleted++));
      }
      return { deleted, failed: failed.length };
    };
    const audit = (event_type: string, message: string, metadata: any) =>
      admin.from("audit_logs").insert({
        company_id: companyId, user_id: userData.user.id, user_email: userData.user.email ?? null,
        event_type, severity: "warning", entity_type: "leads", message, metadata,
      }).then(() => null, () => null);

    if (action === "undo_import") {
      const listId: string | null = body.list_id || null;
      if (!listId) return json({ error: "list_id obrigatório" }, 400);
      const { data: list } = await admin.from("lead_lists").select("id, name, created_at, company_id")
        .eq("id", listId).eq("company_id", companyId).maybeSingle();
      if (!list) return json({ error: "lista não encontrada" }, 404);
      const since = new Date(new Date((list as any).created_at).getTime() - 60_000).toISOString();
      const { data: rows, error } = await admin.from("leads").select("id, created_at")
        .eq("company_id", companyId).eq("lead_list_id", listId).limit(10000);
      if (error) return json({ error: error.message }, 500);
      const all = (rows || []) as any[];
      const created = all.filter((l) => l.created_at >= since).map((l) => l.id);
      const preExisting = all.length - created.length;
      const contacted = await contactedSet(created);
      const toDelete = created.filter((id) => !contacted.has(id));
      const r = await deleteMany(toDelete);
      await admin.from("lead_lists").delete().eq("id", listId);
      await audit("leads.import_undone", `Importação desfeita: ${(list as any).name} (${r.deleted} leads apagados)`,
        { list_id: listId, list_name: (list as any).name, deleted: r.deleted, kept_contacted: contacted.size, kept_pre_existing: preExisting, failed: r.failed });
      return json({ ok: true, deleted: r.deleted, kept_contacted: contacted.size, kept_pre_existing: preExisting, failed: r.failed });
    }

    if (!leadIds.length) return json({ error: "lead_ids vazio" }, 400);

    // Filtra apenas leads da empresa (em lotes)
    const validLeads: any[] = [];
    for (const part of chunks(leadIds)) {
      const { data, error } = await supabase
        .from("leads").select("id, email, whatsapp, phone").eq("company_id", companyId).in("id", part);
      if (error) return json({ error: error.message }, 500);
      if (data) validLeads.push(...data);
    }
    const validIds = validLeads.map((l: any) => l.id);
    if (!validIds.length) return json({ error: "nenhum lead válido" }, 400);

    if (action === "delete_preview") {
      const contacted = await contactedSet(validIds);
      return json({ ok: true, total: validIds.length, contacted_ids: [...contacted] });
    }

    if (action === "delete") {
      const r = await deleteMany(validIds);
      await audit("leads.bulk_deleted", `${r.deleted} lead(s) excluídos em massa`, { deleted: r.deleted, failed: r.failed });
      return json({ ok: true, deleted: r.deleted, failed: r.failed });
    }

    if (action === "discard") {
      for (const part of chunks(validIds)) {
        const { error } = await supabase.from("leads")
          .update({ status: "unqualified", updated_at: new Date().toISOString() })
          .in("id", part);
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true, discarded: validIds.length });
    }

    // enroll
    if (!cadenceId) return json({ error: "cadence_id obrigatório" }, 400);
    const { data: cadence } = await supabase.from("cadences")
      .select("id, status, type").eq("id", cadenceId).eq("company_id", companyId).maybeSingle();
    if (!cadence) return json({ error: "cadência não encontrada" }, 404);

    // Filtra por canal exigido pela cadência
    const cadType: string | undefined = (cadence as any).type;
    const hasChannel = (l: any) => {
      if (cadType === "whatsapp") return !!(l.whatsapp || l.phone);
      if (cadType === "email") return !!l.email;
      return !!(l.email || l.whatsapp || l.phone);
    };
    const eligible = validLeads.filter(hasChannel);
    const skippedNoChannelIds = validLeads.filter((l: any) => !hasChannel(l)).map((l: any) => l.id);
    const eligibleIds = eligible.map((l: any) => l.id);

    // Evita duplicar enrollments (em lotes)
    const alreadyIn = new Set<string>();
    for (const part of chunks(eligibleIds)) {
      const { data, error } = await supabase.from("cadence_enrollments")
        .select("lead_id").eq("cadence_id", cadenceId).in("lead_id", part);
      if (error) return json({ error: error.message }, 500);
      for (const r of data || []) alreadyIn.add((r as any).lead_id);
    }
    const toInsert = eligibleIds.filter((id) => !alreadyIn.has(id));

    if (toInsert.length) {
      for (const part of chunks(toInsert)) {
        const rows = part.map((lead_id) => ({
          company_id: companyId,
          lead_id,
          cadence_id: cadenceId,
          status: "active",
          current_step: 0,
          first_message_status: "pending_generation",
          enrolled_at: new Date().toISOString(),
        }));
        const { error: insErr } = await supabase.from("cadence_enrollments").insert(rows);
        if (insErr) return json({ error: insErr.message }, 500);

        // Marca os leads recém-inscritos como "Em cadência" (só a partir de "Novo").
        await supabase.from("leads")
          .update({ status: "enrolled", updated_at: new Date().toISOString() })
          .in("id", part)
          .eq("status", "new");
      }
    }


    return json({
      ok: true,
      enrolled: toInsert.length,
      skipped: alreadyIn.size,
      skipped_no_channel: skippedNoChannelIds.length,
      cadence_type: cadType,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(o: any, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
