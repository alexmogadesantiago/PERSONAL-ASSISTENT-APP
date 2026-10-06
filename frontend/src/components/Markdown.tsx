/**
 * A small Markdown renderer for assistant replies.
 *
 * Deliberately hand-written rather than a dependency: it renders React
 * elements, never HTML strings, so there is no `dangerouslySetInnerHTML` and no
 * path by which model output could inject markup. Anything it does not
 * understand falls through as plain text - the worst case is an unstyled
 * paragraph, not an execution surface.
 *
 * Supported: headings, bullet and numbered lists, tables, fenced code,
 * blockquotes, rules, and inline bold, italic, code and links.
 */
import { Fragment, type ReactNode } from "react";
import { cn } from "@/utils/cn";

/* ------------------------------- inline -------------------------------- */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\))/g;

/** Only http(s) survives; anything else renders as text, javascript: included. */
function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw, window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pieces = text.split(INLINE);
  pieces.forEach((piece, i) => {
    if (!piece) return;
    const key = `${keyPrefix}-${i}`;
    if (piece.startsWith("**") && piece.endsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-fg">
          {piece.slice(2, -2)}
        </strong>,
      );
    } else if (piece.startsWith("`") && piece.endsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-fg">
          {piece.slice(1, -1)}
        </code>,
      );
    } else if (piece.startsWith("*") && piece.endsWith("*")) {
      out.push(
        <em key={key} className="italic">
          {piece.slice(1, -1)}
        </em>,
      );
    } else if (piece.startsWith("[")) {
      const match = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
      const href = match ? safeHref(match[2]) : null;
      if (match && href) {
        out.push(
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
          >
            {match[1]}
          </a>,
        );
      } else {
        out.push(<Fragment key={key}>{piece}</Fragment>);
      }
    } else {
      out.push(<Fragment key={key}>{piece}</Fragment>);
    }
  });
  return out;
}

/* -------------------------------- block -------------------------------- */

const FENCE = "```";

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");
}

function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (line.trim().startsWith(FENCE)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(FENCE)) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre
          key={`code-${key++}`}
          className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed"
        >
          <code className="font-mono text-fg">{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // horizontal rule
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<div key={`hr-${key++}`} className="my-1 h-px bg-border" />);
      i += 1;
      continue;
    }

    // heading
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(
        <p
          key={`h-${key++}`}
          className={cn("font-semibold text-fg", level <= 2 ? "text-[15px]" : "text-sm")}
        >
          {renderInline(heading[2], `h${key}`)}
        </p>,
      );
      i += 1;
      continue;
    }

    // table
    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`table-${key++}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi} className="border-b border-border px-2 py-1.5 text-left font-semibold text-muted">
                    {renderInline(h, `th-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci} className="border-b border-border/60 px-2 py-1.5 align-top text-fg">
                      {renderInline(c, `td-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`quote-${key++}`} className="border-l-2 border-brand/50 pl-3 text-muted">
          {renderInline(body.join(" "), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // lists
    const bullet = /^\s*[-*•]\s+(.*)$/;
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/;
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line);
      const items: string[] = [];
      while (i < lines.length && (bullet.test(lines[i]) || ordered.test(lines[i]))) {
        const m = isOrdered ? ordered.exec(lines[i]) : bullet.exec(lines[i]);
        items.push(isOrdered ? m?.[2] ?? "" : m?.[1] ?? "");
        i += 1;
      }
      blocks.push(
        isOrdered ? (
          <ol key={`ol-${key++}`} className="ml-4 list-decimal space-y-1 marker:text-muted">
            {items.map((item, ii) => (
              <li key={ii} className="pl-1">
                {renderInline(item, `oli-${ii}`)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={`ul-${key++}`} className="space-y-1">
            {items.map((item, ii) => (
              <li key={ii} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" />
                <span className="min-w-0">{renderInline(item, `li-${ii}`)}</span>
              </li>
            ))}
          </ul>
        ),
      );
      continue;
    }

    // paragraph
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith(FENCE) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={`p-${key++}`}>{renderInline(para.join(" "), `p${key}`)}</p>);
  }

  return <div className={cn("space-y-2.5 text-sm leading-relaxed text-fg/90", className)}>{blocks}</div>;
}
