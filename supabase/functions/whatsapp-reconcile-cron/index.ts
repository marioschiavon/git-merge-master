// Confere periodicamente o estado real de cada conexão de WhatsApp no servidor
// e corrige o que está gravado no app. Sem isso, uma conexão pode continuar
// aparecendo como "Conectado" horas depois de ter caído.
//
// Regras:
//  - open        → connected (e zera a contagem de recusas)
//  - close       → disconnected (nunca "banido" por suposição)
//  - connecting  → pairing
//  - unknown/erro → não altera nada (evita falso alarme por instabilidade)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { loadInstanceToken, serviceClient, withinUserDisconnectWindow } from "../_shared/hook7.ts";
import { connectionState } from "../_shared/whatsapp-engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STALE_DAYS = 7;
const NOTIFY_AFTER_MIN = 30;
const REMINDER_HOURS = 24;
const MAX_REMINDERS = 3;

const APP_BASE = "https://app.leaderei.com.br";

/** Traduz o motivo técnico para texto de cliente. */
function describeReason(lastError?: string | null) {
  const e = (lastError ?? "").toLowerCase();
  if (e.includes("403")) {
    return {
      text:
        "o WhatsApp recusou a reconexão deste número — isso costuma acontecer quando há volume alto de envios ou denúncias de contatos",
      refused: true,
    };
  }
  if (e.includes("401") || e.includes("loggedout")) {
    return {
      text:
        "o aparelho encerrou a sessão (o celular saiu dos aparelhos conectados ou ficou muito tempo sem internet)",
      refused: false,
    };
  }
  return { text: "a conexão com o celular foi perdida", refused: false };
}

function describeDownFor(sinceMs: number): string {
  const min = Math.floor((Date.now() - sinceMs) / 60_000);
  if (min < 60) return `há ${Math.max(1, min)} minuto${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} hora${h === 1 ? "" : "s"}`;
  return `há ${Math.floor(h / 24)} dias`;
}

// deno-lint-ignore no-explicit-any
async function notifyCompanyAdmins(admin: any, inst: any, opts: {
  reminder: number;
  downSinceMs: number;
}) {
  const { data: members } = await admin
    .from("company_members")
    .select("user_id")
    .eq("company_id", inst.company_id)
    .eq("role", "company_admin");
  const emails: string[] = [];
  for (const m of members || []) {
    try {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      const email = data?.user?.email;
      if (email) emails.push(email);
    } catch { /* ignora */ }
  }
  if (emails.length === 0) return false;

  const reason = describeReason(inst.last_error);
  const url = `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "")}/functions/v1/send-transactional-email`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let anySent = false;
  for (const to of emails) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          templateName: "whatsapp-disconnected",
          recipientEmail: to,
          idempotencyKey: `wa-down-${inst.id}-r${opts.reminder}`,
          templateData: {
            connectionName: inst.display_name ?? inst.external_name,
            phoneNumber: inst.phone_number ?? "",
            appUrl: `${APP_BASE}/settings/integrations?wa=1`,
            bestPracticesUrl: `${APP_BASE}/guides/whatsapp`,
            reason: reason.text,
            refused: reason.refused,
            downFor: describeDownFor(opts.downSinceMs),
            reminder: opts.reminder,
          },
        }),
      });
      if (res.ok) anySent = true;
      else console.error("aviso de queda não enviado:", res.status, await res.text());
    } catch (e) {
      console.error("aviso de queda falhou:", String(e));
    }
  }
  return anySent;
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = serviceClient();
  const results: Record<string, unknown>[] = [];

  try {
    const { data: instances } = await admin
      .from("hook7_instances")
      .select(
        "id, company_id, display_name, phone_number, external_name, status, engine, user_disconnected_at, refusal_count, last_connected_at, created_at, disconnect_notified_at, updated_at",
      )
      .is("archived_at", null)
      .in("status", ["connected", "disconnected", "pairing", "error", "banned"]);

    const staleCutoff = Date.now() - STALE_DAYS * 86_400_000;

    for (const inst of instances || []) {
      // Conexões abandonadas: fora do ar há mais de 7 dias → arquiva e para de
      // gerar aviso/consulta desnecessária.
      if (inst.status !== "connected") {
        const ref = new Date(inst.last_connected_at ?? inst.created_at ?? 0).getTime();
        if (ref && ref < staleCutoff) {
          await admin
            .from("hook7_instances")
            .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", inst.id);
          results.push({ id: inst.id, archived: true });
          continue;
        }
      }

      if (!inst.external_name || inst.engine === "legacy") continue;
      if (withinUserDisconnectWindow(inst)) continue;

      let token: string;
      try {
        token = await loadInstanceToken(admin, inst.id);
      } catch {
        continue;
      }
      if (!token) continue;

      let state: string;
      try {
        state = await connectionState({
          admin,
          instanceName: inst.external_name,
          apikey: token,
          timeoutMs: 10000,
        });
      } catch (e) {
        results.push({ id: inst.id, skipped: String(e).slice(0, 120) });
        continue;
      }

      const nowIso = new Date().toISOString();
      // deno-lint-ignore no-explicit-any
      const patch: Record<string, any> = { updated_at: nowIso };

      if (state === "open") {
        if (inst.status === "connected") continue;
        patch.status = "connected";
        patch.last_connected_at = nowIso;
        patch.last_error = null;
        patch.refusal_count = 0;
        patch.disconnect_notified_at = null;
        patch.disconnect_reminder_count = 0;
        patch.disconnect_last_reminder_at = null;
      } else if (state === "close") {
        if (inst.status !== "disconnected" && inst.status !== "banned") {
          patch.status = "disconnected";
          patch.last_error = "conexão encerrada no servidor";
        }
        // Primeiro aviso aos 30 min; depois, um lembrete a cada 24 h (máx. 3).
        const downSince = new Date(inst.last_connected_at ?? inst.updated_at ?? nowIso).getTime();
        const downMin = (Date.now() - downSince) / 60_000;
        const reminders = inst.disconnect_reminder_count ?? 0;
        const lastNotice = new Date(
          inst.disconnect_last_reminder_at ?? inst.disconnect_notified_at ?? 0,
        ).getTime();
        const sinceLastH = lastNotice ? (Date.now() - lastNotice) / 3_600_000 : Infinity;

        if (!inst.disconnect_notified_at && downMin >= NOTIFY_AFTER_MIN) {
          const sent = await notifyCompanyAdmins(admin, inst, { reminder: 0, downSinceMs: downSince });
          if (sent) {
            patch.disconnect_notified_at = nowIso;
            patch.disconnect_last_reminder_at = nowIso;
          }
        } else if (
          inst.disconnect_notified_at && reminders < MAX_REMINDERS &&
          sinceLastH >= REMINDER_HOURS
        ) {
          const sent = await notifyCompanyAdmins(admin, inst, {
            reminder: reminders + 1,
            downSinceMs: downSince,
          });
          if (sent) {
            patch.disconnect_reminder_count = reminders + 1;
            patch.disconnect_last_reminder_at = nowIso;
          }
        }
        if (Object.keys(patch).length === 1) continue; // só updated_at → nada a fazer
      } else if (state === "connecting") {
        if (inst.status === "pairing") continue;
        patch.status = "pairing";
      } else {
        continue; // unknown: não mexe
      }

      await admin.from("hook7_instances").update(patch).eq("id", inst.id);
      results.push({ id: inst.id, from: inst.status, to: patch.status ?? inst.status });
    }

    return json({ ok: true, checked: (instances || []).length, changes: results });
  } catch (e) {
    console.error("whatsapp-reconcile-cron error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
