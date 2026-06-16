import { useState, KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

export function GuestsInput({
  value, onChange, placeholder = "email@empresa.com e Enter",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const e = raw.trim().toLowerCase();
    if (!e) return;
    if (!EMAIL_RE.test(e)) return;
    if (value.includes(e)) return;
    onChange([...value, e]);
    setDraft("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((g) => (
            <Badge key={g} variant="secondary" className="text-[10px] gap-1 pr-1">
              {g}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== g))}
                className="hover:text-destructive"
                aria-label={`Remover ${g}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => commit(draft)}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    </div>
  );
}
