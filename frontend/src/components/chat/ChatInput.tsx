/**
 * The composer.
 *
 * Enter sends, Shift+Enter opens a line, and while a generation is open the
 * send button becomes Stop - which aborts the request itself, not just the
 * spinner. The textarea grows with the text up to a ceiling, then scrolls.
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";

const MAX_HEIGHT = 180;

export function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  generating,
  disabled,
  placeholder = "Ask about your automations, services or recent activity…",
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  generating: boolean;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Autosize: reset first so the box also shrinks when text is deleted.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!generating && value.trim()) onSend();
    }
  }

  return (
    <div className="border-t border-border bg-bg/80 px-4 py-3 backdrop-blur md:px-6">
      <div
        className={cn(
          "mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-border bg-surface p-2 transition-colors",
          "focus-within:border-brand/60 focus-within:ring-2 focus-within:ring-brand/20",
        )}
      >
        <label className="sr-only" htmlFor="assistant-input">
          Message the assistant
        </label>
        <textarea
          id="assistant-input"
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="max-h-[180px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-fg outline-none placeholder:text-muted/70 disabled:opacity-50"
        />
        {generating ? (
          <Button variant="outline" onClick={onStop} className="shrink-0" aria-label="Stop generating">
            Stop
          </Button>
        ) : (
          <Button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            className="shrink-0"
            aria-label="Send message"
          >
            Send
          </Button>
        )}
      </div>
      <p className="mx-auto mt-2 w-full max-w-3xl text-[11px] text-muted">
        {hint ?? "Enter to send · Shift+Enter for a new line"}
      </p>
    </div>
  );
}
