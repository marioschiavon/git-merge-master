// Cartões de contato (vCard) recebidos pelo WhatsApp.
// Parse do vCard + cadastro do indicado + abordagem (respeitando aprovação humana).

import { normalizePhoneBR } from "./phone-br.ts";
import { shouldGate, createApprovalRequest } from "./hitl-gate.ts";
import { enqueueWhatsAppSend } from "./whatsapp-pacer.ts";
import { chatCompletion } from "./ai-gateway.ts";

export interface SharedContact {
  name: string | null;
  phone: string | null; // formato +55...
  email: string | null;
  org: string | null;
  title: string | null;
}

function unescapeV(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}

export function parseVCard(vcard: string, displayName?: string | null): SharedContact {
  const lines = String(vcard || "").replace(/\r\n[ \t]/g, "").split(/\r?\n/);
  let name: string | null = null, phone: string | null = null, email: string | null = null;
  let org: string | null = null, title: string | null = null;
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const keyPart = line.slice(0, idx);
    const value = unescapeV(line.slice(idx + 1));
    const key = keyPart.split(";")[0].split(".").pop()!.toUpperCase();
    if (key === "FN" && !name && value) name = value;
    else if (key === "N" && !name && value) name = value.split(";").filter(Boolean).reverse().join(" ").trim() || null;
    else if (key === "TEL" && !phone) {
      const waid = keyPart.match(/waid=(\d+)/i)?.[1];
      phone = normalizePhoneBR(waid || value) || null;
    } else if (key === "EMAIL" && !email && value.includes("@")) email = value.toLowerCase();
    else if (key === "ORG" && !org && value) org = value.split(";").filter(Boolean).join(" - ");
    else if (key === "TITLE" && !title && value) title = value;
  }
  if (!name && displayName) name = String(displayName).trim() || null;
  return { name, phone, email, org, title };
}

// deno-lint-ignore no-explicit-any
export function extractSharedContacts(message: any): SharedContact[] {
  if (!message || typeof message !== "object") return [];
  const out: SharedContact[] = [];
  const single = message.contactMessage;
  if (single?.vcard) out.push(parseVCard(single.vcard, single.displayName));
  const arr = message.contactsArrayMessage?.contacts;
  if (Array.isArray(arr)) {
    for (const c of arr) if (c?.vcard) out.push(parseVCard(c.vcard, c.displayName));
  }
  return out;
}

export function sharedContactsToText(contacts: SharedContact[]): string {
  return contacts
    .map((c) => {
      const parts = [c.name || "Sem nome", c.phone || "sem telefone"];
      if (c.email) parts.push(c.email);
      const extra = [c.title, c.org].filter(Boolean).join(", ");
      return `📇 Contato compartilhado: ${parts.join(" — ")}${extra ? ` (${extra})` : ""}`;
    })
    .join("\n");
}

function digits(s: string | null | undefined) {
  return String(s || "").replace(/\D/g, "");
}

// deno-lint-ignore no-explicit-any
async function buildOutreach(admin: any, companyId: string, sourceLead: any, c: SharedContact, contextText: string): Promise<string> {
  const first = (c.name || "").split(" ")[0] || "";
  const source = sourceLead.company_name || sourceLead.name || "sua equipe";
  const fallback = `Olá${first ? ` ${first}` : ""}! A equipe ${source} me passou seu contato como responsável pelo assunto. Posso te explicar rapidinho do que se trata?`;
  try {
    const { data: kb } = await admin
      .from("company_knowledge")
      .select("title, content")
      .eq("company_id", companyId)
      .limit(6);
    const kbText = (kb || []).map((k: any) => `- ${k.title}: ${String(k.content || "").slice(0, 400)}`).join("\n");
    const res = await chatCompletion({
      model: "google/gemini-2.5-flash",
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "Você é um SDR em pt-BR escrevendo a PRIMEIRA mensagem de WhatsApp para uma pessoa que foi indicada por outro contato. " +
            "Cite a indicação de forma natural, apresente em 1 frase o que a empresa oferece (use a base), e termine com pergunta leve. " +
            "Máximo 3 frases curtas. Nunca sugira dia/hora. Responda só com o texto da mensagem.",
        },
        {
          role: "user",
          content:
            `Indicado: ${c.name || "(sem nome)"}${c.title ? `, ${c.title}` : ""}${c.org ? `, ${c.org}` : ""}\n` +
            `Quem indicou: ${sourceLead.name || ""} (${sourceLead.company_name || ""})\n` +
            `Contexto da conversa com quem indicou:\n${contextText.slice(0, 1200)}\n\nBase de conhecimento:\n${kbText}`,
        },
      ],
    });
    const txt = String(res.choices?.[0]?.message?.content || "").trim();
    return txt && txt.length < 800 ? txt : fallback;
  } catch (e) {
    console.error("[shared-contact] outreach generation failed", e);
    return fallback;
  }
}

async function sendOrGate(
  // deno-lint-ignore no-explicit-any
  admin: any,
  args: { companyId: string; leadId: string; conversationId: string; phone: string; message: string; kind: "first_message" | "sdr_reply"; context: Record<string, unknown> },
) {
  const gated = await shouldGate(admin, args.companyId, args.kind, { lead_id: args.leadId, conversation_id: args.conversationId });
  if (gated) {
    await createApprovalRequest(admin, {
      company_id: args.companyId,
      lead_id: args.leadId,
      conversation_id: args.conversationId,
      kind: args.kind,
      channel: "whatsapp",
      action: "send",
      payload: { message: args.message },
      context: args.context,
    } as any);
    return "pending_approval";
  }
  const r = await enqueueWhatsAppSend(admin, {
    companyId: args.companyId,
    toPhone: args.phone,
    body: args.message,
    leadId: args.leadId,
    conversationId: args.conversationId,
    source: args.kind === "first_message" ? "first_message" : "referral_reply",
    replyMode: args.kind === "sdr_reply",
    metadata: args.context,
  });
  return r.ok ? "queued" : `failed: ${r.error}`;
}

/** Processa cartões recebidos de um lead: cadastra indicados e inicia contato. */
export async function handleSharedContacts(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  params: { companyId: string; sourceLead: any; conversationId: string; contacts: SharedContact[] },
) {
  const { companyId, sourceLead, conversationId, contacts } = params;
  const sourceDigits = [digits(sourceLead.whatsapp), digits(sourceLead.phone)].filter(Boolean);

  const { data: recent } = await admin
    .from("messages")
    .select("direction, content")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false })
    .limit(6);
  const contextText = (recent || []).reverse()
    .map((m: any) => `${m.direction === "inbound" ? "LEAD" : "SDR"}: ${m.content || ""}`).join("\n");

  const created: string[] = [];
  for (const c of contacts) {
    if (!c.phone) {
      await admin.from("lead_activities").insert({
        company_id: companyId, lead_id: sourceLead.id, type: "referral",
        description: `📇 Cartão de contato recebido sem telefone${c.name ? ` (${c.name})` : ""} — verifique na conversa`,
        metadata: { shared_contact: c },
      });
      continue;
    }
    const d = digits(c.phone);
    if (sourceDigits.some((s) => s.slice(-10) === d.slice(-10))) continue; // o próprio lead

    // Reaproveita lead existente com o mesmo número
    const { data: cands } = await admin
      .from("leads")
      .select("id, name, whatsapp, phone")
      .eq("company_id", companyId)
      .or(`whatsapp.ilike.%${d.slice(-8)},phone.ilike.%${d.slice(-8)}`)
      .limit(10);
    const existing = (cands || []).find((l: any) =>
      [digits(l.whatsapp), digits(l.phone)].some((x) => x && x.slice(-10) === d.slice(-10))
    );

    let newLeadId: string | null = existing?.id ?? null;
    let alreadyTalking = false;
    if (existing) {
      const { data: conv } = await admin.from("conversations").select("id").eq("lead_id", existing.id).limit(1);
      if (conv?.length) {
        const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv[0].id);
        alreadyTalking = (count ?? 0) > 0;
      }
    } else {
      const { data: nl, error } = await admin.from("leads").insert({
        company_id: companyId,
        name: c.name || c.phone,
        email: c.email,
        phone: c.phone,
        whatsapp: c.phone,
        title: c.title,
        company_name: sourceLead.company_name || c.org || null,
        website: sourceLead.website || null,
        city: sourceLead.city || null,
        state: sourceLead.state || null,
        source: "referral",
        status: "new",
        referral_source_lead_id: sourceLead.id,
        referral_role: "decisor",
        referral_stage: "novo_indicado",
        referral_context: c.org ? `Cartão de contato — ${c.org}` : "Cartão de contato compartilhado no WhatsApp",
        preferred_channel: "whatsapp",
      }).select("id").single();
      if (error) { console.error("[shared-contact] lead insert failed", error); continue; }
      newLeadId = nl.id;
    }
    if (!newLeadId) continue;
    created.push(c.name || c.phone);

    await admin.from("lead_activities").insert({
      company_id: companyId, lead_id: newLeadId, type: "referral",
      description: `📇 Indicado por ${sourceLead.name || sourceLead.company_name || "outro contato"} via cartão de contato`,
      metadata: { referral_source_lead_id: sourceLead.id, shared_contact: c },
    });

    if (alreadyTalking) continue;

    let { data: conv } = await admin.from("conversations").select("id")
      .eq("company_id", companyId).eq("lead_id", newLeadId).eq("channel", "whatsapp").maybeSingle();
    if (!conv) {
      const { data: nc } = await admin.from("conversations")
        .insert({ company_id: companyId, lead_id: newLeadId, channel: "whatsapp" }).select("id").single();
      conv = nc;
    }
    if (!conv) continue;
    const msg = await buildOutreach(admin, companyId, sourceLead, c, contextText);
    const res = await sendOrGate(admin, {
      companyId, leadId: newLeadId, conversationId: conv.id, phone: c.phone, message: msg,
      kind: "first_message", context: { referral_outreach: true, referral_source_lead_id: sourceLead.id },
    });
    console.log("[shared-contact] outreach", { newLeadId, res });
  }

  if (created.length === 0) return;

  // Contato original: pausa cadência, marca como indicador, agradece.
  await admin.from("cadence_enrollments")
    .update({ status: "paused", paused_reason: "referral_with_contact" })
    .eq("lead_id", sourceLead.id).eq("status", "active");
  await admin.from("leads").update({ referral_role: "indicador", referral_stage: "encaminhado_para_decisor" }).eq("id", sourceLead.id);
  await admin.from("lead_activities").insert({
    company_id: companyId, lead_id: sourceLead.id, type: "referral",
    description: `📇 Indicou ${created.join(", ")} (cartão de contato)`,
    metadata: { shared_contacts: contacts },
  });
  const to = sourceLead.whatsapp || sourceLead.phone;
  if (to) {
    const thanks = created.length === 1
      ? `Muito obrigado pelo contato! Vou falar com ${created[0].split(" ")[0]} 🙏`
      : "Muito obrigado pelos contatos! Vou falar com eles 🙏";
    await sendOrGate(admin, {
      companyId, leadId: sourceLead.id, conversationId, phone: to, message: thanks,
      kind: "sdr_reply", context: { referral_thanks: true },
    });
  }
}
