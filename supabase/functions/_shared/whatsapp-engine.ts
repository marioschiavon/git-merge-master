// Camada de integração com o provedor de WhatsApp (padrão atual da API do
// provedor: rotas com o nome da instância na URL).
//
// Convenções mantidas do modelo anterior:
//   - HOOK7_GLOBAL_APIKEY  → chave global usada para criar/apagar instâncias.
//   - Token por instância  → definido no /instance/create e usado nas demais
//     chamadas daquela instância (header `apikey`).
//   - HOOK7_INSTANCE_TOKEN_PASSPHRASE → passphrase (pgcrypto) das RPCs
//     set/get_hook7_instance_token.
//   - HOOK7_WEBHOOK_SECRET → path secret do webhook.
//
// Nada aqui deve vazar nome de fornecedor/motor para a interface do cliente.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getHook7BaseUrl, getHook7GlobalApiKey } from "./hook7.ts";

export const ENGINE_EVOLUTION_API = "evolution_api";
export const ENGINE_LEGACY = "legacy";

// Eventos assinados no webhook da instância.
export const WA_WEBHOOK_EVENTS = [
  "QRCODE_UPDATED",
  "CONNECTION_UPDATE",
  "MESSAGES_UPSERT",
  "MESSAGES_UPDATE",
  "SEND_MESSAGE",
] as const;

export class EngineError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function buildWaWebhookUrl(companySlug: string): string {
  const secret = (Deno.env.get("HOOK7_WEBHOOK_SECRET") ?? "").trim();
  const supaUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim().replace(/\/+$/, "");
  if (!secret || !supaUrl) return "";
  return `${supaUrl}/functions/v1/whatsapp-webhook/${secret}/${encodeURIComponent(companySlug)}`;
}

export interface EngineFetchOpts {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  apikey: string;
  body?: unknown;
  timeoutMs?: number;
  baseUrl?: string;
  admin?: SupabaseClient;
}

export async function engineFetch<T = unknown>(
  path: string,
  opts: EngineFetchOpts,
): Promise<T> {
  const base = opts.baseUrl ?? (await getHook7BaseUrl(opts.admin));
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers: {
        apikey: opts.apikey,
        Authorization: `Bearer ${opts.apikey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error
      ? (e.name === "AbortError" ? "tempo esgotado" : e.message)
      : "erro de rede";
    throw new EngineError(`Não foi possível contactar o serviço de WhatsApp: ${msg}`, 504);
  }
  clearTimeout(timer);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch { /* resposta não-JSON */ }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new EngineError("Credencial do serviço de WhatsApp inválida.", 401);
    }
    if (res.status === 404) {
      throw new EngineError("Conexão de WhatsApp não existe mais no servidor.", 404);
    }
    // deno-lint-ignore no-explicit-any
    const j = json as any;
    const msg = j?.response?.message || j?.error?.message || j?.message || j?.error ||
      `HTTP ${res.status}`;
    throw new EngineError(
      typeof msg === "string" ? msg : JSON.stringify(msg).slice(0, 200),
      res.status,
    );
  }
  return json as T;
}

const enc = (v: string) => encodeURIComponent(v);

// ---------------------------------------------------------------------------
// Instâncias
// ---------------------------------------------------------------------------

export interface CreatedInstance {
  external_id: string | null;
  external_name: string;
  token: string;
  qrcode_base64: string | null;
}

export async function createInstance(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  token: string;
  webhookUrl: string;
}): Promise<CreatedInstance> {
  const apikey = getHook7GlobalApiKey();
  const body: Record<string, unknown> = {
    instanceName: opts.instanceName,
    token: opts.token,
    qrcode: true,
    integration: "WHATSAPP-BAILEYS",
  };
  if (opts.webhookUrl) {
    body.webhook = {
      enabled: true,
      url: opts.webhookUrl,
      byEvents: false,
      base64: true,
      events: [...WA_WEBHOOK_EVENTS],
    };
  }
  // deno-lint-ignore no-explicit-any
  const r: any = await engineFetch("/instance/create", {
    method: "POST",
    apikey,
    body,
    admin: opts.admin,
    timeoutMs: 30000,
  });
  const inst = r?.instance ?? r?.data?.instance ?? r?.data ?? {};
  const hash = r?.hash ?? r?.data?.hash;
  const token = (typeof hash === "string" && hash) ||
    hash?.apikey || inst?.apikey || inst?.token || opts.token;
  return {
    external_id: inst?.instanceId ?? inst?.id ?? null,
    external_name: inst?.instanceName ?? inst?.name ?? opts.instanceName,
    token: String(token),
    qrcode_base64: pickQr(r),
  };
}

// deno-lint-ignore no-explicit-any
function pickQr(r: any): string | null {
  const raw = r?.qrcode?.base64 ?? r?.qrcode?.code ?? r?.base64 ?? r?.code ??
    r?.data?.qrcode?.base64 ?? r?.data?.base64 ?? null;
  return typeof raw === "string" && raw.length > 20 ? raw : null;
}

/** Dispara a conexão e devolve o QR-Code (base64 ou string do QR). */
export async function connectInstance(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  apikey: string;
}): Promise<{ qrcode_base64: string | null; pairing_code: string | null; state: string | null }> {
  // deno-lint-ignore no-explicit-any
  const r: any = await engineFetch(`/instance/connect/${enc(opts.instanceName)}`, {
    method: "GET",
    apikey: opts.apikey,
    admin: opts.admin,
    timeoutMs: 25000,
  });
  return {
    qrcode_base64: pickQr(r),
    pairing_code: typeof r?.pairingCode === "string" ? r.pairingCode : null,
    state: typeof r?.instance?.state === "string" ? r.instance.state : null,
  };
}

export type EngineState = "open" | "connecting" | "close" | "unknown";

export async function connectionState(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  apikey: string;
  timeoutMs?: number;
}): Promise<EngineState> {
  // deno-lint-ignore no-explicit-any
  const r: any = await engineFetch(`/instance/connectionState/${enc(opts.instanceName)}`, {
    method: "GET",
    apikey: opts.apikey,
    admin: opts.admin,
    timeoutMs: opts.timeoutMs ?? 10000,
  });
  const s = String(r?.instance?.state ?? r?.state ?? "").toLowerCase();
  if (s === "open" || s === "connecting" || s === "close") return s;
  return "unknown";
}

export async function logoutInstance(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  apikey: string;
}): Promise<void> {
  await engineFetch(`/instance/logout/${enc(opts.instanceName)}`, {
    method: "DELETE",
    apikey: opts.apikey,
    admin: opts.admin,
    timeoutMs: 15000,
  });
}

export async function deleteInstance(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  apikey?: string;
}): Promise<void> {
  await engineFetch(`/instance/delete/${enc(opts.instanceName)}`, {
    method: "DELETE",
    apikey: opts.apikey ?? getHook7GlobalApiKey(),
    admin: opts.admin,
    timeoutMs: 15000,
  });
}

export async function restartInstance(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  apikey: string;
}): Promise<void> {
  await engineFetch(`/instance/restart/${enc(opts.instanceName)}`, {
    method: "POST",
    apikey: opts.apikey,
    body: {},
    admin: opts.admin,
    timeoutMs: 20000,
  });
}

/** (Re)configura o webhook da instância. Tolera variações de payload. */
export async function setInstanceWebhook(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  apikey: string;
  webhookUrl: string;
}): Promise<boolean> {
  if (!opts.webhookUrl) return false;
  const nested = {
    webhook: {
      enabled: true,
      url: opts.webhookUrl,
      byEvents: false,
      base64: true,
      events: [...WA_WEBHOOK_EVENTS],
    },
  };
  const flat = {
    enabled: true,
    url: opts.webhookUrl,
    webhookByEvents: false,
    webhookBase64: true,
    events: [...WA_WEBHOOK_EVENTS],
  };
  for (const body of [nested, flat]) {
    try {
      await engineFetch(`/webhook/set/${enc(opts.instanceName)}`, {
        method: "POST",
        apikey: opts.apikey,
        body,
        admin: opts.admin,
        timeoutMs: 15000,
      });
      return true;
    } catch (e) {
      console.warn("[whatsapp-engine] falha ao configurar webhook:", String(e));
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

export interface SendTextResult {
  ok: boolean;
  sid?: string;
  status?: number;
  error?: string;
}

export async function sendTextMessage(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  apikey: string;
  number: string;
  text: string;
}): Promise<SendTextResult> {
  const bodies: Record<string, unknown>[] = [
    { number: opts.number, text: opts.text },
    { number: opts.number, textMessage: { text: opts.text } },
  ];
  let lastError = "falha ao enviar";
  let lastStatus: number | undefined;
  for (const body of bodies) {
    try {
      // deno-lint-ignore no-explicit-any
      const r: any = await engineFetch(`/message/sendText/${enc(opts.instanceName)}`, {
        method: "POST",
        apikey: opts.apikey,
        body,
        admin: opts.admin,
        timeoutMs: 25000,
      });
      const sid = r?.key?.id ?? r?.data?.key?.id ?? r?.messageId ?? r?.id;
      return { ok: true, sid: sid ? String(sid) : undefined, status: 200 };
    } catch (e) {
      const err = e as EngineError;
      lastError = err?.message ?? String(e);
      lastStatus = err?.status;
      // 400 pode significar formato de corpo diferente: tenta a próxima variação.
      if (lastStatus !== 400) break;
    }
  }
  return { ok: false, error: lastError, status: lastStatus };
}

export async function checkNumbers(opts: {
  admin?: SupabaseClient;
  instanceName: string;
  apikey: string;
  numbers: string[];
  // deno-lint-ignore no-explicit-any
}): Promise<any> {
  return await engineFetch(`/chat/whatsappNumbers/${enc(opts.instanceName)}`, {
    method: "POST",
    apikey: opts.apikey,
    body: { numbers: opts.numbers },
    admin: opts.admin,
    timeoutMs: 20000,
  });
}
