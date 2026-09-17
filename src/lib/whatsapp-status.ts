/**
 * Tradução dos motivos técnicos de queda do WhatsApp para texto de cliente.
 * Nunca afirmamos banimento: o provedor só informa que a sessão foi encerrada
 * ou que a reconexão foi recusada.
 */

export interface WhatsAppDownReason {
  /** Texto curto exibido ao cliente. */
  text: string;
  /** Recusa do WhatsApp (403): vale sugerir a leitura de boas práticas. */
  refused: boolean;
}

export function describeWhatsAppDownReason(
  lastError?: string | null,
): WhatsAppDownReason {
  const e = (lastError ?? "").toLowerCase();
  if (e.includes("403")) {
    return {
      text:
        "o WhatsApp recusou a reconexão deste número — isso costuma acontecer quando há volume alto de envios ou denúncias de contatos",
      refused: true,
    };
  }
  if (e.includes("401") || e.includes("loggedout")) {
    return {
      text:
        "o aparelho encerrou a sessão (o celular saiu dos aparelhos conectados ou ficou muito tempo sem internet)",
      refused: false,
    };
  }
  return {
    text: "a conexão com o celular foi perdida",
    refused: false,
  };
}

/** "há 2 dias", "há 5 horas", "há 20 minutos". */
export function describeDownFor(since?: string | null): string | null {
  if (!since) return null;
  const ms = Date.now() - new Date(since).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `há ${Math.max(1, min)} minuto${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} hora${h === 1 ? "" : "s"}`;
  return `há ${Math.floor(h / 24)} dias`;
}
