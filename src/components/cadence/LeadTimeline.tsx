import { Mail, MessageSquare, Linkedin, Phone, CheckCircle2, Circle, CircleDot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const channelIcon = (ch: string) => {
  switch (ch) {
    case "email":
      return <Mail className="h-4 w-4" />;
    case "whatsapp":
      return <MessageSquare className="h-4 w-4" />;
    case "linkedin":
      return <Linkedin className="h-4 w-4" />;
    case "phone":
      return <Phone className="h-4 w-4" />;
    default:
      return <Mail className="h-4 w-4" />;
  }
};

type Step = { id: string; step_order: number; channel: string; subject: string | null; delay_days: number; template: string | null };

export function LeadTimeline({
  steps,
  currentStep,
  execLogs,
}: {
  steps: Step[];
  currentStep: number;
  execLogs: any[];
}) {
  const logsByStep = new Map<number, any>();
  execLogs.forEach((l) => {
    const ord = l.cadence_steps?.step_order;
    if (ord && !logsByStep.has(ord)) logsByStep.set(ord, l);
  });

  return (
    <ol className="relative space-y-0">
      {steps.map((step, idx) => {
        const done = step.step_order < currentStep;
        const current = step.step_order === currentStep;
        const log = logsByStep.get(step.step_order);
        const isLast = idx === steps.length - 1;

        return (
          <li key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
                  done && "border-primary bg-primary text-primary-foreground",
                  current && "border-primary bg-primary/10 text-primary ring-4 ring-primary/10",
                  !done && !current && "border-muted bg-background text-muted-foreground",
                )}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : current ? <CircleDot className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
              </div>
              {!isLast && <div className={cn("w-px flex-1 min-h-6", done ? "bg-primary" : "bg-border")} />}
            </div>
            <div className="flex-1 pb-5">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">Step {step.step_order}</span>
                <Badge variant="outline" className="gap-1 text-xs">
                  {channelIcon(step.channel)}
                  {step.channel}
                </Badge>
                <span className="text-xs text-muted-foreground">+{step.delay_days}d</span>
                {current && <Badge className="text-xs">Atual</Badge>}
              </div>
              {step.subject && <p className="mt-0.5 text-sm text-muted-foreground">{step.subject}</p>}
              {log && (
                <div className="mt-2 rounded border bg-muted/30 p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between text-muted-foreground">
                    <span>{log.action}</span>
                    <span>{format(new Date(log.created_at), "dd/MM HH:mm", { locale: ptBR })}</span>
                  </div>
                  {log.message_content && (
                    <p className="line-clamp-3 whitespace-pre-wrap text-foreground">{log.message_content}</p>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
