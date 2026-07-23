import { supabase } from "@/integrations/supabase/client";

export type AuditSeverity = "info" | "warn" | "error" | "critical";

export interface AuditPayload {
  event_type: string;
  severity?: AuditSeverity;
  entity_type?: string | null;
  entity_id?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
  company_id?: string | null;
}

/** Fire-and-forget audit log from the client. Never throws. */
export function logAuditClient(payload: AuditPayload): void {
  try {
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return; // no auth → skip (e.g. post-logout)
      void supabase.functions.invoke("audit-log", { body: payload }).catch(() => {
        /* noop */
      });
    }).catch(() => {
      /* noop */
    });
  } catch {
    /* noop */
  }
}
