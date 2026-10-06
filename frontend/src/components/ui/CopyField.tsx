import { useState } from "react";
import { cn } from "@/utils/cn";

/** A read-only value with a copy button (redirect URIs, ids). Never for secrets. */
export function CopyField({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2", className)}>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg" title={value}>
        {value}
      </code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable (http, iframe): the value stays selectable */
          }
        }}
        className={cn(
          "shrink-0 rounded-lg px-2 py-0.5 text-xs font-medium transition",
          copied ? "bg-ok/15 text-ok" : "text-brand hover:bg-brand/10",
        )}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
