/**
 * One turn in the transcript, plus the confirmation card when the assistant
 * proposed an operation.
 *
 * The card is the only route from a model reply to a state change: the button
 * calls the real endpoint named underneath it, and until someone presses it
 * nothing has happened. A proposal the panel cannot honour says so instead of
 * offering a button that would do nothing.
 */
import type { ChatTurn } from "@/ai/conversations";
import type { ActionProposal } from "@/ai/actions";
import type { AskAction } from "@/api/platform";
import { Link } from "react-router-dom";
import { Markdown } from "@/components/Markdown";
import { Button, Spinner } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatTime } from "@/utils/format";

function AssistantMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand ring-1 ring-inset ring-brand/25",
        className,
      )}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    </span>
  );
}

function ActionCard({
  turnId,
  action,
  onConfirm,
  onCancel,
}: {
  turnId: string;
  action: NonNullable<ChatTurn["action"]>;
  onConfirm: (turnId: string, proposal: ActionProposal) => void;
  onCancel: (turnId: string, proposal: ActionProposal) => void;
}) {
  const { proposal, state, message } = action;
  const unsupported = proposal.kind === "unsupported";

  return (
    <div
      className={cn(
        "mt-3 rounded-xl border bg-surface-2/60 p-3.5",
        state === "done" && "border-ok/30",
        state === "failed" && "border-danger/30",
        state !== "done" && state !== "failed" && "border-border",
      )}
    >
      <p className="eyebrow">{unsupported ? "Not available" : "AI wants to run"}</p>
      <p className="mt-1.5 text-sm font-semibold text-fg">{proposal.title}</p>
      {proposal.subject && <p className="text-sm text-muted">{proposal.subject}</p>}

      {state === "pending" && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {!unsupported && (
              <Button size="sm" onClick={() => onConfirm(turnId, proposal)}>
                {proposal.mutating ? proposal.title : "Run check"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onCancel(turnId, proposal)}>
              {unsupported ? "Dismiss" : "Cancel"}
            </Button>
          </div>
          {!unsupported && (
            <p className="mt-2 font-mono text-[11px] text-muted">{proposal.endpoint}</p>
          )}
        </>
      )}

      {state === "running" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Spinner className="h-3.5 w-3.5" /> Running…
        </p>
      )}

      {(state === "done" || state === "failed" || state === "cancelled") && message && (
        <p
          className={cn(
            "mt-3 text-xs",
            state === "done" && "text-ok",
            state === "failed" && "text-danger",
            state === "cancelled" && "text-muted",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}

/** The structured part of an answer: sections (email, calendar, deadlines, problems) and buttons. */
function StructuredAnswer({ data, onAction }: { data: NonNullable<ChatTurn["structured"]>; onAction?: (a: AskAction) => void }) {
  const BADGE: Record<string, string> = {
    urgent: "bg-danger/10 text-danger", high: "bg-danger/10 text-danger", critical: "bg-danger/10 text-danger",
    medium: "bg-warn/10 text-warn", overdue: "bg-danger/10 text-danger", normal: "bg-info/10 text-info",
  };
  return (
    <div className="mt-3 space-y-3">
      {data.title && <p className="text-sm font-semibold text-fg">{data.title}</p>}
      {data.sections.map((s) => (
        <section key={s.key} aria-label={s.title} className="rounded-xl border border-border bg-surface-2/50 p-3">
          <h4 className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
            <span>{s.title}</span>
            <span className="font-normal normal-case tracking-normal text-muted">{s.summary}</span>
          </h4>
          {s.items.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {s.items.map((it, i) => {
                const inner = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{it.title}</span>
                      {it.subtitle && <span className="block truncate text-xs text-muted">{it.subtitle}</span>}
                    </span>
                    {it.badge && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", BADGE[it.badge] ?? "bg-surface-2 text-muted")}>{it.badge}</span>}
                  </>
                );
                return (
                  <li key={`${it.title}-${i}`}>
                    {it.href ? (
                      it.href.startsWith("http") ? (
                        <a href={it.href} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-2">{inner}</a>
                      ) : (
                        <Link to={it.href} className="flex items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-2">{inner}</Link>
                      )
                    ) : (
                      <div className="flex items-center gap-2 px-1 py-0.5">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
      {data.notes.map((n) => (
        <p key={n} className="text-xs text-warn">{n}</p>
      ))}
      {data.actions.length > 0 && onAction && (
        <div className="flex flex-wrap gap-2">
          {data.actions.map((a) => (
            <Button key={a.label} size="sm" variant="secondary" onClick={() => onAction(a)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatMessage({
  turn,
  onConfirm,
  onCancel,
  onAction,
}: {
  turn: ChatTurn;
  onConfirm: (turnId: string, proposal: ActionProposal) => void;
  onCancel: (turnId: string, proposal: ActionProposal) => void;
  onAction?: (a: AskAction) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="animate-in-msg flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md border border-border bg-surface-2 px-4 py-2.5 md:max-w-[72%]">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{turn.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in-msg flex gap-3">
      <AssistantMark />
      <div className="min-w-0 flex-1">
        {turn.failed ? (
          <p className="text-sm italic text-muted">{turn.content}</p>
        ) : (
          <Markdown content={turn.content} />
        )}

        {turn.structured && <StructuredAnswer data={turn.structured} onAction={onAction} />}

        {turn.action && (
          <ActionCard turnId={turn.id} action={turn.action} onConfirm={onConfirm} onCancel={onCancel} />
        )}

        {turn.sources && turn.sources.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="uppercase tracking-wider">Fuentes</span>
            {turn.sources.map((s) => (
              <span
                key={s.module}
                className="rounded-full border border-border px-2 py-0.5"
                title={`${s.count} elemento(s) leídos de las ejecuciones de n8n`}
              >
                {s.label} · {s.count}
              </span>
            ))}
          </p>
        )}

        {turn.meta && (
          <p className="mt-2 text-[11px] text-muted">
            {turn.meta.provider} · {turn.meta.model} · {turn.meta.latencyMs} ms
            {turn.meta.usedFallback && " · answered by the fallback provider"}
            {turn.at && ` · ${formatTime(turn.at)}`}
          </p>
        )}
      </div>
    </div>
  );
}

/** The "thinking" row, shown while a request is open. */
export function ChatPending({ stage = "generating" }: { stage?: "consulting" | "generating" }) {
  return (
    <div className="animate-in-fade flex gap-3" aria-live="polite">
      <AssistantMark />
      <div className="flex items-center gap-2 pt-1.5 text-sm text-muted">
        <span className="flex gap-1" aria-hidden="true">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
        </span>
        {stage === "consulting" ? "Consultando los resultados de tus automatizaciones…" : "Thinking…"}
      </div>
    </div>
  );
}
