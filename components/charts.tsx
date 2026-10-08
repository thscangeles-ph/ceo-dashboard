"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { count, peso } from "@/lib/analyze";

const axisTick = { fill: "var(--ink-soft)", fontSize: 11, fontFamily: "var(--font-mono-stack)" };
const tooltipStyle = { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--ink)", fontSize: 12 };
const compactPeso = (value: number) => (value >= 1_000_000 ? `₱${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `₱${Math.round(value / 1000)}k` : `₱${value}`);

/** Ranked horizontal bars with the value written beside each bar. Wraps cleanly on phones. */
type ChartClick = { activeTooltipIndex?: number | string | null; activeIndex?: number | string | null } | null | undefined;
/** Recharts reports the hovered column on click; this turns it into a data index. */
const clickedIndex = (state: ChartClick) => {
  const index = Number(state?.activeTooltipIndex ?? state?.activeIndex);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

/** Ranked horizontal bars with the value written beside each bar. Wraps cleanly on phones. Each bar is a button when onSelect is given. */
export function RankedBars({ items, color, format = peso, label, onSelect }: { items: { name: string; value: number; note?: string }[]; color: string; format?: (v: number) => string; label: string; onSelect?: (name: string) => void }) {
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return (
    <ul className="ranked" aria-label={label}>
      {items.map((item) => {
        const content = (
          <>
            <div className="ranked-head"><span className="ranked-name">{item.name}</span><span className="ranked-value">{format(item.value)}{item.note && <small> · {item.note}</small>}</span></div>
            <div className="ranked-track"><div className="ranked-fill" style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 0.8 : 0)}%`, background: color }} /></div>
          </>
        );
        return (
          <li key={item.name}>
            {onSelect
              ? <button type="button" className="ranked-btn" onClick={() => onSelect(item.name)} title={`${item.name}: ${format(item.value)} · click for details`}>{content}</button>
              : <div title={`${item.name}: ${format(item.value)}`}>{content}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/** A 100% stacked bar showing part-to-whole, with a legend that names every part. */
export function MixBar({ parts, label, onSelect }: { parts: { key: string; label: string; color: string; value: number; note: string }[]; label: string; onSelect?: (key: string) => void }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  return (
    <div className="mix">
      <div className="mix-bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${((p.value / total) * 100).toFixed(1)} percent`).join(", ")}`}>
        {parts.map((p) => {
          const share = (p.value / total) * 100;
          // Each slot has a matching "-text" token so labels stay readable on black, gold and nude fills.
          const style = { width: `${share}%`, background: p.color, color: p.color.replace(/\)$/, "-text)") };
          const text = share >= 11 ? `${share.toFixed(1)}%` : "";
          return onSelect
            ? <button type="button" key={p.key} tabIndex={-1} aria-hidden onClick={() => onSelect(p.key)} title={`${p.label}: ${peso(p.value)} (${share.toFixed(1)}%) · click for details`} style={style}>{text}</button>
            : <span key={p.key} title={`${p.label}: ${peso(p.value)} (${share.toFixed(1)}%)`} style={style}>{text}</span>;
        })}
      </div>
      <div className="mix-legend">
        {parts.map((p) => {
          const content = <><i style={{ background: p.color }} />{p.label} <b>{peso(p.value)}</b> · {p.note}</>;
          return onSelect
            ? <button type="button" key={p.key} className="legend-btn" onClick={() => onSelect(p.key)} title="Click for details">{content}</button>
            : <span key={p.key}>{content}</span>;
        })}
      </div>
    </div>
  );
}

export function DailyChart({ data, metric, onSelect }: { data: { label: string; patients: number; revenue: number }[]; metric: "patients" | "revenue"; onSelect?: (index: number) => void }) {
  const isRevenue = metric === "revenue";
  return (
    <div className={`chart-box${onSelect ? " is-clickable" : ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} onClick={(state: ChartClick) => { const i = clickedIndex(state); if (i !== null) onSelect?.(i); }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--line)" }} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={isRevenue ? 48 : 28} allowDecimals={false} tickFormatter={isRevenue ? compactPeso : undefined} />
          <Tooltip cursor={{ fill: "var(--line)", opacity: 0.4 }} contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} formatter={(value) => (isRevenue ? [peso(Number(value)), "Revenue"] : [count(Number(value)), "Patients"])} labelFormatter={(label) => (onSelect ? `${label} · click for details` : label)} />
          <Bar dataKey={metric} fill={isRevenue ? "var(--s2)" : "var(--s1)"} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ServiceChart({ data, onSelect }: { data: { name: string; revenue: number }[]; onSelect?: (index: number) => void }) {
  return (
    <div className={`chart-box${onSelect ? " is-clickable" : ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} onClick={(state: ChartClick) => { const i = clickedIndex(state); if (i !== null) onSelect?.(i); }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="name" tick={{ ...axisTick, fontFamily: "var(--font-sans-stack)", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "var(--line)" }} interval={0} tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={compactPeso} />
          <Tooltip cursor={{ fill: "var(--line)", opacity: 0.4 }} contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} formatter={(value) => [peso(Number(value)), "Revenue"]} labelFormatter={(label) => (onSelect ? `${label} · click for details` : label)} />
          <Bar dataKey="revenue" fill="var(--s2)" radius={[4, 4, 0, 0]} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
