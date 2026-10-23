// Cliente e regras da esteira Leaderei → Pipedrive.
// O token fica só no servidor (vai na query string da API v1, nunca em log).

export type PipedriveEntity = "deal" | "person";

export interface PipedriveFieldTarget {
  entity: PipedriveEntity;
  field: string;
}

export interface PipedriveConfig {
  push_enabled?: boolean;
  pipeline_id?: number | string | null;
  stage_created?: number | string | null;
  stage_replied?: number | string | null;
  stage_meeting?: number | string | null;
  stage_handoff?: number | string | null;
  owner_id?: number | string | null;
  field_map?: Record<string, PipedriveFieldTarget>;
}

/** O negócio só avança: criação < em conversa < reunião < atendimento humano. */
export const STAGE_RANK = {
  create_deal: 1,
  stage_replied: 2,
  stage_meeting: 3,
  move_stage: 4,
} as const;

export type PipedriveEvent = keyof typeof STAGE_RANK;

export function shouldAdvance(currentRank: number, event: string): boolean {
  const next = STAGE_RANK[event as PipedriveEvent] ?? 0;
  return next > (Number(currentRank) || 0);
}

export function stageForEvent(config: PipedriveConfig, event: string): string | null {
  const v = event === "stage_replied"
    ? config.stage_replied
    : event === "stage_meeting"
    ? config.stage_meeting
    : event === "move_stage"
    ? config.stage_handoff
    : event === "create_deal"
    ? config.stage_created
    : null;
  return v === null || v === undefined || v === "" ? null : String(v);
}

export function configIsReady(cfg: PipedriveConfig | null | undefined): boolean {
  return !!cfg && cfg.push_enabled === true && !!cfg.pipeline_id && !!cfg.stage_created;
}

/** Monta os campos de uma entidade a partir do de/para. Valores vazios são ignorados. */
export function buildEntityFields(
  lead: Record<string, unknown>,
  map: Record<string, PipedriveFieldTarget> | null | undefined,
  entity: PipedriveEntity,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [leadKey, target] of Object.entries(map ?? {})) {
    if (!target?.field || target.entity !== entity) continue;
    const value = lead[leadKey];
    if (value === null || value === undefined || value === "") continue;
    out[target.field] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export interface PipedriveClient {
  get<T = any>(path: string, params?: Record<string, string | number>): Promise<T>;
  post<T = any>(path: string, body: Record<string, unknown>): Promise<T>;
  put<T = any>(path: string, body: Record<string, unknown>): Promise<T>;
}

export function createPipedriveClient(apiToken: string): PipedriveClient {
  let last = 0;
  async function call(method: string, path: string, params: Record<string, string | number> = {}, body?: unknown) {
    const wait = 500 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_token: apiToken });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`https://api.pipedrive.com/v1${path}?${qs}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        const msg = data?.error || data?.error_info || `HTTP ${res.status}`;
        throw new Error(`Pipedrive ${method} ${path}: ${msg}`);
      }
      return data?.data;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    get: (p, params) => call("GET", p, params),
    post: (p, b) => call("POST", p, {}, b),
    put: (p, b) => call("PUT", p, {}, b),
  };
}
