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

export type BitrixEntity = "deal" | "contact";

export interface BitrixFieldTarget {
  entity: BitrixEntity;
  field: string;
}

export interface BitrixConfig {
  user_id?: string | null;
  category_id?: string | number | null;
  stage_created?: string | null;
  stage_handoff?: string | null;
  source_id?: string | null;
  /** Aceita o formato antigo (string = campo de negócio) e o novo (entidade + campo). */
  field_map?: Record<string, string | BitrixFieldTarget> | null;
}

/** Normaliza o de/para: formato antigo (string) vira { entity: "deal", field }. */
export function normalizeFieldMap(
  raw: Record<string, string | BitrixFieldTarget> | null | undefined,
): Record<string, BitrixFieldTarget> {
  const out: Record<string, BitrixFieldTarget> = {};
  for (const [leadField, value] of Object.entries(raw ?? {})) {
    if (!value) continue;
    if (typeof value === "string") {
      out[leadField] = { entity: "deal", field: value };
    } else if (value.field) {
      out[leadField] = {
        entity: value.entity === "contact" ? "contact" : "deal",
        field: value.field,
      };
    }
  }
  return out;
}

/** Campos do Bitrix que só aceitam lista (crm_multifield). */
const MULTIFIELD = new Set(["EMAIL", "PHONE", "IM", "WEB"]);

export function isMultifield(code: string): boolean {
  return MULTIFIELD.has(code.toUpperCase());
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

/** Campos do lead disponíveis para o de/para. */
export const BITRIX_LEAD_FIELDS = [
  "name",
  "email",
  "phone",
  "whatsapp",
  "title",
  "company_name",
  "website",
  "address",
  "source",
  "status",
  "score",
] as const;

/**
 * Monta os campos a gravar em uma entidade do Bitrix a partir do de/para.
 * Trata multifield (EMAIL/PHONE/WEB/IM) e a divisão de nome/sobrenome.
 */
export function buildEntityFields(
  lead: Record<string, unknown>,
  fieldMap: Record<string, BitrixFieldTarget>,
  entity: BitrixEntity,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const targets = Object.entries(fieldMap).filter(([leadField, t]) =>
    t.entity === entity && (BITRIX_LEAD_FIELDS as readonly string[]).includes(leadField)
  );

  // Nome só é dividido se NAME e LAST_NAME estiverem ambos mapeados a partir de "name".
  const nameTarget = targets.find(([k]) => k === "name")?.[1];
  const splitName = Boolean(
    nameTarget &&
      targets.some(([k, t]) => k === "name" && t.field.toUpperCase() === "LAST_NAME") === false &&
      false,
  );
  void splitName;

  for (const [leadField, target] of targets) {
    const raw = lead[leadField];
    if (raw === null || raw === undefined || raw === "") continue;
    const code = target.field;
    const upper = code.toUpperCase();

    if (isMultifield(upper)) {
      const valueType = leadField === "whatsapp" && upper === "PHONE" ? "MOBILE" : "WORK";
      const existing = (out[code] as Array<Record<string, string>>) ?? [];
      existing.push({ VALUE: String(raw), VALUE_TYPE: valueType });
      out[code] = existing;
      continue;
    }

    out[code] = raw;
  }

  // Divisão explícita de nome: usuário mapeou NAME e LAST_NAME nesta entidade.
  const hasName = Object.values(fieldMap).some(
    (t) => t.entity === entity && t.field.toUpperCase() === "NAME",
  );
  const hasLastName = Object.values(fieldMap).some(
    (t) => t.entity === entity && t.field.toUpperCase() === "LAST_NAME",
  );
  if (hasName && hasLastName) {
    const full = String(lead.name ?? "").trim();
    if (full.includes(" ")) {
      const [first, ...rest] = full.split(/\s+/);
      out.NAME = first;
      out.LAST_NAME = rest.join(" ");
    }
  }

  return out;
}
