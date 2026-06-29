import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Tick a cada 30s. Verde <5min, amarelo 5-15min, vermelho >15min. */
export function SLABadge({ lastInboundAt, className }: { lastInboundAt: string | null; className?: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  if (!lastInboundAt) return null;
  const ms = Date.now() - new Date(lastInboundAt).getTime();
  const min = Math.floor(ms / 60_000);
  const tone = min < 5 ? "ok" : min < 15 ? "warn" : "danger";

  const label = min < 1 ? "agora" : min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}`;
  const dot = tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-red-500";
  const text = tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-red-700";

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium", text, className)} title={`Última mensagem do lead há ${label}`}>
      <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", dot)} />
      {label}
    </span>
  );
}
