// Envio de WhatsApp pelo provedor. Cada company tem sua própria conexão;
// usamos o token dedicado (armazenado criptografado em
// hook7_instances.token_encrypted) para autenticar as chamadas de envio.

import { getHook7BaseUrl, loadInstanceToken } from "./hook7.ts";
import { sendTextMessage } from "./whatsapp-engine.ts";


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
 * Envia mensagem de texto usando o token dedicado da conexão.
 * Retorna resultado no mesmo formato dos helpers antigos, para minimizar
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
    return { ok: false, error: "Conexão de WhatsApp sem identificador" };
  }

  let token: string;
  try {
    token = await loadInstanceToken(admin, instance.id);
  } catch (e) {
    return { ok: false, error: `Falha lendo token da conexão: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!token) return { ok: false, error: "Token da conexão indisponível" };

  return await sendTextMessage({
    admin,
    instanceName: instance.external_name,
    apikey: token,
    number: phone,
    text: body,
  });
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
  "Nenhuma conexão de WhatsApp ativa para esta empresa";

// ---------------------------------------------------------------------------
// Checagem de existência de número no WhatsApp
// ---------------------------------------------------------------------------

// Templates de rota ({i} = nome da conexão). A primeira é a do padrão atual
// do provedor; as demais ficam como retrocompatibilidade. Memorizamos a que
// responder em platform_settings.hook7_number_check_path.
const NUMBER_CHECK_PATHS = [
  "/chat/whatsappNumbers/{i}", // padrão atual: { numbers: [...] }
  "/user/check", // padrão anterior: { number: [...], formatJid: true }
  "/chat/whatsappNumbers",
];

function checkBodyFor(path: string, nums: string[]): Record<string, unknown> {
  if (path.startsWith("/user/check")) return { number: nums, formatJid: true };
  return { numbers: nums };
}


async function loadCachedCheckPath(
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<string | null> {
  try {
    const { data } = await admin
      .from("platform_settings")
      .select("hook7_number_check_path")
      .eq("singleton", true)
      .maybeSingle();
    const p = data?.hook7_number_check_path;
    return typeof p === "string" && p.length > 1 ? p : null;
  } catch {
    return null;
  }
}

async function saveCachedCheckPath(
  // deno-lint-ignore no-explicit-any
  admin: any,
  path: string,
): Promise<void> {
  try {
    await admin
      .from("platform_settings")
      .update({ hook7_number_check_path: path })
      .eq("singleton", true);
  } catch { /* non-fatal */ }
}

// deno-lint-ignore no-explicit-any
function parseCheckResponse(json: any, phones: string[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const rows: any[] = Array.isArray(json)
    ? json
    // Evolution GO (Hook7): { data: { Users: [...] }, message: "success" }
    : Array.isArray(json?.data?.Users)
    ? json.data.Users
    : Array.isArray(json?.data?.users)
    ? json.data.users
    : Array.isArray(json?.Users)
    ? json.Users
    : Array.isArray(json?.data)
    ? json.data
    // deno-lint-ignore no-explicit-any
    : Array.isArray((json as any)?.result)
    // deno-lint-ignore no-explicit-any
    ? (json as any).result
    : json && typeof json === "object"
    ? [json]
    : [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const rawNum = String(
      r.Query ?? r.query ?? r.number ?? r.jid ?? r.JID ?? r.remoteJid ?? r.phone ?? "",
    );
    const digits = rawNum.replace(/\D/g, "");
    const rawExists = r.exists ?? r.IsInWhatsapp ?? r.isInWhatsapp ?? r.IsIn ?? r.isIn ??
      r.in_whatsapp;
    const exists = typeof rawExists === "boolean"
      ? rawExists
      : r.status === "valid"
      ? true
      : r.status === "invalid"
      ? false
      : undefined;
    if (typeof exists !== "boolean" || !digits) continue;
    // Evolution pode devolver o JID normalizado (sem o 9, por ex.) — casamos
    // pelo sufixo mais longo em comum.
    const match = phones.find((p) => p === digits || p.endsWith(digits.slice(-8)));
    if (match) out.set(match, exists);
  }
  return out;
}

/**
 * Verifica em lote se números estão registrados no WhatsApp usando a instância
 * conectada da company. Retorna um Map phone(dígitos) → boolean. Números que
 * não puderem ser determinados simplesmente não aparecem no Map (unknown).
 */
export async function checkPhonesOnWhatsApp(
  // deno-lint-ignore no-explicit-any
  admin: any,
  instance: Hook7SendInstance,
  phones: string[],
): Promise<{ ok: boolean; results: Map<string, boolean>; error?: string }> {
  const nums = [...new Set(phones.map(normalizePhone).filter(Boolean))];
  if (!nums.length) return { ok: true, results: new Map() };

  let token: string;
  try {
    token = await loadInstanceToken(admin, instance.id);
  } catch (e) {
    return { ok: false, results: new Map(), error: e instanceof Error ? e.message : String(e) };
  }
  if (!token) return { ok: false, results: new Map(), error: "Token da instância indisponível" };

  const base = await getHook7BaseUrl(admin);
  const cached = await loadCachedCheckPath(admin);
  const candidates = cached ? [cached, ...NUMBER_CHECK_PATHS.filter((p) => p !== cached)] : NUMBER_CHECK_PATHS;

  let lastError = "endpoint de verificação indisponível";
  for (const path of candidates) {
    const url = `${base}${path.replace("{i}", encodeURIComponent(instance.external_name))}`;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      const res = await fetch(url, {

        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          apikey: token,
        },
        body: JSON.stringify(checkBodyFor(path, nums)),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (res.status === 404 || res.status === 405) {
        await res.body?.cancel();
        lastError = `HTTP ${res.status} em ${path}`;
        continue;
      }
      // deno-lint-ignore no-explicit-any
      let json: any = null;
      try { json = await res.json(); } catch { /* ignore */ }
      if (!res.ok) {
        lastError = json?.message || json?.error || `HTTP ${res.status}`;
        console.warn(`hook7 check: ${path} respondeu ${res.status}: ${lastError}`);
        if (res.status === 401 || res.status === 403) {
          // Token da instância inválido/expirado: não adianta tentar outras rotas.
          return {
            ok: false,
            results: new Map(),
            error: "Instância WhatsApp não autorizada (reconecte a instância)",
          };
        }
        continue;
      }
      const results = parseCheckResponse(json, nums);
      if (results.size === 0) {
        console.warn(
          `hook7 check: resposta não reconhecida em ${path}:`,
          JSON.stringify(json).slice(0, 800),
        );
        lastError = `resposta não reconhecida em ${path}`;
        continue;
      }
      if (path !== cached) await saveCachedCheckPath(admin, path);
      return { ok: true, results };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn(`hook7 check: falha em ${path}: ${lastError}`);
    }
  }
  return { ok: false, results: new Map(), error: lastError };
}

/**
 * Verifica um único telefone. `exists` indefinido = desconhecido (nunca
 * bloquear envio nesse caso).
 */
export async function checkPhoneExistsOnWhatsApp(
  // deno-lint-ignore no-explicit-any
  admin: any,
  companyId: string,
  toPhone: string,
): Promise<{ ok: boolean; exists?: boolean; status?: number; error?: string }> {
  const phone = normalizePhone(toPhone);
  if (!phone) return { ok: false, error: "Telefone inválido" };
  const inst = await getHook7SendInstance(admin, companyId);
  if (!inst) return { ok: false, error: NO_WHATSAPP_INSTANCE_ERROR };
  const r = await checkPhonesOnWhatsApp(admin, inst, [phone]);
  if (!r.ok) return { ok: false, error: r.error };
  const exists = r.results.get(phone);
  if (typeof exists !== "boolean") return { ok: false, error: "número não determinado" };
  return { ok: true, exists };
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
