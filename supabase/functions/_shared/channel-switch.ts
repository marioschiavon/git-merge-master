// Lead pediu para continuar a conversa em outro canal (ex.: respondeu o e-mail
// dizendo "me chama no WhatsApp 31 9..."). Não é indicação: é o mesmo lead.
// Salva o número, abre a conversa de WhatsApp e prepara a mensagem de
// continuidade (respeitando Aprovações). Sem WhatsApp conectado → só registra.
import { normalizePhoneBR } from "./phone-br.ts";
import { sendOrGate } from "./shared-contact.ts";

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

// deno-lint-ignore no-explicit-any
export async function handleChannelSwitch(admin: any, args: { lead: any; phone: string; fromChannel: string }) {
  const { lead } = args;
  const phone = normalizePhoneBR(args.phone);
  if (!phone) return { handled: false, reason: "invalid_phone" };
  const current = [digits(lead.whatsapp), digits(lead.phone)];
  const sameAsCurrent = current.some((c) => c && c.slice(-10) === digits(phone).slice(-10));
  if (sameAsCurrent && args.fromChannel === "whatsapp") return { handled: false, reason: "same_number" };

  const { data: inst } = await admin.from("hook7_instances").select("id")
    .eq("company_id", lead.company_id).eq("status", "connected").is("archived_at", null).limit(1).maybeSingle();

  await admin.from("leads").update({ whatsapp: phone, preferred_channel: "whatsapp" }).eq("id", lead.id);

  if (!inst) {
    await admin.from("lead_activities").insert({
      company_id: lead.company_id, lead_id: lead.id, type: "note",
      description: `📱 Pediu para continuar no WhatsApp (${phone}), mas a empresa não tem WhatsApp conectado — falar manualmente`,
      metadata: { channel_switch: true, phone, needs_human: true },
    });
    return { handled: false, reason: "no_whatsapp_instance" };
  }

  let { data: conv } = await admin.from("conversations").select("id")
    .eq("company_id", lead.company_id).eq("lead_id", lead.id).eq("channel", "whatsapp").limit(1).maybeSingle();
  if (!conv) {
    const { data: nc } = await admin.from("conversations")
      .insert({ company_id: lead.company_id, lead_id: lead.id, channel: "whatsapp" }).select("id").single();
    conv = nc;
  }
  if (!conv) return { handled: false, reason: "conversation_failed" };

  const first = String(lead.name || "").split(" ")[0];
  const message = `Oi${first ? ` ${first}` : ""}! Aqui é da equipe que falou com você por e-mail 🙂 Como combinado, sigo por aqui. Posso te explicar rapidinho e ver um horário que funcione pra você?`;
  const res = await sendOrGate(admin, {
    companyId: lead.company_id, leadId: lead.id, conversationId: conv.id, phone, message,
    kind: "sdr_reply", context: { channel_switch: true, from_channel: args.fromChannel },
  });
  await admin.from("lead_activities").insert({
    company_id: lead.company_id, lead_id: lead.id, type: "whatsapp",
    description: `📱 Pediu para continuar no WhatsApp (${phone}) — mensagem ${res === "pending_approval" ? "em Aprovações" : res === "queued" ? "na fila de envio" : res}`,
    metadata: { channel_switch: true, phone, result: res },
  });
  return { handled: true, result: res, conversation_id: conv.id };
}
