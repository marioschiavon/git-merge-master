import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ActionContext = {
  supabase: ReturnType<typeof createClient>;
  company_id: string;
  lead_id: string;
  conversation_id: string | null;
  intent_log_id: string | null;
  params: Record<string, any>;
};

async function logActivity(ctx: ActionContext, type: string, description: string, metadata: Record<string, any> = {}) {
  try {
    await ctx.supabase.from("lead_activities").insert({
      company_id: ctx.company_id,
      lead_id: ctx.lead_id,
      type,
      description,
      metadata: { source: "execute-action", ...metadata },
    });
  } catch (e) {
    console.error("logActivity failed:", e);
  }
}

async function loadLead(ctx: ActionContext) {
  const { data } = await ctx.supabase.from("leads").select("*").eq("id", ctx.lead_id).maybeSingle();
  return data;
}

async function loadHistory(ctx: ActionContext, limit = 12) {
  if (!ctx.conversation_id) return [];
  const { data } = await ctx.supabase
    .from("messages")
    .select("direction, content")
    .eq("conversation_id", ctx.conversation_id)
    .order("sent_at", { ascending: true })
    .limit(limit);
  return data || [];
}

async function loadConversationChannel(ctx: ActionContext): Promise<string> {
  if (!ctx.conversation_id) return "email";
  const { data } = await ctx.supabase
    .from("conversations")
    .select("channel")
    .eq("id", ctx.conversation_id)
    .maybeSingle();
  return (data?.channel as string) || "email";
}

async function loadIntent(ctx: ActionContext) {
  if (!ctx.intent_log_id) return null;
  const { data } = await ctx.supabase
    .from("lead_intents_log")
    .select("category, sub_intent, entities")
    .eq("id", ctx.intent_log_id)
    .maybeSingle();
  return data;
}

/* ─── Generate-reply helper ─────────────────────────────────────── */
async function generateReply(ctx: ActionContext, opts: { tone?: string; category?: string; sub_intent?: string }) {
  const [lead, history, channel] = await Promise.all([loadLead(ctx), loadHistory(ctx), loadConversationChannel(ctx)]);
  const intent = await loadIntent(ctx);
  const { data, error } = await ctx.supabase.functions.invoke("generate-reply", {
    body: {
      company_id: ctx.company_id,
      lead,
      intent: {
        category: opts.category || intent?.category || "info_request",
        sub_intent: opts.sub_intent || intent?.sub_intent || null,
      },
      history,
      channel,
      tone: opts.tone,
    },
  });
  if (error) throw new Error(`generate-reply failed: ${error.message}`);
  return data as { subject?: string | null; body: string };
}

async function sendOutbound(ctx: ActionContext, content: string, subject: string | null, channel: string, metadata: Record<string, any> = {}) {
  if (!ctx.conversation_id) return { sent: false, reason: "no conversation_id" };
  await ctx.supabase.from("messages").insert({
    conversation_id: ctx.conversation_id,
    content,
    direction: "outbound",
    ai_suggested: true,
    metadata: { source: "execute-action", subject, ...metadata },
  });
  // Try real-channel send when possible
  if (channel === "email") {
    const lead = await loadLead(ctx);
    if (lead?.email) {
      try {
        await ctx.supabase.functions.invoke("gmail-send", {
          body: {
            to: lead.email,
            subject: subject || "Continuando nossa conversa",
            html: content.replace(/\n/g, "<br/>"),
            lead_id: ctx.lead_id,
            company_id: ctx.company_id,
            conversation_id: ctx.conversation_id,
          },
        });
      } catch (e) {
        console.error("gmail-send failed:", e);
      }
    }
  }
  return { sent: true, channel };
}

/* ─── Action handlers ─────────────────────────────────────────────── */
const HANDLERS: Record<string, (ctx: ActionContext) => Promise<any>> = {
  async update_lead_score(ctx) {
    const delta = Number(ctx.params.delta) || 0;
    const { data: l } = await ctx.supabase.from("leads").select("score").eq("id", ctx.lead_id).maybeSingle();
    const newScore = Math.max(0, (l?.score || 0) + delta);
    await ctx.supabase.from("leads").update({ score: newScore }).eq("id", ctx.lead_id);
    await logActivity(ctx, "note", `🎯 Score atualizado: ${delta >= 0 ? "+" : ""}${delta} → ${newScore}`, { delta, new_score: newScore });
    return { new_score: newScore, delta };
  },

  async disqualify_lead(ctx) {
    await ctx.supabase.from("leads").update({ status: "lost" as any }).eq("id", ctx.lead_id);
    await logActivity(ctx, "note", "❌ Lead desqualificado automaticamente", { reason: ctx.params.reason || "intent_rejection" });
    return { status: "lost" };
  },

  async mark_opt_out(ctx) {
    const lead = await loadLead(ctx);
    await ctx.supabase.from("leads").update({ status: "lost" as any }).eq("id", ctx.lead_id);
    if (lead?.email) {
      await ctx.supabase.from("suppressed_emails").upsert(
        { email: lead.email, reason: "opt_out", metadata: { lead_id: ctx.lead_id } } as any,
        { onConflict: "email" } as any,
      );
    }
    await logActivity(ctx, "note", "🚫 Opt-out registrado, e-mail adicionado à supressão");
    return { opted_out: true, email: lead?.email };
  },

  async stop_sequence(ctx) {
    const { data, error } = await ctx.supabase
      .from("cadence_enrollments")
      .update({ status: "paused", paused_reason: ctx.params.reason || "intent_pipeline" } as any)
      .eq("lead_id", ctx.lead_id)
      .in("status", ["active", "paused"])
      .select("id");
    if (error) throw error;
    await logActivity(ctx, "note", `⏸ Cadência pausada (${ctx.params.reason || "intent_pipeline"})`);
    return { paused: data?.length || 0 };
  },

  async handoff_to_human(ctx) {
    await ctx.supabase
      .from("leads")
      .update({
        handoff_required: true,
        handoff_reason: ctx.params.reason || "intent_escalation",
        handoff_at: new Date().toISOString(),
      } as any)
      .eq("id", ctx.lead_id);
    await logActivity(ctx, "note", `👤 Handoff humano solicitado: ${ctx.params.reason || "escalation"}`);
    return { handoff: true };
  },

  async schedule_followup(ctx) {
    const days = Number(ctx.params.days) || 2;
    const scheduledFor = new Date(Date.now() + days * 86400000).toISOString();
    await ctx.supabase.from("lead_action_queue").insert({
      company_id: ctx.company_id,
      lead_id: ctx.lead_id,
      conversation_id: ctx.conversation_id,
      intent_log_id: ctx.intent_log_id,
      action_type: "send_reply" as any,
      params: { tone: "followup", reason: "scheduled_followup" },
      scheduled_for: scheduledFor,
      triggered_by: "schedule_followup",
    });
    await logActivity(ctx, "note", `⏰ Follow-up agendado para daqui ${days}d`, { scheduled_for: scheduledFor });
    return { scheduled_for: scheduledFor };
  },

  async send_reply(ctx) {
    let { message, subject } = ctx.params as { message?: string; subject?: string | null };
    if (!message) {
      const reply = await generateReply(ctx, { tone: ctx.params.tone });
      message = reply.body;
      subject = subject ?? reply.subject ?? null;
    }
    const channel = await loadConversationChannel(ctx);
    const result = await sendOutbound(ctx, message!, subject ?? null, channel, { action: "send_reply" });
    await logActivity(ctx, channel === "whatsapp" ? "whatsapp" : channel === "linkedin" ? "linkedin" : "email",
      `📤 Resposta enviada: ${message!.substring(0, 120)}`, { direction: "outbound", channel });
    return result;
  },

  async ask_clarifying_question(ctx) {
    const reply = await generateReply(ctx, { tone: "pergunta_curta_de_qualificacao" });
    const channel = await loadConversationChannel(ctx);
    await sendOutbound(ctx, reply.body, reply.subject ?? null, channel, { action: "ask_clarifying_question" });
    await logActivity(ctx, "note", `❓ Pergunta de qualificação enviada`);
    return { sent: true };
  },

  async request_info_from_lead(ctx) {
    const missing = ctx.params.missing_fields || ["cargo", "empresa", "e-mail corporativo"];
    const reply = await generateReply(ctx, {
      tone: `peça gentilmente as informações faltantes: ${(missing as string[]).join(", ")}`,
    });
    const channel = await loadConversationChannel(ctx);
    await sendOutbound(ctx, reply.body, reply.subject ?? null, channel, { action: "request_info_from_lead", missing });
    await logActivity(ctx, "note", `📋 Pedido de informações faltantes: ${(missing as string[]).join(", ")}`);
    return { sent: true, missing };
  },

  async suggest_meeting_times(ctx) {
    // Try real Cal.com slots; fall back to AI reply offering generic times
    try {
      const { data: slots, error } = await ctx.supabase.functions.invoke("calcom-slots", {
        body: {
          company_id: ctx.company_id,
          lead_id: ctx.lead_id,
          conversation_id: ctx.conversation_id,
          preferred_channel: await loadConversationChannel(ctx),
        },
      });
      if (error) throw new Error(error.message);
      await logActivity(ctx, "note", `📅 Horários sugeridos via Cal.com`);
      return { slots };
    } catch (e) {
      // Fallback: AI message asking when the lead is free
      const reply = await generateReply(ctx, { tone: "ofereça 2 horários genéricos esta semana para reunião de 20min", category: "scheduling" });
      const channel = await loadConversationChannel(ctx);
      await sendOutbound(ctx, reply.body, reply.subject ?? null, channel, { action: "suggest_meeting_times", fallback: true });
      await logActivity(ctx, "note", `📅 Sugestão de horário enviada (fallback)`);
      return { fallback: true, error: e instanceof Error ? e.message : String(e) };
    }
  },

  async create_cal_booking(ctx) {
    const { selected_datetime, selected_slot } = ctx.params;
    if (!selected_datetime && !selected_slot) {
      throw new Error("create_cal_booking requer selected_datetime ou selected_slot");
    }
    const { data, error } = await ctx.supabase.functions.invoke("calcom-confirm-booking", {
      body: {
        company_id: ctx.company_id,
        lead_id: ctx.lead_id,
        conversation_id: ctx.conversation_id,
        slot_datetime: selected_datetime,
        slot_index: selected_slot,
      },
    });
    if (error) throw new Error(error.message);
    await logActivity(ctx, "meeting", `✅ Reunião confirmada (Cal.com)`, { booking: data });
    return data;
  },

  async send_calendar_link(ctx) {
    const link = Deno.env.get("CALCOM_BOOKING_LINK") || ctx.params.link;
    if (!link) throw new Error("CALCOM_BOOKING_LINK não configurado");
    const lead = await loadLead(ctx);
    const message = `Oi ${lead?.name?.split(" ")[0] || ""}, segue meu link de agenda — escolhe o horário que melhor encaixa: ${link}`;
    const channel = await loadConversationChannel(ctx);
    await sendOutbound(ctx, message, "Agendamento de reunião", channel, { action: "send_calendar_link", link });
    await logActivity(ctx, "note", `🔗 Link de calendário enviado`);
    return { link, sent: true };
  },

  async send_email(ctx) {
    const lead = await loadLead(ctx);
    if (!lead?.email) throw new Error("lead sem e-mail cadastrado");
    let subject = ctx.params.subject as string | undefined;
    let body = ctx.params.body as string | undefined;
    if (!body) {
      const reply = await generateReply(ctx, { tone: ctx.params.tone });
      body = reply.body;
      subject = subject ?? reply.subject ?? "Continuando nossa conversa";
    }
    const { error } = await ctx.supabase.functions.invoke("gmail-send", {
      body: {
        to: lead.email,
        subject: subject || "Continuando nossa conversa",
        html: body!.replace(/\n/g, "<br/>"),
        lead_id: ctx.lead_id,
        company_id: ctx.company_id,
        conversation_id: ctx.conversation_id,
      },
    });
    if (error) throw new Error(`gmail-send failed: ${error.message}`);
    if (ctx.conversation_id) {
      await ctx.supabase.from("messages").insert({
        conversation_id: ctx.conversation_id,
        content: body,
        direction: "outbound",
        ai_suggested: true,
        metadata: { source: "execute-action", action: "send_email", subject } as any,
      });
    }
    await logActivity(ctx, "email", `📧 E-mail enviado: ${subject}`, { direction: "outbound", subject });
    return { sent: true, to: lead.email, subject };
  },

  async create_new_contact(ctx) {
    const { name, email, phone, role, context, company_name } = ctx.params;
    if (!name && !email) throw new Error("create_new_contact requer ao menos name ou email");
    const lead = await loadLead(ctx);
    const { data: newLead, error } = await ctx.supabase
      .from("leads")
      .insert({
        company_id: ctx.company_id,
        name: name || email,
        email: email || null,
        phone: phone || null,
        title: role || null,
        company_name: company_name || lead?.company_name || null,
        source: "referral",
        status: "new" as any,
        referral_source_lead_id: ctx.lead_id,
        referral_role: role || null,
        referral_context: context || null,
        referral_stage: "pending_outreach",
      } as any)
      .select()
      .single();
    if (error) throw error;
    await logActivity(ctx, "note", `🆕 Novo contato criado por indicação: ${name || email}`, { new_lead_id: newLead.id });
    return { new_lead_id: newLead.id };
  },

  async mark_current_contact_as_referrer(ctx) {
    await ctx.supabase
      .from("leads")
      .update({
        referral_stage: "is_referrer",
        referral_permission_to_mention: ctx.params.permission_to_mention ?? true,
        status: "qualified" as any,
      } as any)
      .eq("id", ctx.lead_id);
    await logActivity(ctx, "note", `🔁 Marcado como indicante`);
    return { ok: true };
  },

  async create_call_task(ctx) {
    await ctx.supabase
      .from("leads")
      .update({ call_requested_at: new Date().toISOString(), preferred_channel: "phone" } as any)
      .eq("id", ctx.lead_id);
    await logActivity(ctx, "note", `📞 Ligação solicitada${ctx.params.preferred_time ? ` (preferência: ${ctx.params.preferred_time})` : ""}`,
      { preferred_time: ctx.params.preferred_time });
    return { call_task: true };
  },

  async send_material(ctx) {
    const query = String(ctx.params.material_query || ctx.params.topic || "").trim();
    let material: any = null;
    if (query) {
      const { data } = await ctx.supabase
        .from("company_knowledge")
        .select("title, content, source_url, file_path")
        .eq("company_id", ctx.company_id)
        .not("type", "in", "(highlights,ai_instructions)")
        .ilike("title", `%${query}%`)
        .limit(1)
        .maybeSingle();
      material = data;
    }
    if (!material) {
      const { data } = await ctx.supabase
        .from("company_knowledge")
        .select("title, content, source_url, file_path")
        .eq("company_id", ctx.company_id)
        .not("type", "in", "(highlights,ai_instructions)")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      material = data;
    }
    if (!material) {
      await logActivity(ctx, "note", `📎 Tentou enviar material mas não há conteúdo na base`);
      return { skipped: "no material in knowledge base" };
    }
    const lead = await loadLead(ctx);
    const link = material.source_url || (material.file_path ? `(arquivo: ${material.file_path})` : null);
    const message = `Oi ${lead?.name?.split(" ")[0] || ""}, segue o material sobre **${material.title}**:\n\n${
      (material.content || "").substring(0, 600)
    }${link ? `\n\nMais detalhes: ${link}` : ""}`;
    const channel = await loadConversationChannel(ctx);
    await sendOutbound(ctx, message, `Material: ${material.title}`, channel, { action: "send_material", material_title: material.title });
    await logActivity(ctx, "note", `📎 Material enviado: ${material.title}`);
    return { sent: true, material_title: material.title };
  },

  async recover_no_show(ctx) {
    const reply = await generateReply(ctx, {
      tone: "reagendamento gentil após no-show — sem culpabilizar, oferecer 2 novos horários",
      category: "scheduling",
      sub_intent: "no_show_recovery",
    });
    const channel = await loadConversationChannel(ctx);
    await sendOutbound(ctx, reply.body, reply.subject ?? null, channel, { action: "recover_no_show" });
    await logActivity(ctx, "note", `🔄 Mensagem de recuperação de no-show enviada`);
    return { sent: true };
  },
};

/* ─── Server ─────────────────────────────────────────────────────────── */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    let actionRow: any = null;

    if (body.action_id) {
      const { data, error } = await supabase
        .from("lead_action_queue")
        .select("*")
        .eq("id", body.action_id)
        .maybeSingle();
      if (error || !data) {
        return new Response(JSON.stringify({ error: "ação não encontrada" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      actionRow = data;
    } else {
      actionRow = {
        id: null,
        company_id: body.company_id,
        lead_id: body.lead_id,
        conversation_id: body.conversation_id || null,
        intent_log_id: body.intent_log_id || null,
        action_type: body.action_type,
        params: body.params || {},
        attempts: 0,
      };
    }

    if (!actionRow.company_id || !actionRow.lead_id || !actionRow.action_type) {
      return new Response(JSON.stringify({ error: "company_id, lead_id e action_type são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctx: ActionContext = {
      supabase,
      company_id: actionRow.company_id,
      lead_id: actionRow.lead_id,
      conversation_id: actionRow.conversation_id,
      intent_log_id: actionRow.intent_log_id,
      params: actionRow.params || {},
    };

    let result: any = null;
    let error: string | null = null;
    const handler = HANDLERS[actionRow.action_type as string];

    if (!handler) {
      error = `action_type desconhecido: ${actionRow.action_type}`;
    } else {
      try {
        result = await handler(ctx);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        console.error(`execute-action[${actionRow.action_type}] error:`, e);
      }
    }

    if (actionRow.id) {
      await supabase.from("lead_action_queue").update({
        status: error ? "failed" : "done",
        executed_at: new Date().toISOString(),
        attempts: (actionRow.attempts || 0) + 1,
        result,
        error,
      }).eq("id", actionRow.id);
    }

    return new Response(JSON.stringify({ ok: !error, action_type: actionRow.action_type, result, error }), {
      status: error ? 500 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("execute-action error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
