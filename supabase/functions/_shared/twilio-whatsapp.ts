// Helper compartilhado para envio de WhatsApp via Twilio com credenciais POR EMPRESA.
// As credenciais ficam em public.integrations (provider='twilio_whatsapp', config jsonb).

export interface TwilioWhatsAppConfig {
  account_sid: string;
  auth_token: string;
  whatsapp_number: string; // E.164, ex: +14155238886
  is_sandbox?: boolean;
}

export async function getTwilioConfig(
  supabase: any,
  companyId: string
): Promise<TwilioWhatsAppConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("config, status")
    .eq("company_id", companyId)
    .eq("provider", "twilio_whatsapp")
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  const cfg = data.config as any;
  if (!cfg?.account_sid || !cfg?.auth_token || !cfg?.whatsapp_number) return null;
  return cfg as TwilioWhatsAppConfig;
}

function normalizePhone(num: string): string {
  const trimmed = String(num).trim().replace(/^whatsapp:/i, "");
  return trimmed.startsWith("+") ? trimmed : `+${trimmed.replace(/\D/g, "")}`;
}

export interface TwilioSendResult {
  ok: boolean;
  sid?: string;
  status?: number;
  error?: string;
}

export async function sendWhatsAppViaTwilio(
  cfg: TwilioWhatsAppConfig,
  toPhone: string,
  body: string
): Promise<TwilioSendResult> {
  const to = normalizePhone(toPhone);
  const from = normalizePhone(cfg.whatsapp_number);
  const auth = btoa(`${cfg.account_sid}:${cfg.auth_token}`);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.account_sid}/Messages.json`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: `whatsapp:${to}`,
        From: `whatsapp:${from}`,
        Body: body,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: json?.message || JSON.stringify(json) };
    }
    return { ok: true, sid: json?.sid, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function verifyTwilioCredentials(
  cfg: Pick<TwilioWhatsAppConfig, "account_sid" | "auth_token">
): Promise<{ ok: boolean; friendly_name?: string; error?: string }> {
  const auth = btoa(`${cfg.account_sid}:${cfg.auth_token}`);
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${cfg.account_sid}.json`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.message || `HTTP ${res.status}` };
    return { ok: true, friendly_name: json?.friendly_name };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
