// Human-in-the-Loop gate: checks company.hitl_enabled and creates approval_requests.
// When the gate fires, the caller MUST NOT send — it should record the approval and skip.

export type HitlScope = "first_message" | "sdr_reply" | "cadence_step" | "sensitive_action";

export interface ApprovalParams {
  company_id: string;
  lead_id: string | null;
  conversation_id?: string | null;
  enrollment_id?: string | null;
  cadence_id?: string | null;
  kind: HitlScope;
  channel?: string | null;
  action?: string;
  payload: Record<string, any>;
  context?: Record<string, any>;
}

/**
 * Returns true if a new outbound for the given scope should be intercepted.
 */
export async function shouldGate(
  supabase: any,
  companyId: string,
  scope: HitlScope,
): Promise<boolean> {
  if (!companyId) {
    console.log("[hitl-gate] no company_id → bypass", { scope });
    return false;
  }
  const { data, error } = await supabase
    .from("companies")
    .select("hitl_enabled, hitl_scopes")
    .eq("id", companyId)
    .maybeSingle();
  if (error || !data) {
    console.log("[hitl-gate] company lookup failed → bypass", { scope, companyId, error });
    return false;
  }
  if (!data.hitl_enabled) {
    console.log("[hitl-gate] hitl_enabled=false → bypass", { scope, companyId });
    return false;
  }
  const scopes = (data.hitl_scopes || {}) as Record<string, boolean>;
  const decision = scopes[scope] !== false;
  console.log("[hitl-gate] decision", { companyId, scope, hitl_enabled: data.hitl_enabled, scopes, gate: decision });
  return decision;
}

/**
 * Creates a pending approval_request. Returns the new row id.
 * If a pending one already exists for the same (enrollment_id, kind), reuses it.
 */
export async function createApprovalRequest(
  supabase: any,
  params: ApprovalParams,
): Promise<{ id: string; created: boolean } | null> {
  try {
    if (params.enrollment_id) {
      const { data: existing } = await supabase
        .from("approval_requests")
        .select("id")
        .eq("enrollment_id", params.enrollment_id)
        .eq("kind", params.kind)
        .eq("status", "pending")
        .maybeSingle();
      if (existing) return { id: existing.id, created: false };
    }
    const { data, error } = await supabase
      .from("approval_requests")
      .insert({
        company_id: params.company_id,
        lead_id: params.lead_id,
        conversation_id: params.conversation_id ?? null,
        enrollment_id: params.enrollment_id ?? null,
        cadence_id: params.cadence_id ?? null,
        kind: params.kind,
        channel: params.channel ?? null,
        action: params.action ?? "send",
        payload: params.payload,
        context: params.context ?? {},
        status: "pending",
      })
      .select("id")
      .single();
    if (error) {
      console.error("createApprovalRequest failed:", error);
      return null;
    }
    // Log activity so it shows on the lead timeline
    if (params.lead_id) {
      await supabase.from("lead_activities").insert({
        company_id: params.company_id,
        lead_id: params.lead_id,
        type: "system",
        description: `🕓 Aguardando aprovação humana (${labelFor(params.kind)})`,
        metadata: { approval_id: data.id, kind: params.kind, channel: params.channel },
      });
    }
    return { id: data.id, created: true };
  } catch (e) {
    console.error("createApprovalRequest exception:", e);
    return null;
  }
}

function labelFor(kind: HitlScope): string {
  switch (kind) {
    case "first_message": return "primeira mensagem";
    case "sdr_reply": return "resposta do SDR";
    case "cadence_step": return "passo de cadência";
    case "sensitive_action": return "ação sensível";
  }
}
