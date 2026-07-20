// Shared audit-log helper for edge functions.
// Fire-and-forget: never blocks the caller.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AuditSeverity = "info" | "warn" | "error" | "critical";

export interface AuditLogInput {
  companyId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  eventType: string; // e.g. "lead.created", "integration.connected", "edge.error.hook7-webhook"
  severity?: AuditSeverity;
  entityType?: string | null;
  entityId?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
}

export function logAudit(input: AuditLogInput): void {
  const admin = getAdminClient();
  if (!admin) return;
  // Fire and forget
  admin
    .from("audit_logs")
    .insert({
      company_id: input.companyId ?? null,
      user_id: input.userId ?? null,
      user_email: input.userEmail ?? null,
      event_type: input.eventType,
      severity: input.severity ?? "info",
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    })
    .then(({ error }) => {
      if (error) console.error("[audit-log] insert failed:", error.message);
    });
}

export async function logAuditAwait(input: AuditLogInput): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;
  const { error } = await admin.from("audit_logs").insert({
    company_id: input.companyId ?? null,
    user_id: input.userId ?? null,
    user_email: input.userEmail ?? null,
    event_type: input.eventType,
    severity: input.severity ?? "info",
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    message: input.message ?? null,
    metadata: input.metadata ?? {},
    ip: input.ip ?? null,
    user_agent: input.userAgent ?? null,
  });
  if (error) console.error("[audit-log] insert failed:", error.message);
}
