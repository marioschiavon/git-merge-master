import { Mail } from "lucide-react";
import whatsappIcon from "@/assets/whatsapp.ico.asset.json";

interface Lead {
  email?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
}

interface Props {
  lead: Lead;
  size?: "sm" | "md";
}

export function ChannelBadges({ lead, size = "sm" }: Props) {
  const wpp = lead.whatsapp || lead.phone;
  const email = lead.email;
  const dim = size === "md" ? "h-4 w-4" : "h-3.5 w-3.5";

  if (!wpp && !email) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {wpp && (
        <span title={`WhatsApp: ${wpp}`} className="inline-flex shrink-0">
          <img src={whatsappIcon.url} alt="WhatsApp" className={`${dim} shrink-0 object-contain`} />
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
