// Hook7 WhatsApp sender — substitui _shared/zapi-whatsapp.ts no fluxo outbound.
// Cada company tem sua própria instância conectada; usamos o token dedicado
// (armazenado criptografado em hook7_instances.token_encrypted) para autenticar
// as chamadas /message/sendText.

import { getHook7BaseUrl, loadInstanceToken } from "./hook7.ts";

export interface Hook7SendInstance {
  id: string;
  external_name: string;
  phone_number?: string | null;
}

export interface WhatsAppSendResult {
  ok: boolean;
  sid?: string;
  status?: number;
  error?: string;
}

// Normaliza para dígitos com DDI (padrão WhatsApp / Evolution API).
function normalizePhone(num: string): string {
  return String(num || "").trim().replace(/^whatsapp:/i, "").replace(/\D/g, "");
}

/**
 * Resolve a instância WhatsApp (Hook7) da company. Retorna a mais recente
 * com status='connected' ou null quando não há nenhuma conectada.
 */
export async function getHook7SendInstance(
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: string,
): Promise<Hook7SendInstance | null> {
  if (!companyId) return null;
  const { data } = await admin
    .from("hook7_instances")
    .select("id, external_name, status, phone_number, archived_at, last_connected_at, created_at")
    .eq("company_id", companyId)
    .eq("status", "connected")
    .is("archived_at", null)
    .order("last_connected_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data || !data.external_name) return null;
  return {
    id: data.id,
    external_name: data.external_name,
    phone_number: data.phone_number ?? null,
  };
}

/**
 * Envia mensagem de texto via Hook7 usando o token dedicado da instância.
 * Retorna resultado no mesmo formato do helper Z-API antigo, para minimizar
 * mudanças nos call sites.
 */
export async function sendWhatsAppViaHook7(
  // deno-lint-ignore no-explicit-any
  admin: any,
  instance: Hook7SendInstance,
  toPhone: string,
  body: string,
): Promise<WhatsAppSendResult> {
  const phone = normalizePhone(toPhone);
  if (!phone) return { ok: false, error: "Telefone inválido" };
  if (!instance?.external_name) {
    return { ok: false, error: "Instância WhatsApp sem external_name" };
  }

  let token: string;
  try {
    token = await loadInstanceToken(admin, instance.id);
  } catch (e) {
    return { ok: false, error: `Falha lendo token da instância: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!token) return { ok: false, error: "Token da instância indisponível" };

  const base = await getHook7BaseUrl(admin);
  const url = `${base}/send/text`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: token,
      },
      body: JSON.stringify({ number: phone, text: body }),
    });
    // deno-lint-ignore no-explicit-any
    let json: any = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.message || json?.error || `HTTP ${res.status}`,
      };
    }
    const sid =
      json?.key?.id ||
      json?.messageId ||
      json?.id ||
      json?.data?.key?.id ||
      json?.data?.id;
    return { ok: true, sid: sid ? String(sid) : undefined, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Compat helper used by call sites migrated from Z-API. Retorna um "sender"
 * pronto para uso ou null quando a company não tem instância conectada.
 * Uso:
 *   const sender = await getWhatsAppSender(admin, companyId);
 *   if (!sender) → falhe com "Nenhuma instância WhatsApp conectada".
 *   const r = await sender.send(toPhone, body);
 */
export async function getWhatsAppSender(
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: string,
): Promise<
  | null
  | {
    instance: Hook7SendInstance;
    send: (to: string, body: string) => Promise<WhatsAppSendResult>;
  }
> {
  const inst = await getHook7SendInstance(admin, companyId);
  if (!inst) return null;
  return {
    instance: inst,
    send: (to, body) => sendWhatsAppViaHook7(admin, inst, to, body),
  };
}

export const NO_WHATSAPP_INSTANCE_ERROR =
  "Nenhuma instância WhatsApp (Hook7) conectada para esta empresa";

/**
 * Verifica se um telefone está registrado no WhatsApp usando a instância
 * Hook7 (Evolution) conectada da empresa.
 * Endpoint: POST /chat/whatsappNumbers/{instance}  body: { numbers: [phone] }
 * Retorno normalizado (mesmo shape do helper Z-API antigo):
 *   { ok, exists?, status?, error? }
 */
export async function checkPhoneExistsOnWhatsApp(
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: string,
  toPhone: string,
): Promise<{ ok: boolean; exists?: boolean; status?: number; error?: string }> {
  const phone = normalizePhone(toPhone);
  if (!phone) return { ok: false, error: "Telefone inválido" };

  const instance = await getHook7SendInstance(admin, companyId);
  if (!instance) return { ok: false, error: NO_WHATSAPP_INSTANCE_ERROR };

  let token: string;
  try {
    token = await loadInstanceToken(admin, instance.id);
  } catch (e) {
    return { ok: false, error: `Falha lendo token da instância: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!token) return { ok: false, error: "Token da instância indisponível" };

  const base = await getHook7BaseUrl(admin);
  const url = `${base}/chat/whatsappNumbers/${encodeURIComponent(instance.external_name)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: token,
      },
      body: JSON.stringify({ numbers: [phone] }),
    });
    // deno-lint-ignore no-explicit-any
    let json: any = null;
    try { json = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.message || json?.error || `HTTP ${res.status}`,
      };
    }
    // Evolution retorna array: [{ jid, exists, number }]
    const arr = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    const entry = arr.find((x: any) => {
      const n = String(x?.number ?? "").replace(/\D/g, "");
      return n === phone || n.endsWith(phone) || phone.endsWith(n);
    }) ?? arr[0];
    const exists = !!(entry?.exists ?? entry?.existsWhatsapp);
    return { ok: true, exists, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Aliases drop-in para call sites migrados de Z-API — mantêm assinatura antiga.
// getZApiConfig(admin, companyId) → retorna um "sender" (ou null se sem instância).
// sendWhatsAppViaZApi(cfg, phone, body) → delega ao sender resolvido.
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type LegacyCfg = any;

export async function getZApiConfig(
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: string,
): Promise<LegacyCfg | null> {
  return await getWhatsAppSender(admin, companyId);
}

export async function sendWhatsAppViaZApi(
  cfg: LegacyCfg,
  toPhone: string,
  body: string,
): Promise<WhatsAppSendResult> {
  if (!cfg || typeof cfg.send !== "function") {
    return { ok: false, error: NO_WHATSAPP_INSTANCE_ERROR };
  }
  return await cfg.send(toPhone, body);
}
