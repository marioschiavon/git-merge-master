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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = serviceClient();
  const results: Record<string, unknown>[] = [];

  try {
    const { data: instances } = await admin
      .from("hook7_instances")
      .select("id, external_name, status, engine, user_disconnected_at, refusal_count")
      .is("archived_at", null)
      .in("status", ["connected", "disconnected", "pairing", "error", "banned"]);

    for (const inst of instances || []) {
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
      } else if (state === "close") {
        if (inst.status === "disconnected" || inst.status === "banned") continue;
        patch.status = "disconnected";
        patch.last_error = "conexão encerrada no servidor";
      } else if (state === "connecting") {
        if (inst.status === "pairing") continue;
        patch.status = "pairing";
      } else {
        continue; // unknown: não mexe
      }

      await admin.from("hook7_instances").update(patch).eq("id", inst.id);
      results.push({ id: inst.id, from: inst.status, to: patch.status });
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
