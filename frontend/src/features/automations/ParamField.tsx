import { useRef } from "react";
import type { BlockParam } from "@/api/platform";
import { Switch } from "@/components/ui";
import { cn } from "@/utils/cn";

const WEEKDAYS = [
  ["1", "Monday"],
  ["2", "Tuesday"],
  ["3", "Wednesday"],
  ["4", "Thursday"],
  ["5", "Friday"],
  ["6", "Saturday"],
  ["7", "Sunday"],
];

/**
 * One block parameter. Templated text fields offer the fields produced by the
 * earlier blocks as one-tap chips that insert `{{field}}` at the cursor.
 */
export function ParamField({
  param,
  value,
  onChange,
  fields,
  id,
  invalid,
}: {
  param: BlockParam;
  value: unknown;
  onChange: (v: unknown) => void;
  fields: string[];
  id: string;
  invalid?: boolean;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const str = value == null ? "" : String(value);
  const cls = cn("input", invalid && "border-danger/60 focus:border-danger focus:ring-danger/15");

  function insert(field: string) {
    const token = `{{${field}}}`;
    const el = ref.current;
    if (!el) return onChange(str + token);
    const start = el.selectionStart ?? str.length;
    const end = el.selectionEnd ?? str.length;
    const next = str.slice(0, start) + token + str.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  let control;
  switch (param.type) {
    case "textarea":
      control = <textarea ref={ref} id={id} rows={3} className={cn(cls, "resize-y")} value={str} placeholder={param.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "select":
      control = (
        <select id={id} className={cls} value={str} onChange={(e) => onChange(e.target.value)}>
          {param.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "weekday":
      control = (
        <select id={id} className={cls} value={str || "1"} onChange={(e) => onChange(e.target.value)}>
          {WEEKDAYS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      );
      break;
    case "time":
      control = <input id={id} type="time" className={cls} value={str} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "number":
      control = <input id={id} type="number" className={cls} value={str} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />;
      break;
    case "bool":
      control = <Switch checked={!!value} onChange={onChange} label={param.label} />;
      break;
    default:
      control = <input ref={ref} id={id} className={cls} value={str} placeholder={param.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div>
      <label htmlFor={id} className="label">
        {param.label}
        {param.required && <span className="text-danger"> *</span>}
      </label>
      {control}
      {param.templated && fields.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-subtle">Insert:</span>
          {fields.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => insert(f)}
              className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted ring-1 ring-inset ring-border transition hover:text-brand hover:ring-brand/40"
            >
              {f}
            </button>
          ))}
        </div>
      )}
      {param.help && <p className="mt-1 text-xs text-subtle">{param.help}</p>}
    </div>
  );
}
