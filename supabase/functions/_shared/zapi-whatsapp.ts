// Helper compartilhado para envio de WhatsApp via Z-API com credenciais POR EMPRESA.
// As credenciais ficam em public.integrations (provider='zapi_whatsapp', config jsonb).

export interface ZApiConfig {
  instance_id: string;
  token: string;
  client_token?: string; // Account Security Token (header Client-Token) — opcional
  whatsapp_number?: string;
}

export async function getZApiConfig(
  supabase: any,
  companyId: string,
): Promise<ZApiConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config, status")
    .eq("company_id", companyId)
    .eq("provider", "zapi_whatsapp")
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  const cfg = data.config as any;
  if (!cfg?.instance_id || !cfg?.token) return null;
  return cfg as ZApiConfig;
}

// Z-API espera telefone E.164 SEM o "+" (apenas dígitos, com DDI).
function normalizePhoneForZApi(num: string): string {
  return String(num).trim().replace(/^whatsapp:/i, "").replace(/\D/g, "");
}

export interface ZApiSendResult {
  ok: boolean;
  sid?: string; // messageId retornado pela Z-API
  status?: number;
  error?: string;
}

function baseUrl(cfg: ZApiConfig): string {
  return `https://api.z-api.io/instances/${cfg.instance_id}/token/${cfg.token}`;
}

export async function sendWhatsAppViaZApi(
  cfg: ZApiConfig,
  toPhone: string,
  body: string,
): Promise<ZApiSendResult> {
  const phone = normalizePhoneForZApi(toPhone);
  if (!phone) return { ok: false, error: "Telefone inválido" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.client_token) headers["Client-Token"] = cfg.client_token;
  try {
    const res = await fetch(`${baseUrl(cfg)}/send-text`, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, message: body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: json?.error || json?.message || JSON.stringify(json),
      };
    }
    return { ok: true, sid: json?.messageId || json?.zaapId, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function verifyZApiCredentials(
  cfg: ZApiConfig,
): Promise<{ ok: boolean; connected?: boolean; smartphone_connected?: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {};
    if (cfg.client_token) headers["Client-Token"] = cfg.client_token;
    const res = await fetch(`${baseUrl(cfg)}/status`, { headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error || json?.message || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      connected: !!json?.connected,
      smartphone_connected: !!json?.smartphoneConnected,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// Verifica se um número de telefone está registrado no WhatsApp.
// Usa endpoint Z-API GET /phone-exists/{phone}.
export async function checkPhoneExistsOnWhatsApp(
  cfg: ZApiConfig,
  toPhone: string,
): Promise<{ ok: boolean; exists?: boolean; status?: number; error?: string }> {
  const phone = normalizePhoneForZApi(toPhone);
  if (!phone) return { ok: false, error: "Telefone inválido" };
  try {
    const headers: Record<string, string> = {};
    if (cfg.client_token) headers["Client-Token"] = cfg.client_token;
    const res = await fetch(`${baseUrl(cfg)}/phone-exists/${phone}`, { headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: json?.error || json?.message || `HTTP ${res.status}` };
    }
    const exists = !!(json?.exists ?? json?.existsWhatsapp ?? json?.exists_whatsapp);
    return { ok: true, exists, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
