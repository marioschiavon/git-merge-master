import { Mail } from "lucide-react";
import whatsappIcon from "@/assets/whatsapp.ico.asset.json";

interface Lead {
  email?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  whatsapp_valid?: boolean | null;
  whatsapp_checked_at?: string | null;
}

interface Props {
  lead: Lead;
  size?: "sm" | "md";
}

export function ChannelBadges({ lead, size = "sm" }: Props) {
  const wpp = lead.whatsapp || lead.phone;
  const email = lead.email;
  const dim = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";
  const valid = lead.whatsapp_valid;
  const checkedLabel = lead.whatsapp_checked_at
    ? ` (verificado em ${new Date(lead.whatsapp_checked_at).toLocaleDateString("pt-BR")})`
    : "";

  if (!wpp && !email) return null;

  const wppTitle = valid === true
    ? `WhatsApp confirmado: ${wpp}${checkedLabel}`
    : valid === false
    ? `Número sem WhatsApp: ${wpp}${checkedLabel}`
    : `WhatsApp não verificado: ${wpp}`;

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {wpp && (
        <span title={wppTitle} className="relative inline-flex shrink-0">
          <img
            src={whatsappIcon.url}
            alt="WhatsApp"
            className={`${dim} shrink-0 object-contain ${
              valid === false ? "opacity-30 grayscale" : valid === true ? "" : "opacity-50"
            }`}
          />
          {valid === false && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <span className="h-px w-full rotate-45 bg-muted-foreground" />
            </span>
          )}
        </span>
      )}
      {email && (
        <span title={`E-mail: ${email}`} className="inline-flex shrink-0">
          <Mail className={`${dim} shrink-0 text-blue-600`} aria-label="E-mail" />
        </span>
      )}
    </span>
  );
}
