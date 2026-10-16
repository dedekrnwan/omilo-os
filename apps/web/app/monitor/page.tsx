"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Markdown } from "@/components/Markdown";
import Avatar from "@/components/Avatar";
import { BarList, DataTable, Legend, OTHER, SERIES, STATUS, Series, StackedBars, fmtNum } from "@/components/charts";
import { Segments } from "@/components/PoolMeter";
import { Err } from "@/components/ui";
import { ago, api } from "@/lib/api";
import { kick, usePoll } from "@/lib/poll";
import { helperItems, jobLinkItems } from "@/lib/actions";
import { copy, menu, sep } from "@/lib/menu";

/* Monitor: how the company of helpers is doing. Tokens and spend, jobs, what waits on you, who is working,
   the Claude Code pool and Saga's tools, over one time range. */

type Helper = { id: string; name: string; role: string; is_chief: boolean; state: string; engine: string; current: { task_id: string; brief: string; started_at: string } | null;
  tokens: number; cost_usd: number; runs: number; jobs_done: number; jobs_failed: number; last_active: string | null };
type Win = { pct: number | null; status: string; resets_at: string | null; source: string | null };
type Acc = { id: string; label: string; state: string; busy: number; tokens_5h: number; tokens_range: number; five_hour: Win };
type Data = {
  range: string; unit: "hour" | "day"; timezone: string; buckets: string[];
  kpi: Record<string, any>;
  tokens_by_helper: { staff_id: string; values: number[] }[];
  jobs: { done: number[]; failed: number[] };
  helpers: Helper[];
  tools: { name: string; calls: number; errors: number; blocked: number; avg_ms: number }[];
  pool: { accounts: Acc[]; ready: number; total: number; busy: number; avg_pct: number | null };
  activity: { id: number; at: string; kind: string; title: string; body: string; url: string; level: string }[];
  timing: { helpers: { staff_id: string; name: string; jobs: number; median_s: number; p90_s: number; slowest: { task_id: string; brief: string; seconds: number } | null }[];
    engines: { engine: string; jobs: number; failed: number; fail_rate: number; median_s: number; p90_s: number }[] };
  failures: { key: string; label: string; fix: string; count: number; example: string; jobs: { task_id: string; brief: string; staff: string; at: string }[] }[];
  value: { staff_id: string; name: string; proposals: number; approved: number; rejected: number; changes: number; pending: number; approval_rate: number | null; cost_usd: number; cost_per_approved: number | null }[];
  pool_history: { hours: string[]; hits_7d: number; accounts: { id: string; label: string; tokens: number[]; hits: { hour: number; at: string; resets_at: string | null }[] }[] };
  budgets: Record<string, { budget_usd: number; budget_tokens: number; cost_usd: number; tokens: number; pct: number | null; pct_usd: number | null; pct_tokens: number | null }>;
};
type Digest = { enabled: boolean; last_sent: string | null; send_hour: number; preview: string };

const SEQ = ["#f0eeec", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"]; // sequential blue, light → dark
const durS = (s: number | null | undefined) => (s == null ? "–" : s < 1 ? "<1s" : s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`);

function BudgetBar({ b }: { b?: Data["budgets"][string] }) {
  if (!b || b.pct == null) return <span className="small">no budget</span>;
  const lv = b.pct >= 100 ? "critical" : b.pct >= 80 ? "warning" : "good";
  const icon = lv === "critical" ? "ri-pause-circle-line" : lv === "warning" ? "ri-error-warning-line" : "";
  const label = b.pct_usd != null && (b.pct_tokens == null || b.pct_usd >= b.pct_tokens) ? `${money(b.cost_usd)} of ${money(b.budget_usd)}` : `${fmtNum(b.tokens)} of ${fmtNum(b.budget_tokens)}`;
  return (
    <div className="inl" title={`${Math.round(b.pct)}% of this month's budget`}>
      <span className="inl-bar"><i style={{ width: `${Math.min(100, b.pct)}%`, background: STATUS[lv as keyof typeof STATUS] }} /></span>
      <span className={`small bud ${lv}`}>{icon && <i className={icon} />}{label}</span>
    </div>
  );
}

function PoolHistory({ h }: { h: Data["pool_history"] }) {
  const max = Math.max(1, ...h.accounts.flatMap((a) => a.tokens));
  const step = (v: number) => (v <= 0 ? 0 : Math.min(SEQ.length - 1, 1 + Math.floor((v / max) * (SEQ.length - 1.001))));
  const hl = (i: number) => new Date(h.hours[i]).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="heat">
      {h.accounts.map((a) => (
        <div key={a.id} className="heat-row">
          <span className="heat-l" title={a.label}>{a.label}</span>
          <div className="heat-cells">
            {a.tokens.map((v, i) => {
              const hit = a.hits.find((x) => x.hour === i);
              return (
                <span key={i} className={`heat-c ${hit ? "hit" : ""}`} style={{ background: SEQ[step(v)] }} tabIndex={0}
                  title={`${a.label} · ${hl(i)}: ${fmtNum(v)} tokens${hit ? ` · limit reached${hit.resets_at ? `, back ${new Date(hit.resets_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}` : ""}`} />
              );
            })}
          </div>
        </div>
      ))}
      <div className="heat-axis"><span>{hl(0)}</span><span>{hl(12)}</span><span>now</span></div>
      <div className="lg" style={{ marginTop: 8 }}>
        <span className="lg-i">less <span className="heat-scale">{SEQ.slice(1).map((c) => <i key={c} style={{ background: c }} />)}</span> more tokens</span>
        <span className="lg-i"><i className="ri-error-warning-fill" style={{ color: STATUS.critical }} />limit reached</span>
      </div>
    </div>
  );
}

const RANGES: [string, string][] = [["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];
const STATE: Record<string, [string, string, string]> = {
  working: ["run", "ri-loader-4-line", "Working"], awake: ["up", "ri-sun-line", "Awake"], sleeping: ["idle", "ri-moon-line", "Sleeping"], paused: ["warn", "ri-pause-line", "Paused"],
};
const ICON: Record<string, string> = { inbox: "ri-inbox-2-line", reply: "ri-chat-3-line", job_done: "ri-checkbox-circle-line", job_failed: "ri-error-warning-line" };
const money = (n: number) => (n >= 100 ? `$${Math.round(n)}` : n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(3)}` : "$0");
const mins = (m: number | null) => (m == null ? "–" : m < 60 ? `${m} min` : m < 60 * 48 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);

function Delta({ cur, prev, good = "up" }: { cur: number; prev: number; good?: "up" | "down" }) {
  if (!prev && !cur) return <span className="delta flat">no change</span>;
  if (!prev) return <span className="delta flat">new this period</span>;
  const p = Math.round(((cur - prev) / prev) * 100);
  if (p === 0) return <span className="delta flat">same as before</span>;
  const better = (p > 0) === (good === "up");
  return <span className={`delta ${better ? "good" : "bad"}`}><i className={p > 0 ? "ri-arrow-up-line" : "ri-arrow-down-line"} />{Math.abs(p)}% vs previous</span>;
}

function Tile({ label, value, sub, children, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <div className="label">{label}</div>
      <div className="num">{value}</div>
      {sub && <div className="t-sub">{sub}</div>}
      {children}
    </>
  );
  return href ? <Link href={href} className="stat mtile link">{body}</Link> : <div className="stat mtile">{body}</div>;
}

function DigestCard() {
  const [d, setD] = useState<Digest | null>(null);
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await api<Digest>("/digest")); } catch { /* ignore */ } }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  return (
    <section className="paper mcard" style={{ marginTop: 16 }}>
      <div className="mhead"><h2>Weekly digest</h2><span className="sp" />
        <div className="togrow" style={{ padding: 0, border: 0 }} onClick={async () => { await api("/digest", { method: "PUT", body: { enabled: !d.enabled } }); load(); }}>
          <span className="small">{d.enabled ? `Mondays at ${String(d.send_hour).padStart(2, "0")}:00` : "Off"}</span>
          <span className={`switch ${d.enabled ? "on" : ""}`} role="switch" aria-checked={d.enabled}><i /></span>
        </div>
      </div>
      <p className="small" style={{ marginTop: 0 }}>The Chief of Staff posts last week's numbers in your main chat, so it also arrives as a notification.{d.last_sent ? ` Last sent: ${d.last_sent}.` : ""}</p>
      <div className="acts">
        <button className="btn sm" onClick={() => setShow(!show)}><i className={show ? "ri-eye-off-line" : "ri-eye-line"} />{show ? "Hide preview" : "Preview"}</button>
        <button className="btn sm" onClick={async () => { try { await api("/digest/send", { body: {} }); setMsg("Sent to your main chat."); load(); } catch (e: any) { setMsg(e.message); } }}><i className="ri-send-plane-line" />Send now</button>
        {msg && <span className="small">{msg}</span>}
      </div>
      {show && <div className="digest-prev"><Markdown text={d.preview} /></div>}
    </section>
  );
}

export default function Monitor() {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [asTable, setAsTable] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);

  usePoll(async () => {
    setLoading(true);
    try { setData(await api<Data>(`/monitor?range=${range}`)); setUpdated(new Date()); setErr(null); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, 30000, [range], (n) => n?.url === "/monitor" || n?.kind?.startsWith("job") || n?.kind === "inbox" || n?.kind === "reply");

  const labels = useMemo(() => (data?.buckets || []).map((b) => {
    const d = new Date(b);
    return data?.unit === "hour" ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], data?.range === "7d" ? { weekday: "short", day: "numeric" } : { day: "numeric", month: "short" });
  }), [data]);
  const tipLabels = useMemo(() => (data?.buckets || []).map((b) => {
    const d = new Date(b);
    return data?.unit === "hour" ? `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  }), [data]);

  // colour follows the helper (team order), never its rank: the first 7 helpers keep their slot, the rest share "Other"
  const tokenSeries: Series[] = useMemo(() => {
    if (!data) return [];
    const order = data.helpers.map((h) => h.id);
    const by = new Map(data.tokens_by_helper.map((t) => [t.staff_id, t.values]));
    const out: Series[] = [];
    const other = new Array(data.buckets.length).fill(0);
    order.forEach((id, i) => {
      const v = by.get(id);
      if (!v) return;
      if (i < SERIES.length) out.push({ key: id, label: data.helpers[i].name, color: SERIES[i], values: v });
      else v.forEach((x, j) => (other[j] += x));
    });
    for (const [id, v] of by) if (!order.includes(id)) v.forEach((x, j) => (other[j] += x));
    if (other.some(Boolean)) out.push({ key: "other", label: "Other", color: OTHER, values: other });
    return out;
  }, [data]);
  const jobSeries: Series[] = data ? [
    { key: "done", label: "Done", color: STATUS.good, values: data.jobs.done },
    { key: "failed", label: "Failed", color: STATUS.critical, values: data.jobs.failed },
  ] : [];

  if (!data) return <div><h1>Monitor</h1>{err ? <Err error={err} /> : <p className="small">Loading…</p>}</div>;
  const k = data.kpi;
  const jobsTotal = k.jobs_done + k.jobs_failed;
  const success = jobsTotal ? Math.round((k.jobs_done / jobsTotal) * 100) : null;
  const maxTok = Math.max(1, ...data.helpers.map((h) => h.tokens));

  return (
    <div className={`monitor ${loading ? "refetch" : ""}`}>
      <div className="sechead" style={{ alignItems: "flex-end" }}>
        <div><h1 style={{ marginBottom: 4 }}>Monitor</h1>
          <p className="sub" style={{ margin: 0 }}>How your helpers are doing: usage, jobs, what waits on you, and the pool. Times in {data.timezone}.</p></div>
        <span className="sp" />
        <span className="small">{updated ? `Updated ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}</span>
      </div>
      <div className="filters">
        <div className="seg" role="tablist" aria-label="Time range">
          {RANGES.map(([r, l]) => <button key={r} role="tab" aria-selected={range === r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{l}</button>)}
        </div>
        {k.paused && <span className="chip warn"><i className="ri-pause-line" />All helpers paused</span>}
      </div>
      <Err error={err} />

      <div className="mtiles">
        <Tile label="Tokens" value={fmtNum(k.tokens)} sub={<Delta cur={k.tokens} prev={k.tokens_prev} good="down" />} />
        <Tile label="Spend" value={money(k.cost_usd)} sub={<span title="At API prices. Runs on the Claude Code pool are covered by your subscriptions."><Delta cur={k.cost_usd} prev={k.cost_prev} good="down" /></span>} />
        <Tile label="Jobs finished" value={<>{k.jobs_done}{k.jobs_failed ? <span className="num-sub"> · {k.jobs_failed} failed</span> : null}</>}
          sub={success == null ? <span className="delta flat">none yet</span> : <span className={`delta ${success >= 90 ? "good" : success >= 70 ? "flat" : "bad"}`}>{success}% succeeded</span>} href="/chat/?view=work" />
        <Tile label="Waiting on you" value={<>{k.waiting}{k.waiting_critical ? <span className="num-sub crit"> · {k.waiting_critical} urgent</span> : null}</>}
          sub={<span className="small">{k.oldest_waiting ? `oldest ${ago(k.oldest_waiting)}` : "all clear"}{k.avg_decision_minutes != null ? ` · you answer in ~${mins(k.avg_decision_minutes)}` : ""}</span>} href="/" />
        <Tile label="Working now" value={<>{k.working}<span className="num-sub"> of {k.helpers}</span></>}
          sub={<span className="small">{k.awake} awake{k.queued ? ` · ${k.queued} queued` : ""} · {k.runs} runs{k.avg_run_seconds ? ` (${Math.round(k.avg_run_seconds)}s avg)` : ""}</span>} />
        <Tile label="Claude Code pool" value={data.pool.total ? <>{data.pool.ready}<span className="num-sub"> / {data.pool.total} ready</span></> : "–"} href="/harness/"
          sub={data.pool.total ? <span className="small">{data.pool.avg_pct != null ? `avg ${data.pool.avg_pct}% used (5 h)` : "use not reported yet"}</span> : <span className="small">No accounts yet</span>}>
          {data.pool.total > 0 && <div style={{ marginTop: 8 }}><Segments m={data.pool as any} big /></div>}
        </Tile>
      </div>

      <div className="mgrid two">
        <section className="paper mcard">
          <div className="mhead"><h2>Tokens by helper</h2><span className="sp" />
            <button className="btn sm quiet" onClick={() => setAsTable(!asTable)}><i className={asTable ? "ri-bar-chart-2-line" : "ri-table-line"} />{asTable ? "Chart" : "Table"}</button></div>
          <Legend series={tokenSeries} />
          {asTable ? <DataTable labels={tipLabels} series={tokenSeries} /> : <StackedBars labels={labels} tipLabels={tipLabels} series={tokenSeries} unit=" tokens" empty="No AI usage in this period yet." />}
        </section>
        <section className="paper mcard">
          <div className="mhead"><h2>Jobs</h2></div>
          <Legend series={[{ label: `Done (${k.jobs_done})`, color: STATUS.good, icon: "ri-checkbox-circle-fill" }, { label: `Failed (${k.jobs_failed})`, color: STATUS.critical, icon: "ri-close-circle-fill" }]} />
          {asTable ? <DataTable labels={tipLabels} series={jobSeries} /> : <StackedBars labels={labels} tipLabels={tipLabels} series={jobSeries} format={(n) => String(Math.round(n))} unit=" jobs" empty="No finished jobs in this period." />}
        </section>
      </div>

      <section className="paper mcard" style={{ marginTop: 16 }}>
        <div className="mhead"><h2>Helpers</h2><span className="sp" /><Link className="small" href="/staff/">Manage team</Link></div>
        <div className="tw"><table className="mtable">
          <thead><tr><th>Helper</th><th>Now</th><th className="hide-sm">Doing</th><th className="num-cell">Jobs</th><th>Tokens</th><th className="num-cell hide-sm">Spend</th><th className="hide-sm">Budget (month)</th><th className="hide-sm">Last active</th></tr></thead>
          <tbody>{data.helpers.map((h, i) => {
            const [cls, icon, txt] = STATE[h.state] || ["idle", "ri-question-line", h.state];
            return (
              <tr key={h.id} onContextMenu={menu(() => [{ heading: h.name }, ...helperItems(h), ...(h.current ? [sep, ...jobLinkItems(h.current.task_id, h.current.brief)] : [])])}>
                <td><Link href={`/staff/?id=${h.id}`} className="mh-name"><Avatar who={h} size={28} state={h.state === "working" ? "working" : h.state === "sleeping" ? "sleeping" : null} /><b>{h.name}</b></Link></td>
                <td><span className={`chip ${cls}`}><i className={icon} />{txt}</span></td>
                <td className="hide-sm small" style={{ maxWidth: 280 }}>{h.current ? <Link href={`/chat/?view=work&task=${h.current.task_id}`}>{h.current.brief}</Link> : "–"}</td>
                <td className="num-cell">{h.jobs_done}{h.jobs_failed ? <span className="crit"> · {h.jobs_failed}✕</span> : ""}</td>
                <td style={{ minWidth: 140 }}><div className="inl"><span className="inl-bar"><i style={{ width: `${(h.tokens / maxTok) * 100}%`, background: i < SERIES.length ? SERIES[i] : OTHER }} /></span><span className="mono small">{fmtNum(h.tokens)}</span></div></td>
                <td className="num-cell hide-sm mono small">{money(h.cost_usd)}</td>
                <td className="hide-sm" style={{ minWidth: 150 }}><Link href={`/staff/?id=${h.id}#budget`} className="plain"><BudgetBar b={data.budgets[h.id]} /></Link></td>
                <td className="hide-sm small">{h.last_active ? ago(h.last_active) : "never"}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>

      <div className="mgrid two">
        <section className="paper mcard">
          <div className="mhead"><h2>Why jobs failed</h2><span className="sp" /><span className="small">{data.failures.reduce((n, f) => n + f.count, 0)} failed</span></div>
          {data.failures.length === 0 ? <p className="small">No failed jobs in this period.</p> : (
            <div className="fails">{data.failures.map((f) => {
              const max = data.failures[0].count;
              return (
                <details key={f.key} className="fail">
                  <summary>
                    <span className="fail-l"><i className="ri-close-circle-fill" style={{ color: STATUS.critical }} />{f.label}</span>
                    <span className="bl-track"><span className="bl-bar" style={{ width: `${(f.count / max) * 100}%`, background: STATUS.critical }} /></span>
                    <span className="bl-v">{f.count}</span>
                  </summary>
                  <div className="fail-b">
                    <div className="small"><b>What to do:</b> {f.fix}.</div>
                    {f.example && <div className="fail-ex mono">{f.example}</div>}
                    {f.jobs.map((j) => <Link key={j.task_id} href={`/chat/?view=work&task=${j.task_id}`} className="fail-j" onContextMenu={menu(() => jobLinkItems(j.task_id, j.brief))}><span>{j.brief}</span><span className="small">{j.staff} · {ago(j.at)}</span></Link>)}
                  </div>
                </details>
              );
            })}</div>
          )}
        </section>
        <section className="paper mcard">
          <div className="mhead"><h2>Run time</h2><span className="sp" /><span className="small">median · slowest 10%</span></div>
          {data.timing.engines.length === 0 ? <p className="small">No finished jobs in this period.</p> : (
            <>
              <div className="tw"><table className="mtable compact">
                <thead><tr><th>Engine</th><th className="num-cell">Jobs</th><th className="num-cell">Median</th><th className="num-cell">p90</th><th className="num-cell">Failed</th></tr></thead>
                <tbody>{data.timing.engines.map((e) => (
                  <tr key={e.engine}><td>{e.engine}</td><td className="num-cell">{e.jobs}</td><td className="num-cell mono">{durS(e.median_s)}</td><td className="num-cell mono">{durS(e.p90_s)}</td>
                    <td className={`num-cell ${e.fail_rate >= 20 ? "crit" : ""}`}>{e.fail_rate}%</td></tr>
                ))}</tbody>
              </table></div>
              <div className="tw" style={{ marginTop: 10 }}><table className="mtable compact">
                <thead><tr><th>Helper</th><th className="num-cell">Jobs</th><th className="num-cell">Median</th><th className="num-cell">p90</th><th className="hide-sm">Slowest</th></tr></thead>
                <tbody>{data.timing.helpers.slice(0, 8).map((h) => (
                  <tr key={h.staff_id}><td>{h.name}</td><td className="num-cell">{h.jobs}</td><td className="num-cell mono">{durS(h.median_s)}</td><td className="num-cell mono">{durS(h.p90_s)}</td>
                    <td className="hide-sm small">{h.slowest ? <Link href={`/chat/?view=work&task=${h.slowest.task_id}`} onContextMenu={menu(() => jobLinkItems(h.slowest!.task_id, h.slowest!.brief))}>{durS(h.slowest.seconds)} · {h.slowest.brief}</Link> : "–"}</td></tr>
                ))}</tbody>
              </table></div>
            </>
          )}
        </section>
      </div>

      <div className="mgrid two">
        <section className="paper mcard">
          <div className="mhead"><h2>Value per helper</h2><span className="sp" /><span className="small">proposals you decided, and what they cost</span></div>
          {data.value.length === 0 ? <p className="small">No proposals or usage in this period.</p> : (
            <div className="tw"><table className="mtable compact">
              <thead><tr><th>Helper</th><th className="num-cell">Proposals</th><th>Approved</th><th className="num-cell hide-sm">Rejected</th><th className="num-cell">Spend</th><th className="num-cell">Per approved</th></tr></thead>
              <tbody>{data.value.map((v) => (
                <tr key={v.staff_id}>
                  <td>{v.name}</td><td className="num-cell">{v.proposals}{v.pending ? <span className="small"> ({v.pending} open)</span> : ""}</td>
                  <td style={{ minWidth: 120 }}>{v.approval_rate == null ? <span className="small">none decided</span> : (
                    <div className="inl"><span className="inl-bar"><i style={{ width: `${v.approval_rate}%`, background: STATUS.good }} /></span><span className="small">{v.approved} · {v.approval_rate}%</span></div>)}</td>
                  <td className="num-cell hide-sm">{v.rejected + v.changes || "–"}</td>
                  <td className="num-cell mono small">{money(v.cost_usd)}</td>
                  <td className="num-cell mono small">{v.cost_per_approved != null ? money(v.cost_per_approved) : "–"}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
        <section className="paper mcard" id="pool">
          <div className="mhead"><h2>Pool, last 24 hours</h2><span className="sp" /><span className="small">{data.pool_history.hits_7d} limit hit{data.pool_history.hits_7d === 1 ? "" : "s"} in 7 days</span></div>
          {data.pool_history.accounts.length === 0 ? <p className="small">No pool accounts yet.</p> : <PoolHistory h={data.pool_history} />}
          <p className="small" style={{ marginBottom: 0 }}>{data.pool_history.hits_7d >= 3 ? "Accounts hit their limits often: add a subscription, or move regular jobs to quieter hours." : "Each square is one hour. Dark squares are busy hours; a red mark means the account reached its limit then."}</p>
        </section>
      </div>

      <DigestCard />

      <div className="mgrid three">
        <section className="paper mcard">
          <div className="mhead"><h2>Claude Code pool</h2><span className="sp" /><Link className="small" href="/harness/">Harness</Link></div>
          {data.pool.total === 0 ? <p className="small">No subscriptions in the pool. Add them on the Harness page to run helpers on Claude Code.</p> : (
            <div className="pool-rows">{data.pool.accounts.map((a) => {
              const p = a.state === "cooling" ? 100 : a.five_hour.pct;
              const lv = a.state === "cooling" ? "rest" : a.state === "error" ? "err" : a.state === "disabled" ? "off" : p == null ? "unknown" : p >= 90 ? "high" : p >= 70 ? "mid" : "low";
              return (
                <div key={a.id} className="pm-row" onContextMenu={menu(() => [{ heading: a.label }, { label: "Manage on the Harness page", icon: "ri-stack-line", href: "/harness/" },
                  a.state === "cooling" && { label: "Use it again now", icon: "ri-restart-line", onSelect: async () => { await api(`/harness/accounts/${a.id}`, { method: "PATCH", body: { clear_cooldown: true } }); kick("/monitor"); } }])}>
                  <span className="pm-name">{a.label}{a.busy ? <span className="chip run" style={{ marginLeft: 6 }}>{a.busy} working</span> : null}</span>
                  <span className={`pseg wide ${lv}`}><i style={{ width: `${p ?? 0}%` }} /></span>
                  <span className="small">{a.state === "cooling" ? "Resting until its limit resets" : a.state === "error" ? "Needs sign-in" : p == null ? "5-hour use not reported" : `${p}% of 5-hour limit`} · {fmtNum(a.tokens_range)} tokens this period</span>
                </div>
              );
            })}</div>
          )}
        </section>
        <section className="paper mcard">
          <div className="mhead"><h2>Saga tools used</h2></div>
          {data.tools.length === 0 ? <p className="small">No tool calls in this period.</p> : (
            <BarList rows={data.tools.map((t) => ({ label: t.name.replace(/_/g, " "), value: t.calls,
              note: t.errors ? `${t.errors} failed` : t.blocked ? `${t.blocked} blocked` : `${t.avg_ms} ms`, warn: !!(t.errors || t.blocked) }))} />
          )}
          <p className="small" style={{ marginBottom: 0 }}>Calls helpers made to Saga OS (reports, proposals, questions). Blocked means a rule stopped it.</p>
        </section>
        <section className="paper mcard">
          <div className="mhead"><h2>Latest</h2></div>
          {data.activity.length === 0 ? <p className="small">Nothing yet.</p> : (
            <div className="feed">{data.activity.map((n) => (
              <Link key={n.id} href={n.url} className="feed-i" onContextMenu={menu(() => [{ label: "Open", icon: "ri-arrow-right-up-line", href: n.url }, { label: "Copy link", icon: "ri-link", onSelect: () => copy(location.origin + n.url) }])}>
                <i className={ICON[n.kind] || "ri-notification-3-line"} style={n.kind === "job_failed" ? { color: STATUS.critical } : undefined} />
                <span className="t"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</span>
                <span className="small">{ago(n.at)}</span>
              </Link>
            ))}</div>
          )}
        </section>
      </div>
    </div>
  );
}
