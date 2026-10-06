/**
 * Priority, with the reasons. The engine on the backend returns a level and the
 * signals behind it; showing them is what makes the classification explainable.
 */
import type { PriorityLevel, PriorityReason } from "@/api/platform";
import { Badge, type BadgeTone } from "@/components/ui";
import { ICheck } from "@/components/icons2";
import { cn } from "@/utils/cn";

const TONE: Record<PriorityLevel, BadgeTone> = { urgent: "danger", high: "danger", normal: "info", low: "neutral" };

export function levelTone(level: PriorityLevel | null | undefined): BadgeTone {
  return level ? TONE[level] : "neutral";
}

export function PriorityBadge({ level, children }: { level: PriorityLevel; children?: React.ReactNode }) {
  return (
    <Badge tone={TONE[level]} dot>
      {children ?? level}
    </Badge>
  );
}

export function PriorityWhy({ level, reasons, className }: { level: PriorityLevel; reasons: PriorityReason[]; className?: string }) {
  if (!reasons.length) return null;
  return (
    <div className={cn("rounded-xl bg-surface/70 p-3", className)}>
      <p className="text-xs font-medium text-muted">Why {level} priority?</p>
      <ul className="mt-1.5 space-y-1">
        {reasons.map((r) => (
          <li key={r.label} className="flex items-start gap-2 text-sm text-fg">
            {r.positive ? (
              <ICheck width={14} height={14} className="mt-0.5 shrink-0 text-ok" aria-label="raises priority" />
            ) : (
              <span className="mt-0.5 w-3.5 shrink-0 text-center text-subtle" aria-label="lowers priority">
                –
              </span>
            )}
            <span className={cn(!r.positive && "text-muted")}>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
