// Enfileira envios de WhatsApp com jitter, caps por instância, warm-up e
// cooldown por lead. Chamada pelos call sites que antes chamavam
// sendWhatsAppViaHook7 diretamente (cadence-executor, approval-execute…).
//
// Ao enfileirar, o item recebe scheduled_for = último_agendado_da_instancia + jitter
// (min_gap_seconds..max_gap_seconds). O cron `whatsapp-send-tick` consome a fila.

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface EnqueueInput {
  companyId: string;
  toPhone: string;
  body: string;
  leadId?: string | null;
  conversationId?: string | null;
  approvalId?: string | null;
  enrollmentId?: string | null;
  source: string; // 'approval' | 'cadence_step' | 'first_message' | 'manual' | ...
  metadata?: Record<string, unknown>;
  /**
   * Modo resposta: quando o item é uma resposta a lead engajado (aprovação
   * sdr_reply / sensitive_action, ou última msg foi inbound). Ignora o
   * "último pendente da instância" e agenda em segundos, com priority=10
   * para o send-tick pegar na frente do outbound frio.
   */
  replyMode?: boolean;
}

export interface EnqueueResult {
  ok: boolean;
  queue_id?: string;
  scheduled_for?: string;
  error?: string;
}

function randInt(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function resolveInstance(admin: Admin, companyId: string) {
  const { data } = await admin
    .from("hook7_instances")
    .select("id, external_name, status, min_gap_seconds, max_gap_seconds, daily_send_cap, hourly_send_cap, warmup_started_at")
    .eq("company_id", companyId)
    .eq("status", "connected")
    .is("archived_at", null)
    .order("last_connected_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Enfileira um envio de WhatsApp. Retorna imediatamente com scheduled_for
 * calculado a partir do último item pendente/enviado da mesma instância.
 */
export async function enqueueWhatsAppSend(
  admin: Admin,
  input: EnqueueInput,
): Promise<EnqueueResult> {
  if (!input.companyId || !input.toPhone || !input.body) {
    return { ok: false, error: "companyId/toPhone/body são obrigatórios" };
  }
  const instance = await resolveInstance(admin, input.companyId);
  if (!instance) {
    return { ok: false, error: "Nenhuma instância WhatsApp (Hook7) conectada" };
  }

  const minGap = Math.max(5, instance.min_gap_seconds ?? 45);
  const maxGap = Math.max(minGap, instance.max_gap_seconds ?? 90);

  // Detecção automática de "modo resposta": se a última mensagem daquele
  // lead no canal whatsapp for INBOUND, tratamos como resposta a lead
  // engajado (mesma prioridade da approval sdr_reply).
  let replyMode = !!input.replyMode;
  if (!replyMode && input.leadId) {
    const { data: convs } = await admin
      .from("conversations")
      .select("id")
      .eq("lead_id", input.leadId)
      .eq("channel", "whatsapp");
    const convIds = (convs || []).map((c: any) => c.id);
    if (convIds.length > 0) {
      const { data: lastMsg } = await admin
        .from("messages")
        .select("direction")
        .in("conversation_id", convIds)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastMsg?.direction === "inbound") replyMode = true;
    }
  }

  const now = Date.now();
  let scheduledFor: string;
  let priority = 0;

  if (replyMode) {
    // Resposta a lead engajado: jitter curto (3-10s), ignora o último pendente
    // da instância. O send-tick pula business hours e caps para respostas.
    priority = 10;
    const jitterMs = randInt(3, 10) * 1000;
    scheduledFor = new Date(now + jitterMs).toISOString();
  } else {
    // Base = maior entre "agora" e o último scheduled_for pendente da instância;
    // se não houver pendente, considera o último envio bem-sucedido.
    let base = now;
    const { data: lastPending } = await admin
      .from("whatsapp_send_queue")
      .select("scheduled_for")
      .eq("instance_id", instance.id)
      .in("status", ["pending", "sending"])
      .order("scheduled_for", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastPending?.scheduled_for) {
      base = Math.max(base, new Date(lastPending.scheduled_for).getTime());
    } else {
      const { data: lastSent } = await admin
        .from("whatsapp_send_queue")
        .select("sent_at")
        .eq("instance_id", instance.id)
        .eq("status", "sent")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastSent?.sent_at) base = Math.max(base, new Date(lastSent.sent_at).getTime());
    }
    const gapMs = randInt(minGap, maxGap) * 1000;
    scheduledFor = new Date(base + gapMs).toISOString();
  }

  const { data: row, error } = await admin
    .from("whatsapp_send_queue")
    .insert({
      company_id: input.companyId,
      instance_id: instance.id,
      lead_id: input.leadId ?? null,
      conversation_id: input.conversationId ?? null,
      approval_id: input.approvalId ?? null,
      enrollment_id: input.enrollmentId ?? null,
      to_phone: input.toPhone,
      body: input.body,
      source: input.source,
      scheduled_for: scheduledFor,
      priority,
      metadata: input.metadata ?? {},
    })
    .select("id, scheduled_for")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, queue_id: row.id, scheduled_for: row.scheduled_for };
}
