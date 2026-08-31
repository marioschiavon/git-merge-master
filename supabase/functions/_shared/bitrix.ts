// Cliente REST do Bitrix24 (webhook de entrada).
//
// IMPORTANTE: o Bitrix NÃO usa header Authorization. O código do webhook vai
// na própria URL: https://PORTAL/rest/USER_ID/CODIGO/metodo
// Por isso o token nunca pode ser logado nem devolvido ao navegador.

export class BitrixError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export interface BitrixCreds {
  portal: string; // empresa.bitrix24.com.br
  userId: string; // 1
  code: string; // segredo do webhook
}

export interface BitrixConfig {
  user_id?: string | null;
  category_id?: string | number | null;
  stage_created?: string | null;
  stage_handoff?: string | null;
  source_id?: string | null;
  field_map?: Record<string, string> | null;
}

const WEBHOOK_RE =
  /^https?:\/\/([a-z0-9.-]+)\/rest\/(\d+)\/([a-z0-9]+)\/?$/i;

/** Extrai portal, user_id e código de uma URL de webhook de entrada. */
export function parseWebhookUrl(raw: string): BitrixCreds {
  const url = String(raw ?? "").trim();
  const m = url.match(WEBHOOK_RE);
  if (!m) {
    throw new BitrixError(
      "URL do webhook inválida. Use o formato https://suaempresa.bitrix24.com.br/rest/1/codigo/",
      400,
    );
  }
  return { portal: m[1], userId: m[2], code: m[3] };
}

/** Reconstrói as credenciais a partir da linha de integrations. */
export function credsFromIntegration(row: {
  api_domain?: string | null;
  api_token?: string | null;
  config?: BitrixConfig | null;
}): BitrixCreds {
  const portal = (row.api_domain ?? "").trim();
  const code = (row.api_token ?? "").trim();
  const userId = String(row.config?.user_id ?? "1");
  if (!portal || !code) throw new BitrixError("Integração do Bitrix24 incompleta.", 400);
  return { portal, userId, code };
}

/** Rate limiter simples: no máximo 2 requisições por segundo. */
class Pacer {
  private last = 0;
  constructor(private minIntervalMs = 500) {}
  async wait() {
    const now = Date.now();
    const wait = this.last + this.minIntervalMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }
}

export function createBitrixClient(creds: BitrixCreds) {
  const pacer = new Pacer(500);
  const base = `https://${creds.portal}/rest/${creds.userId}/${creds.code}`;

  async function call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    await pacer.wait();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${base}/${method}.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      const text = await res.text();
      let payload: any = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new BitrixError(`Resposta inesperada do Bitrix em ${method}.`);
      }
      if (!res.ok || payload?.error) {
        const desc = payload?.error_description || payload?.error || `HTTP ${res.status}`;
        throw new BitrixError(`Bitrix ${method}: ${desc}`, res.status === 401 ? 401 : 502);
      }
      return payload?.result as T;
    } catch (err) {
      if (err instanceof BitrixError) throw err;
      if ((err as Error)?.name === "AbortError") {
        throw new BitrixError(`Tempo esgotado ao chamar ${method} no Bitrix.`, 504);
      }
      throw new BitrixError(`Falha ao chamar ${method} no Bitrix.`);
    } finally {
      clearTimeout(timer);
    }
  }

  return { call, portal: creds.portal };
}

export type BitrixClient = ReturnType<typeof createBitrixClient>;

/** Configuração mínima para o worker poder agir. */
export function configIsReady(cfg: BitrixConfig | null | undefined): boolean {
  if (!cfg) return false;
  return Boolean(
    cfg.category_id !== null &&
      cfg.category_id !== undefined &&
      cfg.category_id !== "" &&
      cfg.stage_created &&
      cfg.stage_handoff,
  );
}
