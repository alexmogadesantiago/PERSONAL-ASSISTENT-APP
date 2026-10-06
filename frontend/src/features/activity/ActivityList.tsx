import { Link } from "react-router-dom";
import type { ActivityItem } from "@/api/platform";
import { cn } from "@/utils/cn";
import { formatTime, relativeTime } from "@/utils/format";
import { IActivity, IAlert, IBolt, ICheck, IPlug, IShield, ISparkles, IX } from "@/components/icons2";

const CATEGORY_ICON = {
  automations: IBolt,
  ai: ISparkles,
  integrations: IPlug,
  errors: IAlert,
  security: IShield,
  system: IActivity,
} as const;

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function ResultDot({ result }: { result: ActivityItem["result"] }) {
  if (result === "success") return <ICheck width={12} height={12} className="text-ok" />;
  if (result === "error") return <IX width={12} height={12} className="text-danger" />;
  if (result === "running")
    return (
      <span className="relative flex h-2 w-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-info/60" />
        <span className="relative h-2 w-2 rounded-full bg-info" />
      </span>
    );
  return <span className="h-2 w-2 rounded-full bg-warn" />;
}

export function ActivityRow({ item, dense }: { item: ActivityItem; dense?: boolean }) {
  const Icon = CATEGORY_ICON[item.category] ?? IActivity;
  const body = (
    <div className={cn("group flex items-center gap-3 rounded-xl px-2 transition", dense ? "py-2" : "py-2.5", item.link && "hover:bg-surface-2/70")}>
      <span
        className={cn(
          "relative grid h-8 w-8 shrink-0 place-items-center rounded-xl",
          item.result === "error" ? "bg-danger/10 text-danger" : item.category === "ai" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted",
        )}
      >
        <Icon width={15} height={15} />
        <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-surface ring-2 ring-surface">
          <ResultDot result={item.result} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg">
          <span className="font-medium">{item.title}</span>
          {item.message && <span className="text-muted"> · {item.message}</span>}
        </p>
        {!dense && (
          <p className="truncate text-xs text-subtle">
            {[item.service, item.duration_ms != null ? formatMs(item.duration_ms) : null].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <time className="shrink-0 text-xs tabular-nums text-subtle" title={item.at ?? ""} dateTime={item.at ?? undefined}>
        {dense ? formatTime(item.at) : relativeTime(item.at)}
      </time>
    </div>
  );
  return item.link ? <Link to={item.link}>{body}</Link> : body;
}
