import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { stripQuotedEmail } from "../_shared/strip-quoted-email.ts";
import { routeAndEnqueue } from "../_shared/route-intent.ts";
import { extractDateRangeFromText } from "../_shared/date-range.ts";
import { insertBookingSystemMessage } from "../_shared/booking-messages.ts";
import { formatBRTLong } from "../_shared/datetime.ts";
import { getZApiConfig, sendWhatsAppViaZApi } from "../_shared/zapi-whatsapp.ts";
import { cancelCalcomBooking, cancelCalcomReservation } from "../_shared/calcom.ts";
import { clarifyingReplyFor, detectMeetingClarifier, normalizePtText } from "../_shared/meeting-clarifier.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Convert local Brasília time (UTC-3) components to UTC ISO string.
 * "12h BRT" → "15h UTC" → "2026-04-15T15:00:00.000Z"
 */
const BRT_OFFSET_HOURS = 3;

function toBrtIso(year: number, month: number, day: number, hour: number, minute: number): string {
  const dt = new Date(Date.UTC(year, month, day, hour + BRT_OFFSET_HOURS, minute));
  return dt.toISOString();
}

/** Format a UTC ISO datetime string as a human-readable BRT string */
function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toEmailHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
}

/** Normalize phone to BR +55... format. Returns null if invalid. */
function normalizeBrPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  d = d.replace(/^00/, "").replace(/^0+/, "");
  if (d.length < 10 || d.length > 13) return null;
  if (!d.startsWith("55")) {
    if (d.length === 10 || d.length === 11) d = "55" + d;
    else return null;
  }
  if (d.length !== 12 && d.length !== 13) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  if (/^(\d)\1+$/.test(d.slice(4))) return null;
  return "+" + d;
}

/** True when BR phone is a mobile (13 digits with leading 9). */
function isBrMobile(normalized: string | null): boolean {
  if (!normalized) return false;
  const d = normalized.replace(/\D/g, "");
  return d.length === 13 && d[4] === "9";
}

/** Normalize AI-provided channel to exactly "email" or "whatsapp". */
function pickReferralChannel(raw: any, hasEmail: boolean, hasPhone: boolean): "email" | "whatsapp" {
  const s = String(raw || "").toLowerCase();
  const wantsEmail = /email|e-mail|mail/.test(s);
  const wantsWa = /whats|wa\b|telefone|phone|sms/.test(s);
  if (wantsEmail && !wantsWa && hasEmail) return "email";
  if (wantsWa && !wantsEmail && hasPhone) return "whatsapp";
  if (hasEmail) return "email";
  if (hasPhone) return "whatsapp";
  return "email";
}

function companyNameFromWebsite(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0];
    if (!label) return null;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return null;
  }
}

function formatDateTimeBrt(isoString: string): string {
  return formatBRTLong(isoString);
}

/**
 * Fallback server-side datetime parser for Portuguese date expressions.
 * Returns ISO 8601 string or null. All times are interpreted as Brasília (UTC-3).
 */
function extractDateTimeFromText(text: string): string | null {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  // Current time in BRT for comparisons
  const nowBrt = new Date(now.getTime() - BRT_OFFSET_HOURS * 3600000);

  // Pattern: "dia DD às HH:MM" or "dia DD as HHh" or "dia DD as HH:MM"
  const diaMatch = text.match(/dia\s+(\d{1,2})\s+[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (diaMatch) {
    const day = parseInt(diaMatch[1]);
    const hour = parseInt(diaMatch[2]);
    const minute = parseInt(diaMatch[3] || "0");
    let month = currentMonth;
    if (day < nowBrt.getUTCDate() || (day === nowBrt.getUTCDate() && hour < nowBrt.getUTCHours())) {
      month += 1;
    }
    return toBrtIso(currentYear, month, day, hour, minute);
  }

  // Pattern: "DD/MM às HH:MM" or "DD/MM as HHh"
  const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})\s+[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (slashMatch) {
    const day = parseInt(slashMatch[1]);
    const month = parseInt(slashMatch[2]) - 1;
    const hour = parseInt(slashMatch[3]);
    const minute = parseInt(slashMatch[4] || "0");
    return toBrtIso(currentYear, month, day, hour, minute);
  }

  // Pattern: weekday + time, e.g. "terça às 14h", "segunda as 10:00"
  const weekdayMap: Record<string, number> = {
    domingo: 0, segunda: 1, terça: 2, terca: 2, quarta: 3,
    quinta: 4, sexta: 5, sábado: 6, sabado: 6,
  };
  const weekdayMatch = text.match(/(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)\s+[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (weekdayMatch) {
    const targetDay = weekdayMap[weekdayMatch[1].toLowerCase().replace("ç", "c").replace("á", "a")] ?? -1;
    const hour = parseInt(weekdayMatch[2]);
    const minute = parseInt(weekdayMatch[3] || "0");
    if (targetDay >= 0) {
      const todayBrt = nowBrt.getUTCDay();
      let diff = targetDay - todayBrt;
      if (diff <= 0) diff += 7;
      const targetDate = new Date(nowBrt);
      targetDate.setUTCDate(targetDate.getUTCDate() + diff);
      return toBrtIso(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), hour, minute);
    }
  }

  // Pattern: just time "às HHh" or "as HH:MM" (assume today or tomorrow in BRT)
  const timeOnly = text.match(/[àa]s?\s+(\d{1,2})(?::(\d{2})|\s*h)/i);
  if (timeOnly) {
    const hour = parseInt(timeOnly[1]);
    const minute = parseInt(timeOnly[2] || "0");
    let day = nowBrt.getUTCDate();
    let month = nowBrt.getUTCMonth();
    let year = nowBrt.getUTCFullYear();
    // If time already passed today in BRT, use tomorrow
    if (hour < nowBrt.getUTCHours() || (hour === nowBrt.getUTCHours() && minute <= nowBrt.getUTCMinutes())) {
      const tomorrow = new Date(nowBrt);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      day = tomorrow.getUTCDate();
      month = tomorrow.getUTCMonth();
      year = tomorrow.getUTCFullYear();
    }
    return toBrtIso(year, month, day, hour, minute);
  }

  return null;
}

// stripQuotedEmail imported from _shared/strip-quoted-email.ts

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Accept both Twilio webhook format and direct JSON
    let body: any;
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      body = {
        from: formData.get("From"),
        content: formData.get("Body"),
        channel: "whatsapp",
      };
    } else {
      body = await req.json();
    }

    const { from, content, channel, conversation_id, lead_id, skip_insert, provider, provider_message_id } = body;

    if (!content) {
      return new Response(JSON.stringify({ error: "content é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find conversation
    let convId = conversation_id;
    let leadData: any = null;
    let companyId: string | null = null;
    let convChannel: string | null = channel || null;

    if (!convId && lead_id) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, company_id, channel, leads(id, name, email, company_name, phone, whatsapp, pending_email_slot_hold_id, website, address, linkedin_company_url, pipeline_mode)")
        .eq("lead_id", lead_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (conv) {
        convId = conv.id;
        companyId = conv.company_id;
        convChannel = conv.channel;
        leadData = (conv as any).leads;
      }
    } else if (convId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id, company_id, channel, leads(id, name, email, company_name, phone, whatsapp, pending_email_slot_hold_id, website, address, linkedin_company_url, pipeline_mode)")
        .eq("id", convId)
        .maybeSingle();
      if (conv) {
        companyId = conv.company_id;
        convChannel = conv.channel;
        leadData = (conv as any).leads;
      }
    }


    if (!convId) {
      return new Response(JSON.stringify({ error: "Conversa não encontrada" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // FIX: Strip quoted email content before saving
    const cleanContent = stripQuotedEmail(content);
    console.log("Original content length:", content.length, "Clean content length:", cleanContent.length, "skip_insert:", !!skip_insert);

    // IDEMPOTÊNCIA: evita reprocessar a MESMA mensagem do mesmo lead duas vezes.
    // Causa observada: zapi-webhook (ou retry) + outro caller dispararam inbound-webhook
    // duas vezes para "Dia 16", e a segunda execução cancelou o booking recém-confirmado.
    if (leadData?.id) {
      try {
        // Hash leve do conteúdo + bucket de 5min, para mensagens sem provider_message_id.
        const enc = new TextEncoder().encode(`${leadData.id}|${convChannel || channel || ""}|${cleanContent.trim().toLowerCase()}`);
        const hashBuf = await crypto.subtle.digest("SHA-1", enc);
        const contentHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

        const pid = provider_message_id ? String(provider_message_id) : null;
        const prov = provider ? String(provider) : (convChannel || channel || null);

        // 1) Checa duplicata por provider_message_id (janela de 10 min)
        if (pid) {
          const { data: dupPid } = await supabase
            .from("processed_inbound_messages")
            .select("id, processed_at")
            .eq("lead_id", leadData.id)
            .eq("provider", prov)
            .eq("provider_message_id", pid)
            .gte("processed_at", new Date(Date.now() - 10 * 60_000).toISOString())
            .maybeSingle();
          if (dupPid) {
            console.log(`INBOUND_DEDUP_SKIP provider_message_id=${pid} lead=${leadData.id}`);
            return new Response(JSON.stringify({ ok: true, deduped: true, reason: "provider_message_id" }), {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        // 2) Checa duplicata por hash de conteúdo (mesmo lead, mesmo texto, últimos 2 min)
        const { data: dupHash } = await supabase
          .from("processed_inbound_messages")
          .select("id, processed_at")
          .eq("lead_id", leadData.id)
          .eq("content_hash", contentHash)
          .gte("processed_at", new Date(Date.now() - 2 * 60_000).toISOString())
          .maybeSingle();
        if (dupHash) {
          console.log(`INBOUND_DEDUP_SKIP content_hash=${contentHash.slice(0, 8)} lead=${leadData.id}`);
          return new Response(JSON.stringify({ ok: true, deduped: true, reason: "content_hash" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Grava marcador ANTES do processamento — o UNIQUE INDEX cobre a corrida.
        const { error: insErr } = await supabase
          .from("processed_inbound_messages")
          .insert({
            lead_id: leadData.id,
            provider: prov,
            provider_message_id: pid,
            content_hash: contentHash,
          });
        if (insErr && (insErr as any).code === "23505") {
          console.log(`INBOUND_DEDUP_SKIP race lead=${leadData.id}`);
          return new Response(JSON.stringify({ ok: true, deduped: true, reason: "race" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.error("inbound-webhook dedup guard failed (continuing):", e);
      }
    }

    // EARLY: detectar perguntas esclarecedoras (duração/formato/etc) — usado para impedir
    // que o classificador de intent roteie como scheduling e também como blindagem final.
    const earlyClarifyingKind = detectMeetingClarifier(cleanContent);
    const earlyInboundDt = extractDateTimeFromText(cleanContent);
    if (earlyClarifyingKind && !earlyInboundDt) {
      console.log(`MEETING_CLARIFIER_BYPASS detected kind=${earlyClarifyingKind} norm="${normalizePtText(cleanContent)}" stage=early`);
    }

    // Save inbound message (with clean content) — pulado quando a mensagem já foi inserida pelo caller (ex: gmail-sync-inbox)
    if (!skip_insert) {
      await supabase.from("messages").insert({
        conversation_id: convId,
        content: cleanContent,
        direction: "inbound",
        ai_suggested: false,
      });
    }

    // === FAST-PATH: lead respondeu o email pendente após hold ===
    // Se há um slot_holds em hold aguardando o email do lead, e a mensagem inbound contém
    // um endereço de email válido, confirmamos o booking imediatamente sem passar pela IA.
    let earlyParsed: any = null;
    {
      const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
      const emailMatch = emailRegex.exec(cleanContent)?.[0]?.trim() || null;
      const pendingHoldId: string | null = leadData?.pending_email_slot_hold_id || null;

      if (pendingHoldId && emailMatch && leadData?.id) {
        const { data: hold } = await supabase
          .from("slot_holds")
          .select("id, slot_datetime, status, expires_at, cal_booking_uid")
          .eq("id", pendingHoldId)
          .maybeSingle();

        const stillValid = !!hold
          && hold.status === "held"
          && new Date(hold.expires_at).getTime() > Date.now();

        if (stillValid) {
          if (emailMatch && emailMatch.toLowerCase() !== (leadData.email || "").toLowerCase()) {
            await supabase.from("leads").update({ email: emailMatch }).eq("id", leadData.id);
            leadData.email = emailMatch;
          }

          console.log(`Pending email fulfilled — confirming held slot ${pendingHoldId} for lead ${leadData.id}`);
          try {
            const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
              body: { lead_id: leadData.id, selected_slot_hold_id: pendingHoldId },
            });
            if (confirmRes.data?.success) {
              const formattedDate = formatDateTimeBrt(hold.slot_datetime);
              console.log(`Booking auto-confirmed via pending email path: ${hold.slot_datetime}`);
              earlyParsed = {
                action: "reply",
                sentiment: "positivo",
                reasoning: "Lead respondeu com email após hold pendente — booking confirmado automaticamente",
                reply_message: `Combinado! Reunião marcada para ${formattedDate}. Você receberá o convite por e-mail. Até lá! 🚀`,
                selected_slot: null,
              };
            } else {
              console.error("Pending-email confirm failed:", confirmRes.data?.error || confirmRes.error);
            }
          } catch (e) {
            console.error("Error invoking calcom-confirm-booking (pending email path):", e);
          }
        } else {
          console.log(`Pending hold ${pendingHoldId} expired/invalid — clearing pending_email_slot_hold_id and continuing normal flow`);
          const upd: any = { pending_email_slot_hold_id: null };
          if (!leadData.email) {
            upd.email = emailMatch;
            leadData.email = emailMatch;
          }
          await supabase.from("leads").update(upd).eq("id", leadData.id);
        }
      }
    }

    // FIX: Read enrollment state BEFORE overwriting paused_reason
    let originalPausedReason: string | null = null;
    let enrollmentId: string | null = null;
    if (convId) {
      const { data: convData } = await supabase
        .from("conversations")
        .select("cadence_enrollment_id")
        .eq("id", convId)
        .maybeSingle();

      if (convData?.cadence_enrollment_id) {
        enrollmentId = convData.cadence_enrollment_id;
        // Read current paused_reason BEFORE updating
        const { data: enrollState } = await supabase
          .from("cadence_enrollments")
          .select("paused_reason")
          .eq("id", enrollmentId)
          .maybeSingle();
        originalPausedReason = enrollState?.paused_reason || null;

        // FIX: Only set lead_replied if NOT in scheduling flow
        if (originalPausedReason !== "awaiting_slot_confirmation") {
          await supabase
            .from("cadence_enrollments")
            .update({ status: "paused", paused_reason: "lead_replied" } as any)
            .eq("id", enrollmentId)
            .in("status", ["active", "completed"]);
        }
      }
    }

    // Log inbound activity
    if (companyId && leadData?.id) {
      const channelLabel = convChannel || channel || "email";
      const channelEmoji = channelLabel === "whatsapp" ? "📱" : channelLabel === "linkedin" ? "💼" : "📧";
      await supabase.from("lead_activities").insert({
        company_id: companyId,
        lead_id: leadData.id,
        type: channelLabel === "multi_channel" ? "email" : channelLabel,
        description: `${channelEmoji} Resposta recebida: ${cleanContent.substring(0, 150)}`,
        metadata: { direction: "inbound", channel: channelLabel },
      });
    }

    // Lead responded — pause any pending slot-expiry follow-up progression
    if (companyId && leadData?.id) {
      await supabase
        .from("slot_expiry_followups")
        .update({ next_action_at: null, metadata: { resolved_by: "lead_reply", resolved_at: new Date().toISOString() } })
        .eq("lead_id", leadData.id)
        .neq("stage", "no_response");
    }


    // Classify intent + route side-effect actions (does not duplicate reply — legacy flow below handles that)
    // Skip when message is a clarifying question (duration/format/etc) without datetime — would be mis-routed as scheduling.
    let lastIntentCategory: string | null = null;
    let lastIntentSubIntent: string | null = null;
    let lastIntentEntities: Record<string, any> | null = null;
    let lastIntentLogId: string | null = null;
    const isAgentMode = leadData?.pipeline_mode === "agent";

    if (!earlyParsed && companyId && leadData?.id && !(earlyClarifyingKind && !earlyInboundDt) && !isAgentMode) {
      try {
        // Build brief history for classifier
        const { data: recentMsgs } = await supabase
          .from("messages")
          .select("direction, content")
          .eq("conversation_id", convId)
          .order("sent_at", { ascending: false })
          .limit(6);
        const history = (recentMsgs || []).reverse();

        const { data: clf, error: clfErr } = await supabase.functions.invoke("classify-intent", {
          body: {
            company_id: companyId,
            lead_id: leadData.id,
            conversation_id: convId,
            message_content: cleanContent,
            history,
          },
        });

        if (!clfErr && clf?.intent_log_id && clf?.category) {
          lastIntentCategory = clf.category;
          lastIntentSubIntent = clf.sub_intent || null;
          lastIntentEntities = clf.entities || null;
          lastIntentLogId = clf.intent_log_id;
          if (clf?.is_auto_reply) {
            console.log("intent skipped: auto-reply detected, no routing/actions");
            await supabase.from("lead_activities").insert({
              company_id: companyId,
              lead_id: leadData.id,
              type: "note",
              description: "🤖 Mensagem identificada como resposta automática do número de destino — nenhuma ação tomada. Verifique se o número de WhatsApp do lead está correto.",
              metadata: { source: "inbound-webhook", auto_reply: true, conversation_id: convId },
            });
          } else {
            const route = await routeAndEnqueue(supabase, {
              company_id: companyId,
              lead_id: leadData.id,
              conversation_id: convId,
              intent_log_id: clf.intent_log_id,
              category: clf.category,
              sub_intent: clf.sub_intent || null,
              confidence: Number(clf.confidence) || 0,
            }, { include_reply_actions: false });
            console.log("intent routed:", clf.category, clf.sub_intent, "→", route);
          }
        } else if (clfErr) {
          console.error("classify-intent error:", clfErr);
        }
      } catch (e) {
        console.error("intent pipeline error:", e);
      }
    }

    // SDR-AGENT:
    // - Modo agent (live): enfileira no debounce (`pending_inbound_runs`) e deixa
    //   o cron `sdr-debounce-tick` disparar UMA execução agrupada após ~12s sem
    //   novas mensagens. Isso evita 3 respostas paralelas quando o lead manda
    //   várias mensagens em sequência.
    // - Modo shadow (legacy): mantém invocação direta (não envia mensagens reais).
    if (!earlyParsed && companyId && leadData?.id) {
      try {
        if (isAgentMode) {
          const DEBOUNCE_MS = 12_000;
          const now = new Date();
          const scheduledAt = new Date(now.getTime() + DEBOUNCE_MS).toISOString();
          const lastInboundAt = now.toISOString();

          // Upsert: cada mensagem nova estende a janela (trailing-edge debounce).
          // O cron só dispara quando scheduled_at <= now() e status='pending'.
          const { error: pendErr } = await supabase
            .from("pending_inbound_runs")
            .upsert(
              {
                lead_id: leadData.id,
                company_id: companyId,
                conversation_id: convId ?? null,
                scheduled_at: scheduledAt,
                last_inbound_at: lastInboundAt,
                status: "pending",
                claimed_at: null,
                last_error: null,
              },
              { onConflict: "lead_id" },
            );
          if (pendErr) {
            console.error("pending_inbound_runs upsert error:", pendErr);
            // Fallback: invoca direto se o debounce falhar, pra não perder a resposta.
            const agentPromise = supabase.functions
              .invoke("sdr-agent", {
                body: { lead_id: leadData.id, conversation_id: convId, trigger: "inbound", mode: "live" },
              })
              .then(({ error }) => { if (error) console.error("sdr-agent fallback invoke error:", error); })
              .catch((e) => console.error("sdr-agent fallback invoke threw:", e));
            // @ts-ignore
            if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(agentPromise);
          } else {
            console.log(`sdr-agent debounced (lead=${leadData.id} fires_at=${scheduledAt})`);
          }
        } else {
          // shadow mode — invocação direta (sem efeito colateral no lead)
          console.log(`sdr-agent invoke (mode=shadow) lead=${leadData.id}`);
          const agentPromise = supabase.functions
            .invoke("sdr-agent", {
              body: { lead_id: leadData.id, conversation_id: convId, trigger: "inbound", mode: "shadow" },
            })
            .then(({ error }) => { if (error) console.error("sdr-agent shadow invoke error:", error); })
            .catch((e) => console.error("sdr-agent shadow invoke threw:", e));
          // @ts-ignore
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(agentPromise);
        }
      } catch (e) {
        console.error("sdr-agent trigger error:", e);
      }
    }


    // Em agent mode, o sdr-agent é o único dono da resposta.
    // Pula todo o pipeline legado (classify → scheduling → outbound) para
    // não enviar duas mensagens nem duplicar slot_holds.
    if (isAgentMode && leadData?.id) {
      console.log(`agent mode: skipping legacy classify/scheduling/outbound for lead=${leadData.id}`);
      return new Response(JSON.stringify({ ok: true, agent_mode: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }





    // ─── Capture/overwrite lead's own email when they include one in the message ───
    // Runs after intent classification so we know whether the email is a referral.
    if (leadData?.id) {
      const emailRe = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
      const matches = cleanContent.match(emailRe) || [];
      if (matches.length === 1) {
        const candidate = matches[0].toLowerCase().trim();
        const referredEmail = (lastIntentEntities?.referred_email as string | undefined)?.toLowerCase().trim();
        const isReferral =
          lastIntentCategory === "routing" ||
          lastIntentSubIntent === "referral" ||
          (referredEmail && referredEmail === candidate);
        const isLikelyOwnEmail =
          !isReferral &&
          (
            (lastIntentCategory === "channel_switch" && lastIntentSubIntent === "send_by_email") ||
            cleanContent.trim().length <= 80
          );
        const currentEmail = (leadData.email as string | undefined)?.toLowerCase().trim() || null;
        if (isLikelyOwnEmail && candidate !== currentEmail) {
          const { error: upErr } = await supabase
            .from("leads")
            .update({ email: candidate })
            .eq("id", leadData.id);
          if (upErr) {
            console.error("failed to overwrite lead email:", upErr);
          } else {
            console.log(`Lead email overwritten: ${currentEmail || "(empty)"} → ${candidate}`);
            await supabase.from("lead_activities").insert({
              company_id: companyId,
              lead_id: leadData.id,
              type: "note",
              description: currentEmail
                ? `✉️ E-mail do lead atualizado: ${currentEmail} → ${candidate}`
                : `✉️ E-mail do lead capturado da conversa: ${candidate}`,
              metadata: { source: "inbound-webhook", previous: currentEmail, new: candidate },
            });
            leadData.email = candidate;
          }
        }
      }
    }




    // Check for held slots (FIX: filter out expired slots)
    let heldSlots: any[] = [];
    if (leadData?.id) {
      const { data: slots } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime, cal_booking_uid, status")
        .eq("lead_id", leadData.id)
        .eq("status", "held")
        .gt("expires_at", new Date().toISOString())
        .order("slot_datetime", { ascending: true });
      heldSlots = slots || [];
    }

    // Find active/paused enrollment for this lead
    const { data: enrollment } = await supabase
      .from("cadence_enrollments")
      .select("id, cadence_id, paused_reason")
      .eq("lead_id", leadData?.id)
      .in("status", ["active", "paused"])
      .maybeSingle();

    // FIX: Detect scheduling in progress via preserved original state OR current enrollment
    let schedulingInProgress = false;
    if (originalPausedReason === "awaiting_slot_confirmation" || enrollment?.paused_reason === "awaiting_slot_confirmation") {
      schedulingInProgress = true;
      console.log("Scheduling in progress detected (paused_reason was awaiting_slot_confirmation)");
    }

    // FIX: Check last outbound message for schedule loop guard
    let lastOutboundWasSchedule = false;
    let lastOfferedSlots: string[] = [];
    {
      const { data: lastOutbound } = await supabase
        .from("messages")
        .select("metadata")
        .eq("conversation_id", convId)
        .eq("direction", "outbound")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastOutbound?.metadata) {
        const meta = lastOutbound.metadata as any;
        if (["schedule", "reject_slots", "check_availability", "reschedule"].includes(meta.action)) {
          lastOutboundWasSchedule = true;
          schedulingInProgress = true;
          console.log("Last outbound was schedule/reject_slots — forcing scheduling context");
        }
        if (meta.offered_slots) {
          lastOfferedSlots = meta.offered_slots;
        }
      }
    }

    // Fetch Cal.com meeting duration (used to answer clarifying questions like "quanto tempo dura?")
    let meetingMinutes: number | null = null;
    if (companyId) {
      try {
        const { getMeetingDurationMinutes } = await import("../_shared/meeting-duration.ts");
        meetingMinutes = await getMeetingDurationMinutes(supabase, companyId);
      } catch (e) {
        console.error("getMeetingDurationMinutes failed", e);
      }
    }
    const durationLine = meetingMinutes
      ? `\nDURAÇÃO REAL DA REUNIÃO: ${meetingMinutes} minutos (do Cal.com). Informe APENAS se o lead perguntar.`
      : `\nDURAÇÃO REAL DA REUNIÃO: desconhecida. Se o lead perguntar, responda "rapidinho, no máximo meia hora".`;
    const clarifyRule = `\n\nIMPORTANTE — perguntas esclarecedoras:
Se o lead estiver APENAS fazendo uma pergunta sobre a reunião (quanto tempo dura, qual o formato, é online/presencial, quem participa, qual o objetivo, é gravada, etc.), use action = "reply" e responda DIRETAMENTE a pergunta. NÃO escolha confirm_slot / reject_slots / check_availability nessa situação — mantenha os horários oferecidos intactos.`;

    // Format slot context for AI
    let slotContext = "";
    if (heldSlots.length >= 2) {
      const formatted = heldSlots.map((s: any, i: number) =>
        `${i + 1}) ${formatDateTimeBrt(s.slot_datetime)}`
      );
      slotContext = `\n\nATENÇÃO: O prospect recebeu 2 opções de horário para reunião:
${formatted.join("\n")}
${durationLine}

INSTRUÇÕES PARA SLOTS PENDENTES:
- Se o prospect está confirmando ou escolhendo um desses horários → action = "confirm_slot" e selected_slot = número da opção (1 ou 2)
- Se o prospect rejeitou ambos os horários (ex: "nenhum funciona", "não consigo nesses dias", "tenho compromisso") → action = "reject_slots"
- Se o prospect sugeriu um horário alternativo (ex: "pode ser terça às 14h?", "prefiro quinta de manhã") → action = "check_availability" e inclua "suggested_datetime" no formato ISO 8601 (YYYY-MM-DDTHH:mm:ss)${clarifyRule}`;
    } else if (heldSlots.length === 1) {
      const formatted = formatDateTimeBrt(heldSlots[0].slot_datetime);
      slotContext = `\n\nATENÇÃO: O prospect recebeu 1 opção de horário para reunião:
1) ${formatted}
${durationLine}

INSTRUÇÕES PARA SLOT PENDENTE:
- Se o prospect está confirmando esse horário → action = "confirm_slot" e selected_slot = 1
- Se o prospect rejeitou o horário → action = "reject_slots"
- Se o prospect sugeriu um horário alternativo → action = "check_availability" e inclua "suggested_datetime" no formato ISO 8601${clarifyRule}`;
    } else if (schedulingInProgress) {
      // FIX: Even without active slots, give context that scheduling is happening
      let offeredSlotsContext = "";
      if (lastOfferedSlots.length > 0) {
        offeredSlotsContext = `\nHorários anteriormente oferecidos (já expiraram): ${lastOfferedSlots.map((s: string) => formatDateTimeBrt(s)).join(", ")}`;
      }
      slotContext = `\n\nATENÇÃO: Há um processo de agendamento em andamento com este prospect (os horários anteriores já expiraram).${offeredSlotsContext}
${durationLine}
Se o prospect mencionar qualquer horário, dia ou disponibilidade → action = "check_availability" com suggested_datetime em ISO 8601 (YYYY-MM-DDTHH:mm:ss).
Se o prospect confirmar um dos horários anteriores → action = "check_availability" com o datetime correspondente.
Se o prospect rejeitar completamente a ideia de reunião → action = "pause".
NÃO use action = "schedule" pois já estamos em processo de agendamento.${clarifyRule}`;
    }

    // Get conversation history
    const { data: messages } = await supabase
      .from("messages")
      .select("direction, content")
      .eq("conversation_id", convId)
      .order("sent_at", { ascending: true })
      .limit(20);

    // Load company knowledge base (single source of truth — prevents AI hallucination)
    let knowledgeContext = "";
    let highlightsContext = "";
    let aiInstructionsContext = "";
    if (companyId) {
      const [knowledgeRes, highlightsRes, aiInstructionsRes] = await Promise.all([
        supabase.from("company_knowledge").select("title, content").eq("company_id", companyId).not("type", "in", "(highlights,ai_instructions)").limit(10),
        supabase.from("company_knowledge").select("content").eq("company_id", companyId).eq("type", "highlights").maybeSingle(),
        supabase.from("company_knowledge").select("content").eq("company_id", companyId).eq("type", "ai_instructions").maybeSingle(),
      ]);
      knowledgeContext = (knowledgeRes.data || []).map((k: any) => `## ${k.title}\n${k.content}`).join("\n\n");
      highlightsContext = highlightsRes.data?.content || "";
      aiInstructionsContext = aiInstructionsRes.data?.content || "";
    }

    // Pre-fetch confirmed booking for this lead (used by prompt + double-booking guard)
    let confirmedSlotForPrompt: { id: string; slot_datetime: string } | null = null;
    if (leadData?.id) {
      const { data: cs } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime")
        .eq("lead_id", leadData.id)
        .eq("status", "confirmed")
        .order("slot_datetime", { ascending: false })
        .limit(1);
      if (cs?.length) confirmedSlotForPrompt = cs[0] as any;
    }
    const confirmedBookingBlock = confirmedSlotForPrompt
      ? `\n=== REUNIÃO ATUALMENTE CONFIRMADA ===\n${formatDateTimeBrt(confirmedSlotForPrompt.slot_datetime)}\n→ Se o prospect pedir para TROCAR/ALTERAR/MOVER/REMARCAR esse horário (com ou sem nova data), use action = "reschedule" e preencha "suggested_datetime" se ele indicou um novo horário.\n→ NUNCA use "check_availability" quando já existe reunião confirmada — sempre use "reschedule".\n→ Se ele quiser CANCELAR sem remarcar, use "cancel".\n→ Se a mensagem do prospect for apenas agradecimento ou confirmação social (ex.: "obrigado", "valeu", "ok", "perfeito", "combinado", "até lá", "show", "beleza") → use action = "reply" com uma resposta curta e amigável (ex.: "Combinado! Até lá 👋"). NÃO use "schedule", "check_availability" nem "suggest_meeting_times" nesse caso.\n=====================================\n`
      : "";

    const hasKnowledge = !!(knowledgeContext || highlightsContext);
    const knowledgeBlock = hasKnowledge
      ? `=== BASE DE CONHECIMENTO DA EMPRESA (ÚNICA FONTE DA VERDADE) ===
${highlightsContext ? `DIFERENCIAIS APROVADOS:\n${highlightsContext}\n\n` : ""}${knowledgeContext ? `INFORMAÇÕES DA EMPRESA/PRODUTO:\n${knowledgeContext}\n\n` : ""}${aiInstructionsContext ? `INSTRUÇÕES DE ABORDAGEM (PRIORIDADE MÁXIMA):\n${aiInstructionsContext}\n` : ""}================================================================

REGRAS ANTI-ALUCINAÇÃO (sobrepõem qualquer outra instrução):
- Use APENAS fatos, features, números, integrações, casos e nomes presentes na BASE acima.
- É TERMINANTEMENTE PROIBIDO inventar produto, funcionalidade, métrica, painel, integração, caso de cliente ou qualquer informação que não esteja na BASE.
- Se o prospect perguntar algo que não está na BASE → responda honestamente ("vou confirmar com o time e te retorno na reunião") e puxe para agendar. NUNCA preencha a lacuna com suposição.
- Se as INSTRUÇÕES DE ABORDAGEM disserem que o prospect não tem fit, NÃO force gancho — seja honesto.
`
      : `=== BASE DE CONHECIMENTO DA EMPRESA ===
(vazia — empresa ainda não cadastrou informações)
========================================

REGRAS ANTI-ALUCINAÇÃO:
- Como a base está vazia, NÃO mencione features, produtos, métricas, integrações ou nomes específicos.
- Mantenha a resposta neutra, focada em qualificar o prospect e agendar reunião para apresentação detalhada.
- NUNCA invente o que a empresa faz ou vende.
`;

    // Analyze with AI
    const systemPrompt = `${knowledgeBlock}${confirmedBookingBlock}

Você é um SDR autônomo de vendas B2B. Analise a resposta do prospect e decida a ação.


OBJETIVO PRINCIPAL: Seu objetivo FINAL é sempre agendar uma reunião com o prospect. Todas as interações devem caminhar para isso. Se o prospect demonstra QUALQUER interesse, direcione para agendamento (action = "schedule"). Se ele sugere um horário, use action = "check_availability".

AÇÕES POSSÍVEIS:
- "reply": responder automaticamente (objeção, dúvida, neutro)
- "schedule": prospect demonstrou interesse em reunião → parar cadência e confirmar horário
- "confirm_slot": prospect está confirmando/escolhendo um dos horários já oferecidos
- "request_email": acionado AUTOMATICAMENTE pelo sistema quando confirm_slot é detectado mas o lead não tem e-mail cadastrado (não escolha esta ação diretamente — apenas use confirm_slot e o sistema redireciona)
- "reject_slots": prospect rejeitou ambos os horários oferecidos (ex: "nenhum funciona", "tenho compromisso nesses dias")
- "check_availability": prospect sugeriu um horário alternativo próprio (ex: "pode ser terça às 14h?")
  → inclua "suggested_datetime" no formato ISO 8601 (YYYY-MM-DDTHH:mm:ss)
- "reschedule": prospect quer remarcar/reagendar uma reunião JÁ CONFIRMADA anteriormente (ex: "preciso remarcar", "surgiu um imprevisto", "mudar a reunião", "trocar o horário"). NÃO use "reschedule" se não houver reunião confirmada — nesse caso use "check_availability".
  → se o prospect já indicou novo horário, inclua "suggested_datetime" no formato ISO 8601
- "cancel": use APENAS quando o prospect deixar EXPLÍCITO que não quer mais a reunião nem remarcar (ex: "não tenho mais interesse", "desisto", "cancela de vez", "não precisa mais", "não vou fazer"). Se ele só disser "quero desmarcar/cancelar a reunião" sem sinalizar perda de interesse → use "reschedule" (vamos oferecer novos horários). NÃO usar para rejeição geral do produto (use "pause").
- "pause": prospect rejeitou totalmente a abordagem/produto → pausar cadência E enviar mensagem curta de agradecimento + porta aberta para retorno futuro
- "referral": prospect indicou outra pessoa, disse que não é responsável, vai encaminhar internamente, ou é um gatekeeper (recepção/atendimento)
- "request_call": prospect pediu para ser contatado por TELEFONE/LIGAÇÃO ("me liga", "prefiro por telefone", "pode me ligar amanhã às 10h") → criar tarefa de ligação para o time humano. Inclua "call_window" (frase curta com horário/data preferida, se informada) e "call_phone" (telefone, se informado ou já presente no lead).
- "handoff": prospect fez pergunta TÉCNICA, REGULATÓRIA, JURÍDICA, CLÍNICA ou COMERCIAL ESPECÍFICA que NÃO está na BASE DE CONHECIMENTO e exige especialista humano (ex: dosagem, posologia, contrato, NF-e, certificações ANVISA/MAPA, condições especiais de pagamento, integrações customizadas) → passar para humano. NÃO invente resposta. Use reply_message curto avisando que um especialista vai retornar.

CAPTURA DE E-MAIL (para confirmar reunião por convite):
- Se a última mensagem do prospect contém um e-mail válido (formato algo@dominio.tld) E há contexto de agendamento (slots pendentes OU pedido recente de e-mail) → preencha "provided_email" com o endereço informado.
- Se o prospect disser explicitamente que NÃO tem e-mail / não quer informar / prefere sem convite → preencha "email_refused": true.
- Caso contrário, "provided_email": null e "email_refused": false.
- IMPORTANTE: se o prospect pedir contato/material/resumo por e-mail E o contexto do lead já mostrar "E-mail cadastrado: <algo>" (não "nenhum"), NÃO pergunte "qual o melhor e-mail". Apenas confirme curto, ex.: "Combinado! Posso te enviar para <email>?". Só pergunte um novo se ele recusar ou pedir outro endereço.



DETECÇÃO DE INDICAÇÃO / ENCAMINHAMENTO (action = "referral"):
Use quando o prospect:
- diz que outra pessoa é responsável ("fala com X", "quem cuida disso é Y", "isso é com o marketing/compras/comercial/dono/RT")
- vai encaminhar internamente ("vou encaminhar", "vou repassar", "vou mandar pro grupo")
- diz que não é a pessoa certa ("não sou eu", "não cuido disso", "não posso passar contato")
- é claramente recepção/atendimento respondendo em nome da empresa
Subtypes (referral.subtype):
- "with_contact": indicou e passou nome E (email OU telefone) do decisor → o sistema vai criar novo lead
- "without_contact": indicou alguém mas não passou contato → pedir WhatsApp/e-mail
- "will_forward": vai encaminhar internamente → enviar texto curto e encaminhável
- "wrong_person": disse que não é responsável (sem indicar quem é) → perguntar quem é
- "gatekeeper": recepcionista/atendente → pedir direcionamento ao responsável, NÃO vender
- "refuses_contact": recusou passar contato → oferecer texto encaminhável e encerrar

REGRAS DE INDICAÇÃO (obrigatórias):
- NUNCA insistir em vender para quem disse que não é o responsável.
- Sempre pedir permissão para citar quem indicou (se ainda não autorizou explicitamente).
- Mensagens curtas, sem pressão, agradecendo a ajuda.
- Para "with_contact": no campo new_outreach_message gere a 1ª abordagem para o lead indicado, contextualizando a indicação (use o nome de quem indicou se permission_to_mention=true, caso contrário use frase neutra "Falei com a equipe da {empresa} e me indicaram você"). Use a BASE DE CONHECIMENTO para a tagline da empresa. Termine com pergunta leve sobre disponibilidade para conversa rápida. NUNCA inclua dia/hora.

PLAYBOOKS POR CARGO (adapte o tom da new_outreach_message e de qualquer reply ao indicado de acordo com referred_role):
- "tecnico" | "responsavel_tecnico" | "veterinario" | "rt" | "farmaceutico" → tom técnico, focar em conformidade, eficácia, evidências, estudos, fichas técnicas. Evitar argumentos comerciais agressivos.
- "compras" | "suprimentos" | "procurement" → focar em condições comerciais, prazo de entrega, MOQ, oferecer apresentação/catálogo. Tom direto e objetivo.
- "marketing" | "trade" → focar em posicionamento, cases, co-marketing, geração de demanda. Tom criativo.
- "comercial" | "vendas" | "sales" → focar em parceria, comissionamento, volume, ticket médio. Tom de igual para igual.
- "socio" | "dono" | "ceo" | "diretor" | "founder" → focar em ROI, visão estratégica, tempo curto (1 frase + CTA). Tom executivo.
- desconhecido/null → tom neutro consultivo padrão.
Use o campo "playbook" (string) na saída JSON para registrar qual playbook aplicou ("tecnico"|"compras"|"marketing"|"comercial"|"socio"|"neutro").

REGRAS:
- REGRA CRÍTICA: NUNCA sugira horários específicos (dia/hora) no reply_message. Se o prospect quer agendar reunião, use action = "schedule" para que o sistema busque horários reais no calendário. O reply_message NUNCA deve conter dias da semana ou horários.
- Se o prospect menciona "reunião", "agendar", "conversar", "demo", "horário" E NÃO há slots pendentes → action = "schedule"
- Se há slots pendentes e o prospect está escolhendo um deles → action = "confirm_slot" com selected_slot = 1 ou 2
- Se há slots pendentes e o prospect recusou ambos → action = "reject_slots"
- Se há slots pendentes e o prospect sugeriu outro horário → action = "check_availability" com suggested_datetime
- Se o prospect diz "não tenho interesse", "não quero", "remova", "pare" → action = "pause" (reply_message OBRIGATÓRIO: agradecer a sinceridade, dizer que vai pausar o contato, deixar porta aberta para retorno futuro — sem insistir, sem CTA de venda, sem perguntas)
- Se objeção (preço, timing, concorrente) → contorne com empatia + prova social
- Se dúvida que ESTÁ na BASE → responda objetivamente + CTA para reunião
- Se dúvida técnica/regulatória que NÃO está na BASE → action = "handoff" (NÃO invente).
- Mensagens curtas e naturais
- NUNCA prometa lembretes, follow-ups ativos ou retornos por iniciativa do SDR ("eu te lembro amanhã", "te aviso mais tarde", "volto a falar em X horas", "te chamo depois", "te procuro depois"). O sistema só responde quando o prospect manda nova mensagem — qualquer promessa de retorno ativo é alucinação. Se o prospect pedir tempo ("posso confirmar mais tarde", "te respondo depois", "deixa eu ver minha agenda"), responda de forma PASSIVA: agradeça, diga que fica no aguardo, e peça que ele avise quando puder. Exemplo: "Sem problema, fico no aguardo. Quando puder, me avisa o melhor horário pra você."

Responda APENAS com JSON:
{
  "action": "reply|schedule|confirm_slot|reject_slots|check_availability|reschedule|cancel|pause|referral|request_call|handoff",
  "sentiment": "interesse|objeção|dúvida|rejeição|neutro",
  "selected_slot": null,
  "suggested_datetime": null,
  "reasoning": "explicação breve",
  "used_facts": ["lista de trechos da BASE DE CONHECIMENTO que embasaram a resposta (vazio se não usou nada da base)"],
  "playbook": "tecnico|compras|marketing|comercial|socio|neutro",
  "handoff_reason": "motivo do handoff (apenas quando action=handoff, senão null)",
  "call_window": "janela preferida pelo prospect (apenas quando action=request_call, senão null)",
  "call_phone": "telefone informado (apenas quando action=request_call, senão null)",
  "referral": {
    "subtype": "with_contact|without_contact|will_forward|wrong_person|gatekeeper|refuses_contact",
    "referred_name": null,
    "referred_role": null,
    "referred_email": null,
    "referred_phone": null,
    "referred_channel": "email|whatsapp (escolha EXATAMENTE UM valor — nunca strings compostas como 'email/whatsapp' ou 'ambos'. Se houver email use 'email', senão 'whatsapp')",
    "permission_to_mention": null,
    "context": null
  },
  "new_outreach_message": "1ª mensagem para o lead indicado (apenas quando referral.subtype = with_contact, senão null)",
  "provided_email": null,
  "email_refused": false,
  "reply_message": "mensagem para enviar ao prospect (obrigatória inclusive em action=pause — agradecimento curto + porta aberta). Após confirmar reunião (confirm_slot), gere mensagem CURTA e CORDIAL (1-2 frases), confirmando data/hora, sem floreios nem promessas — para não atrapalhar o prospect."
}${slotContext}`;


    let parsed: any;
    if (earlyParsed) {
      console.log("Skipping AI classification — earlyParsed set by pending-email fast-path");
      parsed = earlyParsed;
    } else if (earlyClarifyingKind && !earlyInboundDt) {
      // SHORT-CIRCUIT: pergunta esclarecedora sobre a reunião — não chama IA,
      // não roteia para agenda. Responde determinístico e segue para o envio.
      const replyText = clarifyingReplyFor(earlyClarifyingKind, meetingMinutes);
      console.log(`MEETING_CLARIFIER_BYPASS action=reply kind=${earlyClarifyingKind} norm="${normalizePtText(cleanContent)}" reply="${replyText}"`);
      parsed = {
        action: "reply",
        sentiment: "dúvida",
        reasoning: `Pergunta esclarecedora detectada (${earlyClarifyingKind}) — resposta determinística sem IA.`,
        reply_message: replyText,
        selected_slot: null,
        suggested_datetime: null,
      };
    } else {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-5",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `Lead: ${leadData?.name || "N/A"} (${leadData?.company_name || "N/A"})
E-mail cadastrado: ${leadData?.email || "nenhum"}
WhatsApp cadastrado: ${leadData?.whatsapp || leadData?.phone || "nenhum"}

Histórico:
${(messages || []).slice(0, -1).map((m: any) => `[${m.direction === "outbound" ? "SDR" : "PROSPECT"}]: ${m.content}`).join("\n")}

ÚLTIMA MENSAGEM DO PROSPECT (analise com atenção):
"${cleanContent}"

Analise a última mensagem e decida a ação.`,
            },
          ],
        }),
      });

      if (!aiRes.ok) {
        await aiRes.text();
        return new Response(JSON.stringify({ error: "Erro na análise IA" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await aiRes.json();
      const aiContent = aiData.choices?.[0]?.message?.content || "";

      try {
        const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiContent];
        parsed = JSON.parse(jsonMatch[1].trim());
      } catch {
        parsed = { action: "reply", sentiment: "neutro", reasoning: "Fallback", reply_message: null, selected_slot: null };
      }
    }

    // FIX: Compensate AI-provided suggested_datetime from naive BRT to UTC
    if (parsed.suggested_datetime && !parsed.suggested_datetime.endsWith("Z")) {
      const naive = new Date(parsed.suggested_datetime);
      if (!isNaN(naive.getTime())) {
        const utc = new Date(naive.getTime() + BRT_OFFSET_HOURS * 3600000);
        parsed.suggested_datetime = utc.toISOString();
        console.log("Compensated AI suggested_datetime to UTC:", parsed.suggested_datetime);
      }
    }

    // FIX: Guard — if reply contains time patterns, redirect to schedule
    // (skip when earlyParsed: booking já confirmado, mensagem cita data por design)
    if (!earlyParsed && parsed.action === "reply" && parsed.reply_message) {
      const hasTimePattern = /\b(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo)\s+(à|a)s?\s+\d{1,2}/i.test(parsed.reply_message)
        || /📅/.test(parsed.reply_message)
        || /\b\d{1,2}\/\d{1,2}\s+(à|a)s?\s+\d{1,2}/i.test(parsed.reply_message);
      if (hasTimePattern) {
        console.log("Reply contains time suggestions — redirecting to schedule");
        parsed.action = "schedule";
        parsed.reply_message = null;
      }
    }

    // FIX: Detectar perguntas esclarecedoras (duração, formato, local, etc.) ANTES dos guards
    // que redirecionam para schedule/check_availability. Essas perguntas devem virar reply direto.
    const clarifyingKind = earlyClarifyingKind;
    const inboundDt = earlyInboundDt;

    if (!earlyParsed && clarifyingKind && !inboundDt) {
      console.log(`MEETING_CLARIFIER_BYPASS forcing reply kind=${clarifyingKind} norm="${normalizePtText(cleanContent)}"`);
      parsed.action = "reply";
      if (!parsed.reply_message || /📅|hor[aá]rio|qual\s+dia|disponibilidade/i.test(parsed.reply_message)) {
        parsed.reply_message = clarifyingReplyFor(clarifyingKind, meetingMinutes);
      }
      parsed.suggested_datetime = null;
      parsed.selected_slot = null;
    }

    // FIX: Guard on INBOUND content — if prospect has scheduling intent but AI said "reply"
    // (skip when earlyParsed: já tratamos o agendamento)
    if (!earlyParsed && parsed.action === "reply" && !clarifyingKind) {
      const lower = cleanContent.toLowerCase();
      const hasScheduleIntent = /\b(agendar|reunião|reuniao|demo|conversar|call|meeting|bate-?papo)\b/i.test(lower);
      const extractedDt = inboundDt;

      // NON-SCHEDULING intent categories where a mentioned datetime refers to
      // "when to contact me next" / "try later" — NOT to a meeting request.
      // Don't hijack into check_availability for these.
      const NON_SCHEDULING_CATEGORIES = new Set([
        "channel_switch",
        "rejection",
        "routing",
        "compliance",
        "info_request",
      ]);
      const intentIsNonScheduling =
        lastIntentCategory != null && NON_SCHEDULING_CATEGORIES.has(lastIntentCategory);

      // Special branch: lead asked to be contacted at a future time / via a specific channel.
      // Enqueue a scheduled follow-up and respond with a short confirmation — don't offer slots.
      const entityDt = (lastIntentEntities?.datetime as string | undefined) || extractedDt;
      const entityDtMs = entityDt ? Date.parse(entityDt) : NaN;
      const isFutureDt = Number.isFinite(entityDtMs) && entityDtMs > Date.now() + 60_000;
      if (
        lastIntentCategory === "channel_switch" &&
        isFutureDt &&
        leadData?.id &&
        companyId
      ) {
        const targetChannel =
          lastIntentSubIntent === "send_by_email"
            ? "email"
            : lastIntentSubIntent === "send_by_whatsapp"
            ? "whatsapp"
            : lastIntentSubIntent === "send_by_linkedin"
            ? "linkedin"
            : (await (async () => {
                const { data } = await supabase
                  .from("conversations")
                  .select("channel")
                  .eq("id", convId)
                  .maybeSingle();
                return (data?.channel as string) || "email";
              })());
        const scheduledFor = new Date(entityDtMs).toISOString();
        try {
          await supabase.from("lead_action_queue").insert({
            company_id: companyId,
            lead_id: leadData.id,
            conversation_id: convId,
            intent_log_id: lastIntentLogId,
            action_type: "schedule_followup" as any,
            params: {
              source: "lead_request",
              channel: targetChannel,
              original_request: cleanContent.slice(0, 500),
              requested_at: new Date().toISOString(),
            },
            scheduled_for: scheduledFor,
            triggered_by: "inbound-webhook:lead_requested_callback",
          });
          // Pause the cadence so it doesn't fire before the requested time
          await supabase
            .from("cadence_enrollments")
            .update({
              status: "paused",
              paused_reason: "lead_requested_callback",
              next_execution_at: new Date(entityDtMs + 60_000).toISOString(),
            } as any)
            .eq("lead_id", leadData.id)
            .in("status", ["active", "paused"]);
          await supabase.from("lead_activities").insert({
            company_id: companyId,
            lead_id: leadData.id,
            type: "note",
            description: `⏰ Lead pediu contato em ${new Date(entityDtMs).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} via ${targetChannel}`,
            metadata: { source: "inbound-webhook", scheduled_for: scheduledFor, channel: targetChannel },
          });
          console.log(
            `Lead requested callback: scheduled ${targetChannel} follow-up for ${scheduledFor}`,
          );
        } catch (e) {
          console.error("failed to enqueue lead_requested_callback:", e);
        }
        const leadFirst = (leadData?.name as string | undefined)?.split(" ")[0] || "";
        const whenLabel = new Date(entityDtMs).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "2-digit",
        });
        const channelLabel =
          targetChannel === "email" ? "e-mail" : targetChannel === "whatsapp" ? "WhatsApp" : targetChannel;
        parsed.action = "reply";
        parsed.suggested_datetime = null;
        parsed.selected_slot = null;
        parsed.reply_message =
          `Combinado${leadFirst ? `, ${leadFirst}` : ""} — te chamo por ${channelLabel} em ${whenLabel}. Até já 👋`;
      } else if (hasScheduleIntent && extractedDt) {
        console.log("Inbound has scheduling intent + datetime — redirecting to check_availability");
        parsed.action = "check_availability";
        parsed.suggested_datetime = extractedDt;
        parsed.reply_message = null;
      } else if (hasScheduleIntent) {
        console.log("Inbound has scheduling intent without specific time — redirecting to schedule");
        parsed.action = "schedule";
        parsed.reply_message = null;
      } else if (extractedDt && !intentIsNonScheduling) {
        console.log("Inbound mentions datetime without keyword — redirecting to check_availability");
        parsed.action = "check_availability";
        parsed.suggested_datetime = extractedDt;
        parsed.reply_message = null;
      } else if (extractedDt && intentIsNonScheduling) {
        console.log(
          `Skipping datetime→check_availability redirect: intent=${lastIntentCategory}/${lastIntentSubIntent} (datetime refers to next contact, not meeting)`,
        );
      }
    }


    // FIX: If AI says "schedule" but scheduling is already in progress, redirect to check_availability
    if (!clarifyingKind && parsed.action === "schedule" && schedulingInProgress) {
      console.log("Schedule requested but scheduling already in progress — redirecting to check_availability");
      parsed.action = "check_availability";
      // Try to extract datetime from original message
      if (!parsed.suggested_datetime) {
        parsed.suggested_datetime = extractDateTimeFromText(cleanContent);
        console.log("Extracted datetime from text:", parsed.suggested_datetime);
      }
    }

    // FIX: Acknowledgment guard — quando já existe reunião confirmada e o AI ainda assim
    // tentou rotear para uma ação de agendamento sem que o lead tenha pedido remarcar/cancelar,
    // forçamos um reply curto e amigável em vez de cair em fallbacks que oferecem horários.
    if (
      confirmedSlotForPrompt &&
      ["check_availability", "schedule", "suggest_meeting_times"].includes(parsed.action)
    ) {
      const reschedKeywords = /\b(remarcar|reagendar|remarca|reagenda|mudar|trocar|cancelar|cancela|nao\s+vou\s+poder|não\s+vou\s+poder|outro\s+hor[aá]rio|nova\s+data|antecipar|adiar)\b/i;
      const ackPatterns = /\b(obrigad[oa]|valeu|ok|okay|perfeito|combinado|at[eé]\s+l[aá]|show|beleza|legal|tranquilo|fechou|👍|🙏|😊)\b/i;
      if (!reschedKeywords.test(cleanContent)) {
        const isAck = ackPatterns.test(cleanContent) || cleanContent.trim().length <= 25;
        console.log(
          `Acknowledgment guard: booking already confirmed and no reschedule/cancel intent — overriding action=${parsed.action} → reply (isAck=${isAck})`,
        );
        parsed.action = "reply";
        if (!parsed.reply_message || /📅|hor[aá]rio|dispon|agend/i.test(parsed.reply_message)) {
          parsed.reply_message = isAck ? "Combinado! Até lá 👋" : "Combinado! Qualquer coisa antes da reunião é só me chamar por aqui.";
        }
        parsed.suggested_datetime = null;
      }
    }


    if (!clarifyingKind && parsed.action === "check_availability" && !parsed.suggested_datetime) {
      const extracted = extractDateTimeFromText(content);
      if (extracted) {
        console.log("AI didn't provide suggested_datetime, extracted from text:", extracted);
        parsed.suggested_datetime = extracted;
      } else {
        console.log("check_availability but no datetime could be extracted — falling back to reply asking for specific time");
        parsed.action = "reply";
        parsed.reply_message = "Poderia me dizer o dia e horário exato de sua preferência? Assim consigo verificar a disponibilidade.";
      }
    }

    // Safety-net: if AI asked for "melhor e-mail" but lead already has one cadastrado,
    // rewrite as a confirmation instead of asking again.
    if (
      parsed.action === "reply" &&
      typeof parsed.reply_message === "string" &&
      leadData?.email &&
      /(qual|me\s+pass|me\s+envia|melhor|seu)\s+(o|seu)?\s*e-?mail/i.test(parsed.reply_message)
    ) {
      const first = (leadData.name as string | undefined)?.split(" ")[0] || "";
      console.log(`Rewriting reply — AI asked for email but lead already has ${leadData.email}`);
      parsed.reply_message = `Combinado${first ? `, ${first}` : ""}! Posso te enviar para ${leadData.email}?`;
    }


    // Fallback: if AI says confirm_slot but no held slots exist, reclassify as reply
    if (parsed.action === "confirm_slot" && heldSlots.length < 2) {
      console.log("confirm_slot requested but no held slots found — falling back to check_availability or reply");
      // If scheduling is in progress and there's a datetime, try check_availability
      if (schedulingInProgress) {
        parsed.action = "check_availability";
        if (!parsed.suggested_datetime) {
          parsed.suggested_datetime = extractDateTimeFromText(content);
        }
        if (!parsed.suggested_datetime) {
          parsed.action = "reply";
          parsed.reply_message = "Os horários anteriores expiraram. Poderia me dizer sua disponibilidade para que eu verifique novos horários?";
        }
      } else {
        parsed.action = "reply";
        if (!parsed.reply_message) {
          parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
        }
      }
    }

    // Fallback: if AI says reject_slots but no held slots
    if (parsed.action === "reject_slots" && heldSlots.length === 0) {
      if (schedulingInProgress) {
        // Treat as wanting new slots
        console.log("reject_slots with no active slots but scheduling in progress — fetching new slots");
      } else {
        console.log(`reject_slots requested but no held slots found — falling back to reply`);
        parsed.action = "reply";
        if (!parsed.reply_message) {
          parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
        }
      }
    }

    // FIX (Kiko): deterministic confirm_slot when prospect identifies exactly one held slot
    // (e.g. "pode ser dia 11", "às 18:45", "segunda"). If AI returned `reply` but the
    // message unambiguously matches one held slot, force confirm_slot so the booking is created.
    if (parsed.action === "reply" && heldSlots.length >= 1) {
      const lc = cleanContent.toLowerCase();
      const WEEKDAYS = ["domingo", "segunda", "terça", "terca", "quarta", "quinta", "sexta", "sábado", "sabado"];
      const WEEKDAY_TO_NUM: Record<string, number> = {
        domingo: 0, segunda: 1, terça: 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, sábado: 6, sabado: 6,
      };
      const slotParts = heldSlots.map((s: any) => {
        const d = new Date(s.slot_datetime);
        // Extract BRT day/month/hour/min/weekday via Intl
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long",
        }).formatToParts(d);
        const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
        return {
          day: parseInt(get("day")),
          month: parseInt(get("month")),
          hour: parseInt(get("hour")),
          minute: parseInt(get("minute")),
          weekday: get("weekday").toLowerCase(),
        };
      });

      const matches = new Set<number>();
      // "dia DD" / "DD/MM" / "DD de mes"
      const dayMatch = lc.match(/\bdia\s+(\d{1,2})\b/) || lc.match(/\b(\d{1,2})\/(\d{1,2})\b/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1]);
        const month = dayMatch[2] ? parseInt(dayMatch[2]) : null;
        slotParts.forEach((p, i) => {
          if (p.day === day && (month === null || p.month === month)) matches.add(i);
        });
      }
      // "HH:MM" / "HHhMM" / "HHh"
      const timeMatch = lc.match(/\b(\d{1,2})[:h](\d{2})\b/) || lc.match(/\b(\d{1,2})h\b/);
      if (timeMatch) {
        const hour = parseInt(timeMatch[1]);
        const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        const timeMatches = new Set<number>();
        slotParts.forEach((p, i) => {
          if (p.hour === hour && p.minute === minute) timeMatches.add(i);
        });
        if (matches.size === 0) timeMatches.forEach((i) => matches.add(i));
        else for (const i of [...matches]) if (!timeMatches.has(i)) matches.delete(i);
      }
      // Weekday
      if (matches.size === 0) {
        for (const wd of WEEKDAYS) {
          if (new RegExp(`\\b${wd}\\b`).test(lc)) {
            const target = WEEKDAY_TO_NUM[wd];
            const wdEnPt: Record<string, number> = {
              sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
            };
            slotParts.forEach((p, i) => {
              if (wdEnPt[p.weekday] === target) matches.add(i);
            });
            break;
          }
        }
      }

      if (matches.size === 1) {
        const idx = [...matches][0];
        console.log(`Deterministic confirm_slot match: slot ${idx + 1} from "${cleanContent.substring(0, 80)}"`);
        parsed.action = "confirm_slot";
        parsed.selected_slot = idx + 1;
        parsed.reply_message = null;
      }
    }



    // Ensure reply_message is never null for action=reply
    if (parsed.action === "reply" && !parsed.reply_message) {
      parsed.reply_message = "Obrigado pela sua mensagem! Como posso ajudá-lo?";
    }

    // Guard: prevent double-booking — if lead already has a confirmed slot, handle scheduling actions carefully
    if (leadData?.id && ["schedule", "check_availability", "confirm_slot"].includes(parsed.action)) {
      const confirmedSlots = confirmedSlotForPrompt ? [confirmedSlotForPrompt] : [];

      if (confirmedSlots.length) {
        // If the prospect proposed a new datetime, treat as reschedule instead of bouncing
        if (parsed.action === "check_availability" && parsed.suggested_datetime) {
          console.log(`Guard: converting check_availability → reschedule (existing booking + suggested_datetime=${parsed.suggested_datetime})`);
          parsed.action = "reschedule";
        } else {
          const formatted = formatDateTimeBrt(confirmedSlots[0].slot_datetime);
          console.log(`Double-booking guard: lead already has confirmed slot at ${confirmedSlots[0].slot_datetime}`);
          parsed.action = "reply";
          parsed.reply_message = `Já temos uma reunião confirmada para ${formatted}! Caso precise reagendar, é só me avisar.`;
        }
      }
    }


    // FINAL GUARD: se a mensagem do lead é pergunta esclarecedora (sem data/hora) e algum
    // guard posterior empurrou para uma ação de agenda, sobrescreve de volta para reply.
    if (!earlyParsed && earlyClarifyingKind && !earlyInboundDt &&
        ["schedule", "check_availability", "reject_slots", "confirm_slot", "reschedule", "suggest_meeting_times"].includes(parsed.action)) {
      console.log(`MEETING_CLARIFIER_BYPASS final override action=${parsed.action} kind=${earlyClarifyingKind}`);
      parsed.action = "reply";
      parsed.reply_message = clarifyingReplyFor(earlyClarifyingKind, meetingMinutes);
      parsed.suggested_datetime = null;
      parsed.selected_slot = null;
    }

    // Soft-cancel promotion: if lead said "desmarcar/cancelar" without explicit loss
    // of interest, treat as reschedule so the SDR keeps initiative and offers new slots.
    if (parsed.action === "cancel") {
      const HARD_CANCEL_REGEX = /\b(nao\s+(quero|tenho|vou)\s+mais|sem\s+interesse|perdi\s+(o\s+)?interesse|cancela(r)?\s+de\s+vez|nao\s+rola|desisto|nao\s+precisa\s+mais|nao\s+vou\s+fazer|nao\s+tenho\s+mais\s+interesse)\b/i;
      const normalized = normalizePtText(cleanContent);
      if (!HARD_CANCEL_REGEX.test(normalized)) {
        console.log(`CANCEL_PROMOTED_TO_RESCHEDULE lead=${leadData?.id} norm="${normalized}"`);
        parsed.action = "reschedule";
        parsed.reply_message = null;
      }
    }

    // Execute action based on AI decision
    if (parsed.action === "confirm_slot" && heldSlots.length >= 1) {
      const slotIndex = (parsed.selected_slot || 1) - 1;
      const selectedHold = heldSlots[Math.min(slotIndex, heldSlots.length - 1)];

      // If lead provided an email in this message, persist it before confirming
      const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
      const providedEmail: string | null =
        (typeof parsed.provided_email === "string" && emailRegex.test(parsed.provided_email))
          ? parsed.provided_email.trim()
          : (emailRegex.exec(cleanContent)?.[0] || null);

      if (providedEmail && providedEmail.toLowerCase() !== (leadData?.email || "").toLowerCase()) {
        await supabase.from("leads").update({ email: providedEmail }).eq("id", leadData.id);
        leadData.email = providedEmail;
        console.log(`Lead email captured/updated from conversation: ${providedEmail}`);
      }


      const emailRefused = !!parsed.email_refused;

      // If still no email AND lead didn't refuse → ask for email instead of confirming
      if (!leadData?.email && !emailRefused) {
        console.log("No email available — asking lead before confirming booking");
        await supabase
          .from("leads")
          .update({ pending_email_slot_hold_id: selectedHold.id })
          .eq("id", leadData.id);
        parsed.action = "reply";
        parsed.reply_message =
          "Perfeito! Para eu te enviar o convite com o link da reunião, qual o seu melhor e-mail?";
      } else {
        console.log(`Confirming slot ${parsed.selected_slot}: ${selectedHold.slot_datetime} (placeholder=${!leadData?.email})`);
        try {
          const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
            body: {
              lead_id: leadData.id,
              selected_slot_hold_id: selectedHold.id,
              force_placeholder: !leadData?.email && emailRefused,
            },
          });

          if (confirmRes.data?.success) {
            console.log("Booking confirmed successfully");
            const formattedDate = formatDateTimeBrt(selectedHold.slot_datetime);
            if (!parsed.reply_message) {
              parsed.reply_message = `Combinado! Reunião marcada para ${formattedDate}. Até lá!`;
            }
          } else {
            console.error("Failed to confirm booking:", confirmRes.data?.error);
            parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
          }
        } catch (e) {
          console.error("Error invoking calcom-confirm-booking:", e);
          parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
        }
      }
    } else if (parsed.action === "reject_slots") {
      // Cancel all held slots and offer new ones
      console.log(`Rejecting ${heldSlots.length} held slots for lead ${leadData?.id}`);

      for (const slot of heldSlots) {
        if (slot.cal_booking_uid) {
          await cancelCalcomReservation(slot.cal_booking_uid);
        }
        await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", slot.id);
      }

      // Collect previously offered datetimes to exclude from new selection
      const excludeDatetimes = [
        ...heldSlots.map((s: any) => s.slot_datetime),
        ...lastOfferedSlots,
      ];
      // Day-level exclusion: when the lead rejects slots, assume they want
      // DIFFERENT DAYS, not just different times on the same day.
      const toSptDate = (iso: string): string | null => {
        try {
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Sao_Paulo",
            year: "numeric", month: "2-digit", day: "2-digit",
          }).formatToParts(new Date(iso));
          const y = parts.find((p) => p.type === "year")?.value;
          const m = parts.find((p) => p.type === "month")?.value;
          const d = parts.find((p) => p.type === "day")?.value;
          return y && m && d ? `${y}-${m}-${d}` : null;
        } catch { return null; }
      };
      const excludeDates = Array.from(new Set(
        excludeDatetimes.map(toSptDate).filter((x): x is string => !!x)
      ));
      console.log("Excluding previously offered datetimes:", excludeDatetimes);
      console.log("Excluding previously offered dates (day-level):", excludeDates);

      // Fetch 2 new slots (excluding rejected ones)
      try {
        const channelLabel = convChannel || channel || "email";
        const rangeHint = extractDateRangeFromText(cleanContent);
        const slotsBody: any = {
          company_id: companyId,
          lead_id: leadData?.id,
          enrollment_id: enrollment?.id,
          conversation_id: convId,
          preferred_channel: channelLabel,
          exclude_datetimes: excludeDatetimes,
          exclude_dates: excludeDates,
        };
        if (rangeHint?.start_after) slotsBody.start_after = rangeHint.start_after;
        if (rangeHint?.end_before) slotsBody.end_before = rangeHint.end_before;
        const slotsRes = await supabase.functions.invoke("calcom-slots", { body: slotsBody });

        if (slotsRes.data?.success && slotsRes.data?.formatted?.length >= 2) {
          // FIX: Update heldSlots to reflect the NEW slots (for metadata)
          if (slotsRes.data?.slots) {
            heldSlots = slotsRes.data.slots;
          }
          parsed.reply_message = `Sem problemas! Aqui vão outras opções:\n\n📅 ${slotsRes.data.formatted[0]}\n📅 ${slotsRes.data.formatted[1]}\n\nAlgum desses funciona para você?`;
        } else {
          const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
          parsed.reply_message = CALCOM_BOOKING_LINK
            ? `Entendo! Acesse ${CALCOM_BOOKING_LINK} para escolher o horário que melhor funciona para você.`
            : "Entendo! Me diga qual horário seria melhor para você que eu verifico a disponibilidade.";
        }
      } catch (e) {
        console.error("Error fetching new slots:", e);
        parsed.reply_message = "Entendo! Me diga qual horário seria melhor para você que eu verifico a disponibilidade.";
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "🔄 Prospect rejeitou horários, novos slots oferecidos",
          metadata: { action: "reject_slots", sentiment: parsed.sentiment },
        });
      }
    } else if (parsed.action === "reschedule") {
      // Reschedule: cancel existing booking + held slots, then offer new ones
      console.log(`Reschedule requested for lead ${leadData?.id}`);

      // GUARD: se existe um booking recém-confirmado (< 90s) para este lead,
      // NÃO cancelar nada — provavelmente é uma execução duplicada/concorrente
      // do mesmo inbound. Responder confirmando e abortar o reschedule.
      try {
        const { data: recentBooking } = await supabase
          .from("bookings")
          .select("id, calcom_booking_uid, scheduled_at, status, created_at")
          .eq("lead_id", leadData.id)
          .neq("status", "cancelled")
          .gte("created_at", new Date(Date.now() - 90_000).toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (recentBooking) {
          const formatted = formatDateTimeBrt(recentBooking.scheduled_at);
          console.log(`RESCHEDULE_SKIPPED_RECENT_BOOKING lead=${leadData.id} booking=${recentBooking.calcom_booking_uid} created_at=${recentBooking.created_at}`);
          parsed.reply_message = parsed.reply_message
            || `Sua reunião está confirmada para ${formatted}. Quer trocar para outro horário?`;
          // Pula todo o processamento do branch reschedule.
          parsed.action = "reply";
        }
      } catch (e) {
        console.error("recent-booking guard failed (continuing reschedule):", e);
      }
    }

    if (parsed.action === "reschedule") {

      // 1) Cancel any held or confirmed slots in slot_holds
      const { data: liveSlots } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime, cal_booking_uid, status")
        .eq("lead_id", leadData.id)
        .in("status", ["held", "confirmed"]);

      let cancelledBookingUid: string | null = null;
      let cancelledScheduledAt: string | null = null;
      let calcomCancelFailed = false;
      for (const slot of (liveSlots || [])) {
        if (slot.cal_booking_uid) {
          const r = slot.status === "confirmed"
            ? await cancelCalcomBooking(slot.cal_booking_uid, "Remarcação solicitada pelo prospect")
            : await cancelCalcomReservation(slot.cal_booking_uid);
          if (!r.ok) calcomCancelFailed = true;
          if (slot.status === "confirmed") {
            cancelledBookingUid = slot.cal_booking_uid;
            cancelledScheduledAt = slot.slot_datetime;
          }
        }
        await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", slot.id);
      }

      // 2) Update bookings row immediately so UI reflects the change (don't wait for webhook)
      const { data: activeBookings } = await supabase
        .from("bookings")
        .select("id, calcom_booking_uid, scheduled_at, status")
        .eq("lead_id", leadData.id)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false });
      for (const b of (activeBookings || [])) {
        if (b.calcom_booking_uid && b.calcom_booking_uid !== cancelledBookingUid) {
          const r = await cancelCalcomBooking(b.calcom_booking_uid, "Remarcação solicitada pelo prospect");
          if (!r.ok) calcomCancelFailed = true;
        }
        await supabase.from("bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", b.id);
        cancelledBookingUid = cancelledBookingUid || b.calcom_booking_uid;
        cancelledScheduledAt = cancelledScheduledAt || b.scheduled_at;
      }

      if (calcomCancelFailed && companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "alert",
          description: "⚠️ Cancelamento de booking no Cal.com falhou durante remarcação — verifique manualmente",
          metadata: { stage: "reschedule" },
        });
      }

      // 3) System message in the conversation — only when a CONFIRMED booking was actually cancelled.
      // Prospects that simply suggest a new time without a prior confirmed booking shouldn't trigger
      // a "Reunião remarcada" system entry.
      if (companyId && leadData && (cancelledBookingUid || cancelledScheduledAt)) {
        await insertBookingSystemMessage(supabase, {
          lead_id: leadData.id,
          company_id: companyId,
          event_type: "booking_rescheduled",
          booking_uid: cancelledBookingUid,
          previous_scheduled_at: cancelledScheduledAt,
        });
      }

      // 4) Reset enrollment
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ meeting_scheduled: false, status: "paused", paused_reason: "awaiting_slot_confirmation" } as any)
          .eq("id", enrollment.id);
      } else if (enrollmentId) {
        await supabase
          .from("cadence_enrollments")
          .update({ meeting_scheduled: false, status: "paused", paused_reason: "awaiting_slot_confirmation" } as any)
          .eq("id", enrollmentId);
      }

      // 5) Fetch new slots — honour any date hint from the lead's message
      try {
        const channelLabel = convChannel || channel || "email";
        const rangeHint = extractDateRangeFromText(cleanContent);
        const slotsBody: any = {
          company_id: companyId,
          lead_id: leadData?.id,
          enrollment_id: enrollment?.id || enrollmentId,
          conversation_id: convId,
          preferred_channel: channelLabel,
        };
        if (parsed.suggested_datetime) slotsBody.check_datetime = parsed.suggested_datetime;
        if (rangeHint?.start_after) slotsBody.start_after = rangeHint.start_after;
        if (rangeHint?.end_before) slotsBody.end_before = rangeHint.end_before;

        const slotsRes = await supabase.functions.invoke("calcom-slots", { body: slotsBody });

        if (slotsRes.data?.available && slotsRes.data?.slots?.[0]?.id) {
          // Suggested time is available — confirm immediately
          const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
            body: { lead_id: leadData.id, selected_slot_hold_id: slotsRes.data.slots[0].id },
          });
          if (confirmRes.data?.success) {
            const formattedDate = formatDateTimeBrt(parsed.suggested_datetime);
            parsed.reply_message = `Sem problemas! Reunião reagendada para ${formattedDate}. Você receberá um novo convite por e-mail. Até lá! 🚀`;
          } else {
            parsed.reply_message = "Vou verificar a disponibilidade e retorno em seguida!";
          }
        } else if (slotsRes.data?.formatted?.length >= 2) {
          if (slotsRes.data?.slots) heldSlots = slotsRes.data.slots;
          const prefix = parsed.suggested_datetime
            ? "Infelizmente esse horário não está disponível. Que tal uma dessas opções?"
            : "Sem problemas! Aqui vão novas opções:";
          parsed.reply_message = `${prefix}\n\n📅 ${slotsRes.data.formatted[0]}\n📅 ${slotsRes.data.formatted[1]}\n\nQual funciona melhor?`;
        } else if (slotsRes.data?.formatted?.length === 1) {
          if (slotsRes.data?.slots) heldSlots = slotsRes.data.slots;
          parsed.reply_message = `Sem problemas! Consegui este horário:\n\n📅 ${slotsRes.data.formatted[0]}\n\nFunciona para você?`;
        } else {
          const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
          parsed.reply_message = CALCOM_BOOKING_LINK
            ? `Sem problemas! Acesse ${CALCOM_BOOKING_LINK} para escolher o melhor horário.`
            : "Sem problemas! Me diga qual horário seria ideal para você.";
        }
      } catch (e) {
        console.error("Error fetching slots for reschedule:", e);
        parsed.reply_message = "Sem problemas! Me diga qual horário seria ideal para remarcar.";
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "🔄 Reunião reagendada a pedido do prospect",
          metadata: { action: "reschedule", suggested: parsed.suggested_datetime },
        });
      }
    } else if (parsed.action === "cancel") {
      // Hard cancel: drop existing booking + held slots, no new offer
      console.log(`Cancel requested for lead ${leadData?.id}`);

      const { data: liveSlots } = await supabase
        .from("slot_holds")
        .select("id, slot_datetime, cal_booking_uid, status")
        .eq("lead_id", leadData.id)
        .in("status", ["held", "confirmed"]);

      let cancelledBookingUid: string | null = null;
      let cancelledScheduledAt: string | null = null;
      let calcomCancelFailed = false;
      for (const slot of (liveSlots || [])) {
        if (slot.cal_booking_uid) {
          const r = slot.status === "confirmed"
            ? await cancelCalcomBooking(slot.cal_booking_uid, "Cancelado pelo prospect via conversa")
            : await cancelCalcomReservation(slot.cal_booking_uid);
          if (!r.ok) calcomCancelFailed = true;
          if (slot.status === "confirmed") {
            cancelledBookingUid = slot.cal_booking_uid;
            cancelledScheduledAt = slot.slot_datetime;
          }
        }
        await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", slot.id);
      }

      const { data: activeBookings } = await supabase
        .from("bookings")
        .select("id, calcom_booking_uid, scheduled_at, status")
        .eq("lead_id", leadData.id)
        .neq("status", "cancelled");
      for (const b of (activeBookings || [])) {
        if (b.calcom_booking_uid && b.calcom_booking_uid !== cancelledBookingUid) {
          const r = await cancelCalcomBooking(b.calcom_booking_uid, "Cancelado pelo prospect via conversa");
          if (!r.ok) calcomCancelFailed = true;
        }
        await supabase.from("bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", b.id);
        cancelledBookingUid = cancelledBookingUid || b.calcom_booking_uid;
        cancelledScheduledAt = cancelledScheduledAt || b.scheduled_at;
      }

      if (companyId && leadData) {
        await insertBookingSystemMessage(supabase, {
          lead_id: leadData.id,
          company_id: companyId,
          event_type: "booking_cancelled",
          booking_uid: cancelledBookingUid,
          scheduled_at: cancelledScheduledAt,
        });
        if (calcomCancelFailed) {
          await supabase.from("lead_activities").insert({
            company_id: companyId,
            lead_id: leadData.id,
            type: "alert",
            description: "⚠️ Cancelamento no Cal.com falhou — verifique o painel e cancele manualmente",
            metadata: { stage: "cancel", booking_uid: cancelledBookingUid },
          });
        }
      }

      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ meeting_scheduled: false, status: "cancelled", paused_reason: "meeting_cancelled_by_lead" } as any)
          .eq("id", enrollment.id);
      }

      if (!parsed.reply_message) {
        parsed.reply_message = "Sem problemas, cancelei nossa reunião! Se mudar de ideia ou quiser reagendar, é só me chamar por aqui. 👋";
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "❌ Reunião cancelada a pedido do prospect",
          metadata: { action: "cancel", source_message: cleanContent.substring(0, 200) },
        });
      }
    } else if (parsed.action === "check_availability" && parsed.suggested_datetime) {
      // Check if the prospect's suggested time is available
      console.log(`Checking availability for suggested time: ${parsed.suggested_datetime}`);

      // Cancel existing holds first
      for (const slot of heldSlots) {
        if (slot.cal_booking_uid) {
          await cancelCalcomReservation(slot.cal_booking_uid);
        }
        await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", slot.id);
      }

      try {
        const channelLabel = convChannel || channel || "email";

        // Anchor alternatives to the lead's preferred window: start at 00:00 BRT
        // of the suggested day, end 7 days later at 23:59 BRT. A more specific
        // range hint extracted from the text takes priority.
        let anchorStart: string | undefined;
        let anchorEnd: string | undefined;
        try {
          const suggested = new Date(parsed.suggested_datetime);
          if (!isNaN(suggested.getTime())) {
            // BRT = UTC-3 (no DST in Brazil). Compute day start/end in BRT.
            const BRT_OFFSET_MS = 3 * 3600000;
            const brtMs = suggested.getTime() - BRT_OFFSET_MS;
            const dayStartBrt = Math.floor(brtMs / 86400000) * 86400000;
            anchorStart = new Date(dayStartBrt + BRT_OFFSET_MS).toISOString();
            anchorEnd = new Date(dayStartBrt + 7 * 86400000 + BRT_OFFSET_MS - 60000).toISOString();
          }
        } catch (_) { /* ignore */ }
        const rangeHint = extractDateRangeFromText(cleanContent);
        if (rangeHint?.start_after) anchorStart = rangeHint.start_after;
        if (rangeHint?.end_before) anchorEnd = rangeHint.end_before;

        const slotsBody: any = {
          company_id: companyId,
          lead_id: leadData?.id,
          enrollment_id: enrollment?.id,
          conversation_id: convId,
          preferred_channel: channelLabel,
          check_datetime: parsed.suggested_datetime,
          exclude_datetimes: [
            ...heldSlots.map((s: any) => s.slot_datetime),
            ...lastOfferedSlots,
          ],
        };
        if (anchorStart) slotsBody.start_after = anchorStart;
        if (anchorEnd) slotsBody.end_before = anchorEnd;

        const slotsRes = await supabase.functions.invoke("calcom-slots", { body: slotsBody });

        if (slotsRes.data?.available) {
          // Slot is available — confirm booking directly
          const holdId = slotsRes.data?.slots?.[0]?.id;
          if (holdId) {
            const confirmRes = await supabase.functions.invoke("calcom-confirm-booking", {
              body: { lead_id: leadData.id, selected_slot_hold_id: holdId },
            });

            if (confirmRes.data?.success) {
              const formattedDate = formatDateTimeBrt(parsed.suggested_datetime);
              parsed.reply_message = `Perfeito, temos disponibilidade! Reunião confirmada para ${formattedDate}. Você receberá o convite por e-mail. Até lá! 🚀`;
            } else {
              parsed.reply_message = parsed.reply_message || "Vou verificar a disponibilidade e retorno em seguida!";
            }
          }
        } else {
          // Not available — offer alternatives anchored to lead's preferred window
          const formatted = slotsRes.data?.formatted || [];
          if (formatted.length >= 2) {
            parsed.reply_message = `Infelizmente esse horário não está disponível. Que tal uma dessas opções?\n\n📅 ${formatted[0]}\n📅 ${formatted[1]}\n\nQual funciona melhor?`;
          } else if (formatted.length === 1) {
            parsed.reply_message = `Infelizmente esse horário exato não está disponível. Tenho ${formatted[0]} — funciona para você?`;
          } else {
            const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
            parsed.reply_message = CALCOM_BOOKING_LINK
              ? `Infelizmente esse horário não está disponível. Acesse ${CALCOM_BOOKING_LINK} para ver todas as opções.`
              : "Infelizmente esse horário não está disponível. Pode sugerir outro?";
          }
        }
      } catch (e) {
        console.error("Error checking availability:", e);
        parsed.reply_message = "Vou verificar a disponibilidade e retorno em seguida!";
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: `🔍 Verificação de disponibilidade: ${parsed.suggested_datetime}`,
          metadata: { action: "check_availability", suggested: parsed.suggested_datetime },
        });
      }
    } else if (parsed.action === "schedule") {
      // Block schedule if meeting already scheduled
      if (enrollment) {
        const { data: enrollCheck } = await supabase
          .from("cadence_enrollments")
          .select("meeting_scheduled")
          .eq("id", enrollment.id)
          .maybeSingle();

        if (enrollCheck?.meeting_scheduled) {
          console.log("Meeting already scheduled — skipping schedule action");
          parsed.action = "reply";
          if (!parsed.reply_message) {
            parsed.reply_message = "Já temos uma reunião agendada! Caso precise reagendar, é só me avisar.";
          }
        }
      }

      // Only proceed with scheduling if action wasn't overridden
      if (parsed.action === "schedule") {
        try {
          // FIX (Kiko): cancel any leftover holds before requesting new slots,
          // so retomadas/agendamentos repetidos não acumulam reservas no Cal.com.
          if (leadData?.id) {
            const { data: leftoverHolds } = await supabase
              .from("slot_holds")
              .select("id, cal_booking_uid")
              .eq("lead_id", leadData.id)
              .eq("status", "held");
            for (const h of (leftoverHolds || [])) {
              if (h.cal_booking_uid) {
                try { await cancelCalcomReservation(h.cal_booking_uid); } catch (_) { /* ignore */ }
              }
              await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", h.id);
            }
          }
          const channelLabel = convChannel || channel || "email";
          const rangeHint = extractDateRangeFromText(cleanContent);
          const slotsBody: any = {
            company_id: companyId,
            lead_id: leadData?.id,
            enrollment_id: enrollment?.id,
            conversation_id: convId,
            preferred_channel: channelLabel,
          };
          if (rangeHint?.start_after) slotsBody.start_after = rangeHint.start_after;
          if (rangeHint?.end_before) slotsBody.end_before = rangeHint.end_before;
          const slotsRes = await supabase.functions.invoke("calcom-slots", { body: slotsBody });

          const slotCount = slotsRes.data?.formatted?.length || 0;
          // FIX: Capture offered slot datetimes for metadata
          if (slotsRes.data?.slots) {
            heldSlots = slotsRes.data.slots;
          }
          if (slotsRes.data?.success && slotCount >= 2) {
            parsed.reply_message = `Ótimo! Tenho 2 horários disponíveis para conversarmos:\n\n📅 ${slotsRes.data.formatted[0]}\n📅 ${slotsRes.data.formatted[1]}\n\nQual funciona melhor para você?`;
          } else if (slotsRes.data?.success && slotCount === 1) {
            parsed.reply_message = `Ótimo! Consegui o seguinte horário disponível:\n\n📅 ${slotsRes.data.formatted[0]}\n\nFunciona para você? Se não, me diga sua preferência que verifico outras opções.`;
          } else {
            const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
            parsed.reply_message = CALCOM_BOOKING_LINK
              ? `Ótimo! Acesse ${CALCOM_BOOKING_LINK} para escolher o melhor horário para nossa conversa.`
              : "Ótimo! Me diga sua disponibilidade para a reunião que eu verifico os horários.";
          }
        } catch (slotErr) {
          console.error("Error fetching Cal.com slots:", slotErr);
          const CALCOM_BOOKING_LINK = Deno.env.get("CALCOM_BOOKING_LINK") || "";
          parsed.reply_message = CALCOM_BOOKING_LINK
            ? `Ótimo! Acesse ${CALCOM_BOOKING_LINK} para escolher o melhor horário para nossa conversa.`
            : "Ótimo! Me diga sua disponibilidade para a reunião que eu verifico os horários.";
        }

        // FIX: Only pause enrollment inside the schedule block (not when action was overridden)
        if (enrollment) {
          await supabase
            .from("cadence_enrollments")
            .update({ status: "paused", paused_reason: "awaiting_slot_confirmation" } as any)
            .eq("id", enrollment.id);
        }
      }

      if (companyId && leadData) {
        await supabase.from("lead_activities").insert({
          company_id: companyId,
          lead_id: leadData.id,
          type: "meeting",
          description: "📅 Slots oferecidos ao prospect para agendamento",
          metadata: { auto_scheduled: true, sentiment: parsed.sentiment },
        });
      }
    } else if (parsed.action === "pause") {
      // FIX (Kiko): cancel any pending slot holds when lead rejects approach
      let cancelledBookingUid: string | null = null;
      let cancelledScheduledAt: string | null = null;
      let calcomCancelFailed = false;
      if (leadData?.id) {
        const { data: pendingHolds } = await supabase
          .from("slot_holds")
          .select("id, cal_booking_uid, status, slot_datetime")
          .eq("lead_id", leadData.id)
          .in("status", ["held", "confirmed"]);
        for (const h of (pendingHolds || [])) {
          if (h.cal_booking_uid) {
            try {
              const r = h.status === "confirmed"
                ? await cancelCalcomBooking(h.cal_booking_uid, "Lead perdeu interesse")
                : await cancelCalcomReservation(h.cal_booking_uid);
              if (!r.ok) calcomCancelFailed = true;
              if (h.status === "confirmed") {
                cancelledBookingUid = h.cal_booking_uid;
                cancelledScheduledAt = h.slot_datetime;
              }
            } catch (_) { calcomCancelFailed = true; }
          }
          await supabase.from("slot_holds").update({ status: "cancelled" }).eq("id", h.id);
        }

        // Also cancel any active confirmed bookings in the bookings table
        const { data: activeBookings } = await supabase
          .from("bookings")
          .select("id, calcom_booking_uid, scheduled_at, status")
          .eq("lead_id", leadData.id)
          .neq("status", "cancelled");
        for (const b of (activeBookings || [])) {
          if (b.calcom_booking_uid && b.calcom_booking_uid !== cancelledBookingUid) {
            const r = await cancelCalcomBooking(b.calcom_booking_uid, "Lead perdeu interesse");
            if (!r.ok) calcomCancelFailed = true;
          }
          await supabase.from("bookings").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", b.id);
          cancelledBookingUid = cancelledBookingUid || b.calcom_booking_uid;
          cancelledScheduledAt = cancelledScheduledAt || b.scheduled_at;
        }

        if (cancelledBookingUid && companyId) {
          await insertBookingSystemMessage(supabase, {
            lead_id: leadData.id,
            company_id: companyId,
            event_type: "booking_cancelled",
            booking_uid: cancelledBookingUid,
            scheduled_at: cancelledScheduledAt,
          });
        }
        if (calcomCancelFailed && companyId) {
          await supabase.from("lead_activities").insert({
            company_id: companyId,
            lead_id: leadData.id,
            type: "alert",
            description: "⚠️ Cancelamento no Cal.com falhou — verifique o painel e cancele manualmente",
            metadata: { stage: "pause_rejection", booking_uid: cancelledBookingUid },
          });
        }
      }
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "lead_rejected" } as any)
          .eq("id", enrollment.id);
      }
      if (!parsed.reply_message) {
        parsed.reply_message = "Tudo bem, agradeço muito pelo seu retorno e pelo tempo até aqui! Vou pausar nosso contato por aqui. Se mudar de ideia ou quiser conversar mais pra frente, é só me chamar. 👋";
      }
    } else if (parsed.action === "request_call" && leadData && companyId) {
      // Prospect asked to be called. Pause cadence, log a 'call' task with metadata for human/voice agent.
      console.log(`Call requested for lead ${leadData.id}`);
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "call_requested" } as any)
          .eq("id", enrollment.id);
      }
      const callPhone = parsed.call_phone || leadData.phone || null;
      const callWindow = parsed.call_window || null;
      await supabase
        .from("leads")
        .update({ call_requested_at: new Date().toISOString() } as any)
        .eq("id", leadData.id);
      await supabase.from("lead_activities").insert({
        company_id: companyId,
        lead_id: leadData.id,
        type: "call",
        description: `📞 Pedido de ligação${callWindow ? ` (${callWindow})` : ""}${callPhone ? ` — ${callPhone}` : ""}`,
        metadata: {
          task_type: "call",
          status: "pending",
          phone: callPhone,
          preferred_window: callWindow,
          source_message: cleanContent.substring(0, 300),
        },
      });
      if (!parsed.reply_message) {
        parsed.reply_message = callWindow
          ? `Combinado! Vou agendar a ligação ${callWindow}${callPhone ? ` no ${callPhone}` : ""}. Se precisar ajustar, é só me avisar.`
          : `Perfeito! Vou pedir para nosso time te ligar${callPhone ? ` no ${callPhone}` : ""}. Tem alguma janela de horário que prefere?`;
      }
    } else if (parsed.action === "handoff" && leadData && companyId) {
      // Human handoff: pause cadence, flag lead, log activity. Keep reply short and honest.
      console.log(`Handoff requested for lead ${leadData.id}: ${parsed.handoff_reason}`);
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: "handoff_required" } as any)
          .eq("id", enrollment.id);
      }
      await supabase
        .from("leads")
        .update({
          handoff_required: true,
          handoff_reason: parsed.handoff_reason || "Pergunta fora da base de conhecimento",
          handoff_at: new Date().toISOString(),
        } as any)
        .eq("id", leadData.id);
      await supabase.from("lead_activities").insert({
        company_id: companyId,
        lead_id: leadData.id,
        type: "note",
        description: `🚨 Handoff humano necessário: ${parsed.handoff_reason || "tema fora da base"}`,
        metadata: {
          handoff: true,
          reason: parsed.handoff_reason,
          source_message: cleanContent.substring(0, 300),
          reasoning: parsed.reasoning,
        },
      });
      if (!parsed.reply_message) {
        parsed.reply_message = "Ótima pergunta! Vou passar para um especialista do nosso time, que retorna em breve com a resposta correta. Obrigado pela paciência!";
      }
    } else if (parsed.action === "referral" && leadData && companyId) {
      const ref = parsed.referral || {};
      const subtype: string = ref.subtype || "wrong_person";
      console.log(`Referral detected (subtype=${subtype}) for lead ${leadData.id}`);

      // Always pause active cadence for the original contact when a referral is detected
      if (enrollment) {
        await supabase
          .from("cadence_enrollments")
          .update({ status: "paused", paused_reason: `referral_${subtype}` } as any)
          .eq("id", enrollment.id);
      }

      // Map subtype → stage / role
      const stageMap: Record<string, string> = {
        with_contact: "encaminhado_para_decisor",
        without_contact: "aguardando_contato_decisor",
        will_forward: "aguardando_encaminhamento_interno",
        wrong_person: "contato_errado",
        gatekeeper: "tentando_identificar_decisor",
        refuses_contact: "sem_acesso_decisor",
      };

      // Mark current lead as indicador/gatekeeper
      const originalRole = subtype === "gatekeeper" ? "gatekeeper" : "indicador";
      await supabase
        .from("leads")
        .update({
          referral_role: originalRole,
          referral_stage: stageMap[subtype] || null,
          referral_context: ref.context || null,
          referral_permission_to_mention: ref.permission_to_mention ?? null,
        } as any)
        .eq("id", leadData.id);

      // Audit activity
      await supabase.from("lead_activities").insert({
        company_id: companyId,
        lead_id: leadData.id,
        type: "referral",
        description: `Indicação detectada (${subtype})${ref.referred_name ? ` → ${ref.referred_name}` : ""}`,
        metadata: { referral: ref, reasoning: parsed.reasoning, playbook: parsed.playbook || "neutro" },
      });

      // with_contact: create new lead + conversation + 1st outreach
      if (subtype === "with_contact" && ref.referred_name && (ref.referred_email || ref.referred_phone)) {
        const normalizedEmail = ref.referred_email
          ? String(ref.referred_email).toLowerCase().trim()
          : null;
        const normalizedPhone = normalizeBrPhone(ref.referred_phone);
        const phoneForLead = normalizedPhone || (ref.referred_phone ? String(ref.referred_phone).trim() : null);
        const waForLead = isBrMobile(normalizedPhone) ? normalizedPhone : null;
        const newChannel = pickReferralChannel(
          ref.referred_channel,
          !!normalizedEmail,
          !!phoneForLead,
        );

        // Inherit company fields from the referrer lead (same company by assumption)
        const inheritedCompanyName =
          leadData.company_name || companyNameFromWebsite(leadData.website) || null;
        const inheritedWebsite = leadData.website || null;
        const inheritedAddress = leadData.address || null;
        const inheritedLinkedinCompany = leadData.linkedin_company_url || null;

        // Avoid duplicates by email within same company
        let newLeadId: string | null = null;
        if (normalizedEmail) {
          const { data: existing } = await supabase
            .from("leads")
            .select("id, whatsapp, phone, company_name, website, address, linkedin_company_url")
            .eq("company_id", companyId)
            .eq("email", normalizedEmail)
            .maybeSingle();
          if (existing?.id) {
            newLeadId = existing.id;
            // Backfill phone/whatsapp + company fields if missing
            const patch: any = {};
            if (!existing.phone && phoneForLead) patch.phone = phoneForLead;
            if (!existing.whatsapp && waForLead) patch.whatsapp = waForLead;
            if (!existing.company_name && inheritedCompanyName) patch.company_name = inheritedCompanyName;
            if (!existing.website && inheritedWebsite) patch.website = inheritedWebsite;
            if (!existing.address && inheritedAddress) patch.address = inheritedAddress;
            if (!existing.linkedin_company_url && inheritedLinkedinCompany) patch.linkedin_company_url = inheritedLinkedinCompany;
            if (Object.keys(patch).length) {
              await supabase.from("leads").update(patch).eq("id", existing.id);
            }
          }
        }

        if (!newLeadId) {
          const insertRow: any = {
            company_id: companyId,
            name: ref.referred_name,
            email: normalizedEmail,
            phone: phoneForLead,
            whatsapp: waForLead,
            company_name: inheritedCompanyName,
            website: inheritedWebsite,
            address: inheritedAddress,
            linkedin_company_url: inheritedLinkedinCompany,
            title: ref.referred_role || null,
            source: "referral",
            status: "new",
            referral_source_lead_id: leadData.id,
            referral_role: "decisor",
            referral_stage: "novo_indicado",
            referral_context: ref.context || null,
            referral_permission_to_mention: ref.permission_to_mention ?? null,
            preferred_channel: newChannel,
          };
          const { data: newLead, error: newLeadErr } = await supabase
            .from("leads")
            .insert(insertRow)
            .select("id")
            .single();
          if (newLeadErr) {
            console.error("Failed to create referred lead:", newLeadErr);
          } else {
            newLeadId = newLead.id;
          }
        }

        // Create conversation + first outbound message and send via available channel
        if (newLeadId) {
          // Fallback outreach message if AI didn't produce one
          const sourceName = leadData.name?.split(" ")[0] || "";
          const sourceCompany = leadData.company_name || "";
          const mention = ref.permission_to_mention
            ? `${sourceName}${sourceCompany ? ` (${sourceCompany})` : ""} me passou seu contato`
            : `Falei com a equipe${sourceCompany ? ` da ${sourceCompany}` : ""} e me indicaram você`;
          const outreachMessage = parsed.new_outreach_message ||
            `Olá ${ref.referred_name?.split(" ")[0] || ""}! ${mention} para falarmos sobre uma possível parceria. Você teria uns minutos esta semana para uma conversa rápida?`;

          const { data: newConv, error: convErr } = await supabase
            .from("conversations")
            .insert({
              company_id: companyId,
              lead_id: newLeadId,
              channel: newChannel,
            })
            .select("id")
            .single();
          if (convErr) {
            console.error("Failed to create referral conversation:", convErr);
          }

          const newConvId = newConv?.id;
          const outreachMeta = {
            referral_outreach: true,
            referral_source_lead_id: leadData.id,
            referral_source_name: leadData.name,
            permission_to_mention: ref.permission_to_mention ?? null,
          };

          // Email path → use gmail-send when available, else transactional
          if (newChannel === "email" && normalizedEmail && newConvId) {
            const subject = `${leadData.company_name || "Indicação"} — apresentação`;
            const { data: gmailAcc } = await supabase
              .from("gmail_account")
              .select("email")
              .eq("is_active", true)
              .maybeSingle();
            let sent = false;
            if (gmailAcc?.email) {
              try {
                const { error: sendErr } = await supabase.functions.invoke("gmail-send", {
                  body: {
                    to: normalizedEmail,
                    subject,
                    html: toEmailHtml(outreachMessage),
                    text: outreachMessage,
                    conversation_id: newConvId,
                    company_id: companyId,
                    lead_id: newLeadId,
                  },
                });
                if (!sendErr) sent = true;
              } catch (e) {
                console.error("gmail-send for referral failed:", e);
              }
            }
            if (!sent) {
              await supabase.from("messages").insert({
                conversation_id: newConvId,
                content: outreachMessage,
                direction: "outbound",
                ai_suggested: true,
                metadata: { ...outreachMeta, subject, via: "transactional" },
              });
              await supabase.functions.invoke("send-transactional-email", {
                body: {
                  templateName: "cadence-outreach",
                  recipientEmail: normalizedEmail,
                  idempotencyKey: `referral-${newLeadId}-${Date.now()}`,
                  templateData: {
                    leadName: ref.referred_name,
                    subject,
                    messageBody: outreachMessage,
                  },
                },
              });
            }
          } else if (newChannel === "whatsapp" && phoneForLead && newConvId) {
            // WhatsApp path → send via Z-API
            const zCfg = await getZApiConfig(supabase, companyId);
            let deliveryStatus = "pending_send";
            let deliveryMeta: Record<string, any> = {};
            if (zCfg) {
              const r = await sendWhatsAppViaZApi(zCfg, phoneForLead, outreachMessage);
              if (r.ok) {
                deliveryStatus = "delivered";
                deliveryMeta = { zapi_message_id: r.sid, zapi_status: r.status };
              } else {
                deliveryStatus = "failed";
                deliveryMeta = { zapi_status: r.status, zapi_error: r.error };
              }
            } else {
              deliveryMeta = { delivery_error: "Z-API não configurada" };
            }
            await supabase.from("messages").insert({
              conversation_id: newConvId,
              content: outreachMessage,
              direction: "outbound",
              ai_suggested: true,
              metadata: { ...outreachMeta, channel: "whatsapp", delivery_status: deliveryStatus, ...deliveryMeta },
            });
          }

          // Activity log on the referred lead
          await supabase.from("lead_activities").insert({
            company_id: companyId,
            lead_id: newLeadId,
            type: "referral",
            description: `📨 Primeira abordagem ao indicado enviada via ${newChannel}`,
            metadata: { ...outreachMeta, channel: newChannel },
          });
        }
      }
    }


    // Send auto-reply if needed
    if (parsed.reply_message) {
      const replyChannel = convChannel || channel || "email";
      const autoReplyMetadata = {
        auto_reply: true,
        sentiment: parsed.sentiment,
        action: parsed.action,
        reasoning: parsed.reasoning,
        ...(["schedule", "reject_slots", "reschedule"].includes(parsed.action) ? { offered_slots: (heldSlots || []).map((s: any) => s.slot_datetime) } : {}),
      };

      let sentViaGmail = false;

      if (replyChannel === "email" && leadData?.email) {
        // Build threading headers from prior Gmail messages on this conversation
        const { data: priorMsgs } = await supabase
          .from("messages")
          .select("direction, rfc_message_id, gmail_thread_id, metadata, sent_at")
          .eq("conversation_id", convId)
          .not("rfc_message_id", "is", null)
          .order("sent_at", { ascending: true });

        const lastInbound = (priorMsgs || []).slice().reverse().find((m: any) => m.direction === "inbound" && m.rfc_message_id);
        const allRfcIds = (priorMsgs || []).map((m: any) => m.rfc_message_id).filter(Boolean);
        const originalSubject = (priorMsgs || [])
          .map((m: any) => m.metadata?.subject)
          .find((s: any) => typeof s === "string" && s.length > 0) || `${leadData.company_name || leadData.name}`;
        const replySubject = /^re:/i.test(originalSubject) ? originalSubject : `Re: ${originalSubject}`;

        // Check Gmail availability for this company
        const { data: gmailAcc } = await supabase
          .from("gmail_account")
          .select("email")
          .eq("is_active", true)
          .maybeSingle();

        if (gmailAcc?.email) {
          try {
            const { data: sendRes, error: sendErr } = await supabase.functions.invoke("gmail-send", {
              body: {
                to: leadData.email,
                subject: replySubject,
                html: toEmailHtml(parsed.reply_message),
                text: parsed.reply_message,
                conversation_id: convId,
                company_id: companyId,
                lead_id: leadData.id,
                in_reply_to_rfc_id: lastInbound?.rfc_message_id || null,
                references: allRfcIds.length ? allRfcIds.join(" ") : (lastInbound?.rfc_message_id || null),
              },
            });
            if (sendErr) throw sendErr;
            const gmailMessageId = (sendRes as any)?.gmail_message_id;
            // Promote the row inserted by gmail-send with our AI metadata
            if (gmailMessageId) {
              await supabase
                .from("messages")
                .update({ ai_suggested: true, metadata: { ...autoReplyMetadata, subject: replySubject, channel: "email", via: "gmail" } })
                .eq("gmail_message_id", gmailMessageId);
            }
            sentViaGmail = true;
          } catch (e) {
            console.error("gmail-send auto-reply failed, falling back to transactional:", e);
          }
        }

        if (!sentViaGmail) {
          // Fallback: transactional email (also save the message row, since gmail-send didn't run)
          await supabase.from("messages").insert({
            conversation_id: convId,
            content: parsed.reply_message,
            direction: "outbound",
            ai_suggested: true,
            metadata: { ...autoReplyMetadata, via: "transactional" },
          });
          await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "cadence-outreach",
              recipientEmail: leadData.email,
              idempotencyKey: `auto-reply-${convId}-${Date.now()}`,
              templateData: {
                leadName: leadData.name,
                subject: replySubject,
                messageBody: parsed.reply_message,
              },
            },
          });
        }
      } else if (replyChannel === "whatsapp" && (leadData?.whatsapp || leadData?.phone)) {
        const toNumber = leadData.whatsapp || leadData.phone;
        const zCfg = companyId ? await getZApiConfig(supabase, companyId) : null;
        let deliveryMeta: Record<string, unknown> = { ...autoReplyMetadata };

        if (!zCfg) {
          deliveryMeta = { ...deliveryMeta, delivery_status: "pending_manual", delivery_error: "Z-API não configurada para a empresa" };
          console.warn("inbound-webhook: Z-API not configured for company", companyId);
        } else {
          const r = await sendWhatsAppViaZApi(zCfg, toNumber, parsed.reply_message);
          if (!r.ok) {
            deliveryMeta = { ...deliveryMeta, delivery_status: "failed", zapi_status: r.status, zapi_error: r.error };
            console.error("inbound-webhook: Z-API WhatsApp send failed:", r.error);
          } else {
            deliveryMeta = { ...deliveryMeta, delivery_status: "sent", zapi_message_id: r.sid };
          }
        }

        await supabase.from("messages").insert({
          conversation_id: convId,
          content: parsed.reply_message,
          direction: "outbound",
          ai_suggested: true,
          metadata: deliveryMeta,
        });
      } else {
        // Unknown channel — still log the message for visibility
        await supabase.from("messages").insert({
          conversation_id: convId,
          content: parsed.reply_message,
          direction: "outbound",
          ai_suggested: true,
          metadata: { ...autoReplyMetadata, delivery_status: "pending_manual", delivery_error: `Canal '${replyChannel}' sem destinatário válido` },
        });
      }

    }


    // Log execution
    if (enrollment && leadData && companyId) {
      const { data: steps } = await supabase
        .from("cadence_steps")
        .select("id")
        .eq("cadence_id", enrollment.cadence_id)
        .limit(1);

      if (steps && steps.length > 0) {
        const actionMap: Record<string, string> = {
          schedule: "scheduled",
          confirm_slot: "meeting_confirmed",
          reject_slots: "slots_rejected",
          check_availability: "availability_checked",
          reschedule: "rescheduled",
          cancel: "meeting_cancelled",
          pause: "paused",
          referral: "referral_detected",
          request_call: "call_requested",
          handoff: "handoff_required",
        };
        await supabase.from("execution_logs").insert({
          company_id: companyId,
          enrollment_id: enrollment.id,
          step_id: steps[0].id,
          lead_id: leadData.id,
          channel: channel || "email",
          action: actionMap[parsed.action] || "replied",
          message_content: parsed.reply_message || content,
          ai_context: parsed,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, action: parsed.action, sentiment: parsed.sentiment }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("inbound-webhook error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
