"use client";
/* What a helper is doing now. Helpers don't sleep: between jobs nothing runs, and they start the moment work arrives. */

export type HState = { state?: string; next_job?: { name: string; at: string } | null; status?: string };

const when = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / 86400000);
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return days === 0 ? `today ${t}` : days === 1 ? `tomorrow ${t}` : `${d.toLocaleDateString([], { weekday: "short" })} ${t}`;
};

export function stateOf(h: HState): string {
  return h.status && h.status !== "active" ? "paused" : h.state || "ready";
}

export default function HelperState({ h, compact }: { h: HState; compact?: boolean }) {
  const s = stateOf(h);
  if (s === "working") return <span className="chip run"><i className="ri-loader-4-line" />Working</span>;
  if (s === "waiting") return <span className="chip warn"><i className="ri-hourglass-line" />Job queued</span>;
  if (s === "paused") return <span className="chip warn"><i className="ri-pause-line" />Paused</span>;
  return (
    <span className="chip up" title={h.next_job ? `Next regular job: ${h.next_job.name}, ${when(h.next_job.at)}` : "Ready for work"}>
      <i className="ri-checkbox-blank-circle-fill" style={{ fontSize: 8 }} />Ready{!compact && h.next_job ? <span className="chip-sub"> · next {when(h.next_job.at)}</span> : null}
    </span>
  );
}
