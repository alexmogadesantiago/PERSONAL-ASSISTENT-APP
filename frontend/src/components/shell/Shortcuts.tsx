/**
 * Keyboard shortcuts.
 *
 *   Ctrl/⌘ K   command palette / search
 *   Ctrl/⌘ /   this list (also "?")
 *   G then H   Home        G then I   Inbox
 *   G then A   Automations G then T   Integrations
 *
 * Chords are ignored while typing in a field, and "G" expires after 1.2 s so a
 * stray key never navigates later.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Kbd } from "@/components/ui";
import { Modal } from "@/components/ui/Modal";

export const CHORDS: Record<string, { to: string; label: string }> = {
  h: { to: "/dashboard", label: "Home" },
  i: { to: "/inbox", label: "Inbox" },
  a: { to: "/automations", label: "Automations" },
  t: { to: "/integrations", label: "Integrations" },
};

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "K"], label: "Search and commands" },
  { keys: ["Ctrl", "/"], label: "Keyboard shortcuts" },
  { keys: ["G", "H"], label: "Go to Home" },
  { keys: ["G", "I"], label: "Go to Inbox" },
  { keys: ["G", "A"], label: "Go to Automations" },
  { keys: ["G", "T"], label: "Go to Integrations" },
  { keys: ["Esc"], label: "Close a dialog or panel" },
];

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function useGlobalShortcuts({ onPalette, onHelp }: { onPalette: () => void; onHelp: () => void }) {
  const navigate = useNavigate();
  const armed = useRef<number>(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onPalette();
        return;
      }
      if ((mod && e.key === "/") || (!mod && e.key === "?" && !typing(e.target))) {
        e.preventDefault();
        onHelp();
        return;
      }
      if (mod || e.altKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "g") {
        armed.current = Date.now();
        return;
      }
      if (armed.current && Date.now() - armed.current < 1200 && CHORDS[key]) {
        e.preventDefault();
        armed.current = 0;
        navigate(CHORDS[key].to);
        return;
      }
      armed.current = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, onPalette, onHelp]);
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" size="sm">
      <ul className="divide-y divide-border">
        {SHORTCUTS.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 py-2.5 text-sm">
            <span className="text-fg">{s.label}</span>
            <span className="flex items-center gap-1">
              {s.keys.map((k, i) => (
                <span key={k} className="flex items-center gap-1">
                  {i > 0 && <span className="text-xs text-subtle">then</span>}
                  <Kbd>{k}</Kbd>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
