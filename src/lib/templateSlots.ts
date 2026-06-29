// Parser e renderer client-side para templates híbridos.
// Sintaxe:
//   {{lead.first_name}}            -> substituição direta de campo do lead
//   {{ai:descrição do conteúdo}}   -> slot que será gerado por IA
//
// O renderer client-side só consegue resolver os campos do lead. Para slots
// de IA, use o edge function `render-template-slots` que devolve um mapa
// { key: valor } a ser combinado aqui via `renderWithSlots`.

export type ParsedSlot = {
  key: string;       // identificador estável (ex: ai_0, ai_hook)
  prompt: string;    // descrição passada à IA
  raw: string;       // string original incluindo {{ai:...}}
  maxTokens?: number;
};

export type ParsedLeadField = {
  path: string;      // ex: first_name, company.name
  raw: string;
};

export type ParsedTemplate = {
  body: string;
  slots: ParsedSlot[];
  leadFields: ParsedLeadField[];
};

const SLOT_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export function parseTemplate(body: string): ParsedTemplate {
  const slots: ParsedSlot[] = [];
  const leadFields: ParsedLeadField[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = SLOT_RE.exec(body)) !== null) {
    const raw = m[0];
    const inner = m[1].trim();
    if (inner.toLowerCase().startsWith("ai:")) {
      const prompt = inner.slice(3).trim();
      const key = `ai_${idx++}`;
      slots.push({ key, prompt, raw });
    } else if (inner.toLowerCase().startsWith("lead.")) {
      const path = inner.slice(5).trim();
      leadFields.push({ path, raw });
    } else {
      // Tratado como lead field genérico (compat).
      leadFields.push({ path: inner, raw });
    }
  }
  return { body, slots, leadFields };
}

function getField(obj: any, path: string): string {
  if (!obj) return "";
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return "";
    cur = cur[p];
  }
  return cur == null ? "" : String(cur);
}

export function renderWithSlots(
  body: string,
  lead: Record<string, any>,
  slotValues: Record<string, string> = {},
): string {
  const parsed = parseTemplate(body);
  let out = body;
  for (const f of parsed.leadFields) {
    out = out.split(f.raw).join(getField(lead, f.path));
  }
  // re-parse slots in order so keys align
  let idx = 0;
  out = out.replace(SLOT_RE, (raw, inner) => {
    const trimmed = String(inner).trim();
    if (!trimmed.toLowerCase().startsWith("ai:")) return raw;
    const key = `ai_${idx++}`;
    return slotValues[key] ?? "";
  });
  return out;
}

export function previewWithPlaceholders(body: string): string {
  // Render para edição: substitui slots ai por [IA: ...] e campos por [first_name]
  return body.replace(SLOT_RE, (_, inner) => {
    const t = String(inner).trim();
    if (t.toLowerCase().startsWith("ai:")) return `〔IA: ${t.slice(3).trim()}〕`;
    if (t.toLowerCase().startsWith("lead.")) return `〔${t.slice(5).trim()}〕`;
    return `〔${t}〕`;
  });
}
