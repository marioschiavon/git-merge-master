import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LeadDetailContent, LeadDetailLead } from "./LeadDetailContent";

interface LeadDetailProps {
  lead: LeadDetailLead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LeadDetail({ lead, open, onOpenChange }: LeadDetailProps) {
  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="sr-only">Detalhes do lead</SheetTitle>
        </SheetHeader>
        <div className="mt-2">
          <LeadDetailContent
            lead={lead}
            onAfterDelete={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
