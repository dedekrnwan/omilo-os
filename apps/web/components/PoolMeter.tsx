"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/poll";

/* The Claude Code pool at a glance: one short bar per account, side by side, filled by how much of its
   5-hour limit it has used. Hover or tap for the details. */

type Win = { pct: number | null; status: string; resets_at: string | null; source: string | null };
type Acc = { id: string; label: string; state: string; busy: number; tokens_5h: number; five_hour: Win; weekly: Win | null; last_error: string };
export type Meter = { accounts: Acc[]; ready: number; total: number; busy: number; avg_pct: number | null };

const level = (a: Acc) => {
  if (a.state === "disabled") return "off";
  if (a.state === "error") return "err";
  if (a.state === "cooling") return "rest";
  const p = a.five_hour.pct;
  if (p == null) return "unknown";
  return p >= 90 ? "high" : p >= 70 ? "mid" : "low";
};
const until = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso), mins = Math.round((d.getTime() - Date.now()) / 60000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  if (mins < 24 * 60) return `at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
};
const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function line(a: Acc): string {
  if (a.state === "disabled") return "Turned off";
  if (a.state === "error") return "Needs sign-in again";
  if (a.state === "cooling") return `Limit reached · back ${until(a.five_hour.resets_at)}`;
  const p = a.five_hour.pct;
  const used = p == null ? `${fmtTok(a.tokens_5h)} tokens in the last 5 h` : `${p}% of the 5-hour limit${a.five_hour.source === "estimate" ? " (estimate)" : ""}`;
  const reset = a.five_hour.resets_at ? ` · resets ${until(a.five_hour.resets_at)}` : "";
  return used + reset;
}

export function useMeter() {
  const [m, setM] = useState<Meter | null>(null);
  usePoll(async () => setM(await api<Meter>("/harness/meter")), () => (m?.busy ? 10000 : 30000), [],
    (n) => n?.kind === "local" || n?.kind === "reply" || String(n?.kind).startsWith("job"));
  return m;
}

export function Segments({ m, big = false }: { m: Meter; big?: boolean }) {
  return (
    <span className={`psegs ${big ? "big" : ""}`} style={{ ["--n" as string]: m.accounts.length }}>
      {m.accounts.map((a) => {
        const lv = level(a);
        const pct = lv === "rest" ? 100 : lv === "off" || lv === "err" ? 0 : a.five_hour.pct ?? 0;
        return (
          <span key={a.id} className={`pseg ${lv} ${a.busy ? "busy" : ""}`} title={`${a.label}: ${line(a)}`}>
            <i style={{ width: `${Math.max(pct, lv === "unknown" ? 0 : 4)}%` }} />
          </span>
        );
      })}
    </span>
  );
}

export default function PoolMeter() {
  const m = useMeter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!m || m.total === 0) return null;
  const resting = m.accounts.filter((a) => a.state === "cooling").length;
  return (
    <div className="pmeter" ref={box} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="pm-btn" aria-label={`Claude Code pool: ${m.ready} of ${m.total} accounts ready`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="pm-l">Claude Code pool</span>
        <Segments m={m} />
        <span className="pm-n">{m.ready}/{m.total} ready</span>
        <span className="pm-r">{m.busy ? `${m.busy} working · ` : ""}{resting ? `${resting} resting · ` : ""}{m.avg_pct != null ? `avg ${m.avg_pct}% used` : "usage not reported yet"}</span>
      </button>
      {open && (
        <div className="pm-pop" role="dialog" aria-label="Claude Code pool usage">
          <div className="pm-head">
            <b>Claude Code pool</b>
            <span className="small">{m.ready} ready{m.busy ? ` · ${m.busy} working` : ""}{resting ? ` · ${resting} resting` : ""}{m.avg_pct != null ? ` · avg ${m.avg_pct}%` : ""}</span>
          </div>
          <div className="pm-list">
            {m.accounts.map((a) => (
              <div key={a.id} className="pm-row">
                <span className="pm-name">{a.label}{a.busy ? <span className="chip run" style={{ marginLeft: 6 }}>{a.busy} working</span> : null}</span>
                <span className={`pseg wide ${level(a)}`}><i style={{ width: `${level(a) === "rest" ? 100 : a.five_hour.pct ?? 0}%` }} /></span>
                <span className="small">{line(a)}{a.weekly?.pct != null ? ` · week ${a.weekly.pct}%` : ""}</span>
              </div>
            ))}
          </div>
          <div className="pm-foot small">
            Exact numbers come from Claude Code when it reports them; otherwise Omilo estimates from tokens used and what each account handled before its last limit.
            <Link href="/harness/">Manage pool</Link>
          </div>
        </div>
      )}
    </div>
  );
}
