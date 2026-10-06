/**
 * Seven days of runs as stacked bars (success / failed), plus an AI line.
 * Plain SVG: no chart library, crisp at any size, colours from tokens.
 */
import { useState } from "react";

export function WeekChart({
  series,
  ai,
}: {
  series: { date: string; success: number; error: number }[];
  ai?: { date: string; requests: number }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((d) => d.success + d.error));
  const aiMax = Math.max(1, ...(ai ?? []).map((d) => d.requests));
  const W = 560;
  const H = 150;
  const pad = 8;
  const bw = (W - pad * 2) / series.length;
  const label = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });
  const empty = series.every((d) => d.success + d.error === 0);

  const aiPoints = (ai ?? []).map((d, i) => {
    const x = pad + bw * i + bw / 2;
    const y = H - 22 - ((H - 40) * d.requests) / aiMax;
    return `${x},${y}`;
  });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[170px] w-full" role="img" aria-label="Runs per day for the last seven days">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad} x2={W - pad} y1={(H - 22) * f} y2={(H - 22) * f} stroke="rgb(var(--c-border))" strokeDasharray="3 4" />
        ))}
        {series.map((d, i) => {
          const total = d.success + d.error;
          const h = ((H - 40) * total) / max;
          const he = total ? (h * d.error) / total : 0;
          const x = pad + bw * i + bw * 0.22;
          const w = bw * 0.56;
          const y = H - 22 - h;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad + bw * i} y={0} width={bw} height={H - 22} fill="transparent" />
              {total === 0 ? (
                <rect x={x} y={H - 24} width={w} height={2} rx={1} fill="rgb(var(--c-border-strong))" />
              ) : (
                <>
                  <rect x={x} y={y} width={w} height={h - he} rx={5} fill="rgb(var(--c-brand))" opacity={hover === i ? 1 : 0.85} />
                  {he > 0 && <rect x={x} y={y + h - he} width={w} height={he} rx={3} fill="rgb(var(--c-danger))" />}
                </>
              )}
              <text x={pad + bw * i + bw / 2} y={H - 6} textAnchor="middle" className="fill-[rgb(var(--c-subtle))] text-[11px]">
                {label(d.date)}
              </text>
            </g>
          );
        })}
        {aiPoints.length > 1 && (
          <polyline points={aiPoints.join(" ")} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={2} strokeLinejoin="round" opacity={0.9} />
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-border bg-surface-3 px-2.5 py-1.5 text-xs shadow-elev-2"
          style={{ left: `${((hover + 0.5) / series.length) * 100}%`, transform: "translateX(-50%)" }}
        >
          <p className="font-medium text-fg">{label(series[hover].date)}</p>
          <p className="text-muted">
            {series[hover].success} ok · <span className="text-danger">{series[hover].error} failed</span>
            {ai?.[hover] ? ` · ${ai[hover].requests} AI` : ""}
          </p>
        </div>
      )}
      {empty && (
        <p className="absolute inset-0 grid place-items-center text-sm text-subtle">No runs in the last seven days yet.</p>
      )}
    </div>
  );
}
