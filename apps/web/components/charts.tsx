"use client";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/* Charts for the Monitor page (Recharts). Thin bars with rounded tops anchored to the baseline, a 2px surface
   gap between stacked segments, a recessive grid, hover/keyboard tooltips, a legend for 2+ series, and a table view. */

// categorical slots in fixed order (validated: adjacent CVD ΔE ≥ 9.1, normal-vision ≥ 19.6 on the light surface)
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
export const OTHER = "#a8a29e";
export const STATUS = { good: "#0ca30c", critical: "#d03b3b", warning: "#fab219" };

export type Series = { key: string; label: string; color: string; values: number[] };

export const fmtNum = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

export function Legend({ series, kind = "rect" }: { series: { label: string; color: string; icon?: string }[]; kind?: "rect" | "line" }) {
  if (series.length < 2) return null;
  return (
    <div className="lg">
      {series.map((s) => (
        <span key={s.label} className="lg-i">
          {s.icon ? <i className={s.icon} style={{ color: s.color }} /> : <span className={`lg-k ${kind}`} style={{ background: s.color }} />}
          {s.label}
        </span>
      ))}
    </div>
  );
}

type Row = Record<string, number | string> & { _i: number; _top: string; _bottom: string; _total: number };

/** Custom bar segment: rounded 4px top only on the topmost segment, square at the baseline, and a 2px surface
    gap under every segment that sits on another one. */
function Segment(props: any) {
  const { x, y, width, height, fill, payload, dataKey } = props;
  if (!height || height <= 0 || !payload) return null;
  const gap = payload._bottom !== dataKey ? 2 : 0;
  const h = Math.max(1, height - gap);
  if (payload._top !== dataKey) return <rect x={x} y={y} width={width} height={h} fill={fill} />;
  const r = Math.min(4, width / 2, h);
  return <path d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + h} Z`} fill={fill} />;
}

function Tip({ active, payload, series, format, unit }: any) {
  if (!active || !payload?.length) return null;
  const row: Row = payload[0].payload;
  if (!row._total) return null;
  return (
    <div className="tip static">
      <div className="tip-h">{row._label as string}</div>
      <div className="tip-total"><b>{format(row._total)}{unit}</b> total</div>
      {(series as Series[]).filter((s) => Number(row[s.key])).sort((a, b) => Number(row[b.key]) - Number(row[a.key])).map((s) => (
        <div key={s.key} className="tip-r"><span className="tip-k" style={{ background: s.color }} /><b>{format(Number(row[s.key]))}</b><span>{s.label}</span></div>
      ))}
    </div>
  );
}

export function StackedBars({ labels, tipLabels, series, height = 210, format = fmtNum, unit = "", empty = "Nothing in this period yet." }: {
  labels: string[]; tipLabels?: string[]; series: Series[]; height?: number; format?: (n: number) => string; unit?: string; empty?: string;
}) {
  const rows: Row[] = useMemo(() => labels.map((l, i) => {
    const r: any = { _i: i, _x: l, _label: tipLabels?.[i] || l };
    let total = 0, top = "", bottom = "";
    for (const s of series) {
      const v = s.values[i] || 0;
      r[s.key] = v;
      if (v > 0) { total += v; top = s.key; if (!bottom) bottom = s.key; }
    }
    r._total = total; r._top = top; r._bottom = bottom;
    return r;
  }), [labels, tipLabels, series]);
  const allZero = rows.every((r) => !r._total);
  const n = labels.length;
  return (
    <div className="chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} barCategoryGap={n > 20 ? "22%" : "34%"} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="rgba(231,229,228,.9)" />
          <XAxis dataKey="_x" tickLine={false} axisLine={{ stroke: "#d6d3d1" }} tick={{ fontSize: 11, fill: "#78716c" }} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#78716c" }} tickFormatter={(v) => format(v)} width={42} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(120,113,108,.08)" }} content={<Tip series={series} format={format} unit={unit} />} isAnimationActive={false} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} maxBarSize={28} shape={<Segment />} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      {allZero && <div className="chart-empty">{empty}</div>}
    </div>
  );
}

export function DataTable({ labels, series, format = fmtNum }: { labels: string[]; series: Series[]; format?: (n: number) => string }) {
  return (
    <div className="tw chart-table"><table>
      <thead><tr><th>When</th>{series.map((s) => <th key={s.key} className="num-cell">{s.label}</th>)}<th className="num-cell">Total</th></tr></thead>
      <tbody>{labels.map((l, i) => {
        const t = series.reduce((a, s) => a + (s.values[i] || 0), 0);
        return t ? <tr key={i}><td>{l}</td>{series.map((s) => <td key={s.key} className="num-cell">{format(s.values[i] || 0)}</td>)}<td className="num-cell"><b>{format(t)}</b></td></tr> : null;
      })}</tbody>
    </table></div>
  );
}

/** Horizontal bars for a short ranked list (tools, helpers). */
export function BarList({ rows, format = fmtNum, color = SERIES[0] }: { rows: { label: string; value: number; note?: string; warn?: boolean }[]; format?: (n: number) => string; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div key={r.label} className="bl-row" title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ""}`}>
          <span className="bl-l">{r.label}</span>
          <span className="bl-track"><span className="bl-bar" style={{ width: `${(r.value / max) * 100}%`, background: color }} /></span>
          <span className="bl-v">{format(r.value)}</span>
          {r.note && <span className={`bl-n ${r.warn ? "warn" : ""}`}>{r.warn && <i className="ri-error-warning-line" />}{r.note}</span>}
        </div>
      ))}
    </div>
  );
}
