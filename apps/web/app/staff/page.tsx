"use client";
import Avatar from "@/components/Avatar";
import LookEditor from "@/components/LookEditor";
import Drawer from "@/components/Drawer";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Empty, Err, StatusChip } from "@/components/ui";
import { Staff, ago, api } from "@/lib/api";
import { chatWith, hireBack, helperItems, letGo, taskItems } from "@/lib/actions";
import { copy, menu, sep } from "@/lib/menu";
import { usePoll } from "@/lib/poll";
import HelperState from "@/components/HelperState";
import HelperAccess from "@/components/HelperAccess";
import { usePageActions } from "@/components/PageActions";
import { confirmDialog } from "@/lib/dialog";

const LEVELS = [["", "default"], ["0", "off"], ["1", "ask"], ["2", "do and tell"], ["3", "auto"]];

function FirstJob({ s }: { s: Staff }) {
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const give = async () => {
    try { const t = await api<{ id: string }>("/tasks", { body: { staff_id: s.id, brief } }); router.push(`/chat/?view=work&task=${t.id}`); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="callout ok" style={{ marginTop: 0 }}>
      <b style={{ fontWeight: 500 }}><i className="ri-checkbox-circle-fill" style={{ color: "var(--ok)" }} /> {s.name} joined your team.</b>
      <div className="small" style={{ margin: "4px 0 10px" }}>They sleep until they get work. Give them a first job now, or later from Chat or Work.</div>
      <div className="acts" style={{ flexWrap: "nowrap" }}>
        <input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. Review our website and suggest 5 improvements" />
        <button className="btn primary" disabled={!brief.trim()} onClick={give}>Give job</button>
      </div>
      <Err error={err} />
    </div>
  );
}

function StaffDetail({ id }: { id: string }) {
  const router = useRouter();
  const hired = useSearchParams().get("hired") === "1";
  const [s, setS] = useState<Staff | null>(null);
  const [edit, setEdit] = useState<Partial<Staff>>({});
  const [shift, setShift] = useState({ name: "", cron: "", brief: "" });
  const [addingShift, setAddingShift] = useState(false);
  const [connect, setConnect] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const x = await api<Staff>(`/staff/${id}`); setS(x);
      if (loadedFor.current !== id) {  // fill the form once; live refreshes never overwrite what you are typing
        loadedFor.current = id;
        setEdit({ name: x.name, job: x.job, engine: x.engine, max_task_minutes: x.max_task_minutes });
      }
    } catch (e: any) { setErr(e.message); }
  }, [id]);
  usePoll(load, 30000, [load]);
  usePageActions(!s ? null : s.status === "retired" ? { primary: { label: `Hire ${s.name} back`, icon: "ri-user-add-line", onSelect: () => hireBack(s, load) } } : {
    primary: { label: `Give ${s.name} a job`, icon: "ri-add-circle-line", href: `/chat/?view=work&task=new&staff=${s.id}&full=1` },
    more: [
      { label: s.status === "active" ? `Pause ${s.name}` : `Activate ${s.name}`, icon: s.status === "active" ? "ri-pause-circle-line" : "ri-play-circle-line",
        onSelect: () => save({ status: s.status === "active" ? "paused" : "active" }) },
      { label: `Chat with ${s.name}`, icon: "ri-chat-3-line", onSelect: () => chatWith(s) },
      { label: "Connect an outside engine (new MCP token)", icon: "ri-key-2-line", onSelect: () => rotate() },
      { sep: true },
      !s.is_chief && { label: `Let ${s.name} go`, icon: "ri-user-unfollow-line", danger: true, onSelect: () => letGo(s, () => router.push("/staff/")) },
    ],
  }, [s?.id, s?.status, s?.name]);
  if (!s) return <Err error={err} />;
  const overrides: Record<string, number> = s.permissions?.actions || {};

  const save = async (body: Record<string, unknown>) => {
    setErr(null);
    try { await api(`/staff/${id}`, { method: "PATCH", body }); setMsg("Saved"); load(); } catch (e: any) { setErr(e.message); }
  };
  const setLevel = (action: string, v: string) => {
    const actions = { ...overrides };
    if (v === "") delete actions[action]; else actions[action] = Number(v);
    save({ permissions: { ...s.permissions, actions } });
  };
  const addShift = async () => {
    try { await api(`/staff/${id}/shifts`, { body: shift }); setShift({ name: "", cron: "", brief: "" }); setAddingShift(false); load(); } catch (e: any) { setErr(e.message); }
  };
  const toggleShift = async (sid: string, enabled: boolean) => { await api(`/shifts/${sid}`, { method: "PATCH", body: { enabled } }); load(); };
  const rotate = async () => {
    if (!(await confirmDialog({ title: "Create a new MCP token?", body: "The old one stops working immediately. Anything set up with it needs the new token.", confirm: "Create new token", who: s, mood: "worried" }))) return;
    setConnect(await api(`/staff/${id}/mcp-token`, { body: {} }));
  };

  return (
    <div>
      <div className="eyebrow"><Link href="/staff/">Team</Link> · {s.role?.startsWith("agency:") ? "Specialist from The Agency" : s.role || "custom"}</div>
      <div className="acts" style={{ gap: 14, flexWrap: "nowrap", margin: "4px 0 12px" }}>
        <Avatar who={s} size={56} />
        <h1 style={{ margin: 0 }}>{s.name}{s.is_chief ? " · Chief of Staff" : ""}</h1>
      </div>
      {hired && <FirstJob s={s} />}
      {s.status === "retired" ? (
        <div className="callout" style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ flex: 1 }}>You let {s.name} go. Its past work is still here; it does no new work.</span>
          <button className="btn primary" onClick={() => hireBack(s, load)}><i className="ri-user-add-line" />Hire {s.name} back</button>
        </div>
      ) : (
        <div className="acts" style={{ marginBottom: 20 }}>
          <StatusChip status={s.status} />
          {msg && <span className="small">{msg}</span>}
        </div>
      )}
      {connect && (
        <div className="paper" style={{ marginBottom: 20 }}>
          <b>Shown once.</b> <span className="small">Only needed to connect an agent that runs outside Omilo to this helper: add this MCP server to its config.</span>
          <label>Claude Code (.mcp.json)</label><pre className="code">{JSON.stringify(connect.claude_code_config, null, 2)}</pre>
        </div>
      )}
      <div className="grid2">
        <div>
          <h2>Job</h2>
          <label>Name</label><input value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <label>Job description (what the agent reads before every task)</label>
          <textarea rows={10} value={edit.job || ""} onChange={(e) => setEdit({ ...edit, job: e.target.value })} />
          <div className="grid2">
            <div><label>AI</label>
              <select value={edit.engine?.type === "claude-code" ? (edit.engine?.auth === "api" ? "cc-api" : "cc-pool") : edit.engine?.type || "fake"}
                onChange={(e) => { const v = e.target.value; const keep = { ...(edit.engine || {}) }; delete keep.auth;
                  setEdit({ ...edit, engine: v === "cc-api" ? { ...keep, type: "claude-code", auth: "api" } : v === "cc-pool" ? { ...keep, type: "claude-code" } : { ...keep, type: v } }); }}>
                <option value="cc-api">Claude Code · your API key</option><option value="cc-pool">Claude Code · subscription pool</option>
                <option value="claude">Built-in Claude (light)</option><option value="fake">Practice mode (no AI)</option>
              </select></div>
            <div><label>Max minutes per task</label><input type="number" value={edit.max_task_minutes || 30} onChange={(e) => setEdit({ ...edit, max_task_minutes: Number(e.target.value) })} /></div>
          </div>
          {edit.engine?.type === "claude" && (
            <div><label>Claude model</label><input value={edit.engine?.model || ""} placeholder="claude-sonnet-5-5" onChange={(e) => setEdit({ ...edit, engine: { ...edit.engine, model: e.target.value } })} /></div>
          )}
          {edit.engine?.type === "claude-code" && (
            <div><label>Model (optional)</label><input value={edit.engine?.model || ""} placeholder="default" onChange={(e) => setEdit({ ...edit, engine: { ...edit.engine, model: e.target.value || undefined } })} /></div>
          )}
          <div className="acts" style={{ marginTop: 12 }}><button className="btn primary" onClick={() => save(edit)}>Save</button></div>
        </div>
        <div>
          <h2>Permissions</h2>
          <p className="note">What this agent may do without asking. The gateway enforces it on every tool call.</p>
          <div className="tw"><table><thead><tr><th>Action</th><th>Effective</th><th>Override</th></tr></thead><tbody>
            {Object.entries(s.effective_permissions || {}).map(([a, lvl]) => (
              <tr key={a}><td>{a}</td><td><span className={`chip ${lvl === "off" ? "down" : lvl === "ask" ? "warn" : "up"}`}>{lvl}</span></td>
                <td><select value={a in overrides ? String(overrides[a]) : ""} onChange={(e) => setLevel(a, e.target.value)}>
                  {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td></tr>
            ))}
          </tbody></table></div>
        </div>
      </div>
      {s.status !== "retired" && <HelperAccess id={s.id} name={s.name} />}
      <div className="sec" id="memory">
        <h2>Memory</h2>
        <p className="small" style={{ marginTop: 0 }}>What {s.name} has learned, as notes in Docs. {s.name} reads them before every run; edit them and it follows your version.</p>
        <div className="acts">
          <Link className="btn" href={`/docs/?path=${encodeURIComponent(`Memory/${s.id}/Lessons.md`)}`}><i className="ri-lightbulb-line" />Lessons</Link>
          <Link className="btn" href={`/docs/?path=${encodeURIComponent(`Memory/${s.id}/Notes.md`)}`}><i className="ri-sticky-note-line" />Notes</Link>
          {s.shifts.map((sh) => (
            <Link key={sh.id} className="btn quiet" href={`/docs/?path=${encodeURIComponent(`Memory/Loops/${s.id} · ${sh.name}.md`)}`}><i className="ri-repeat-line" />{sh.name} log</Link>
          ))}
          <Link className="btn quiet" href="/docs/?graph=1"><i className="ri-share-circle-line" />Graph</Link>
        </div>
      </div>
      <BudgetSection s={s as any} onSave={save} />
      <div className="sec" id="look">
        <h2>Look</h2>
        <p className="small" style={{ marginTop: 0 }}>How {s.name} appears in chats, the team list and notifications.</p>
        <LookEditor who={s} />
      </div>
      <div className="sec">
        <div className="sechead"><h2>Schedule</h2><span className="sp" />
          <button className="btn" onClick={() => setAddingShift(true)}><i className="ri-add-line" />Add a regular job</button></div>
        <p className="sub">Regular jobs this helper does on its own, in your local time.</p>
        <div className="tw"><table><thead><tr><th>Job</th><th>When</th><th>What to do</th><th>Next</th><th></th></tr></thead><tbody>
          {s.shifts.map((sh) => (
            <tr key={sh.id}><td>{sh.name}</td><td>{sh.when || sh.cron}</td><td className="small">{sh.brief}</td><td className="small">{sh.enabled ? ago(sh.next_at) : "off"}</td>
              <td><button className="btn" onClick={() => toggleShift(sh.id, !sh.enabled)}>{sh.enabled ? "Turn off" : "Turn on"}</button></td></tr>
          ))}
        </tbody></table></div>
        <Drawer open={addingShift} onClose={() => setAddingShift(false)} icon={<i className="ri-calendar-schedule-line" />} title="Add a regular job"
          sub={`Something ${s.name} does on its own, on a schedule.`}
          footer={<><span className="sp" /><button className="btn" onClick={() => setAddingShift(false)}>Cancel</button>
            <button className="btn primary" disabled={!shift.name || !shift.cron || !shift.brief.trim()} onClick={addShift}>Add job</button></>}>
          <div className="dw-sec">
            <label style={{ marginTop: 0 }}>What should it do?</label>
            <textarea value={shift.brief} placeholder="e.g. Draft 3 Instagram posts for next week's promo" onChange={(e) => setShift({ ...shift, brief: e.target.value, name: shift.name || "" })} />
            <label>Short name</label>
            <input value={shift.name} placeholder="e.g. weekly-promo" onChange={(e) => setShift({ ...shift, name: e.target.value })} />
          </div>
          <div className="dw-sec">
            <h3>When</h3>
            <div style={{ marginTop: 8 }}><SchedulePicker value={shift.cron} onChange={(cron) => setShift({ ...shift, cron })} /></div>
          </div>
          <Err error={err} />
        </Drawer>
      </div>
      <div className="sec">
        <h2>Recent tasks</h2>
        {s.recent_tasks?.length ? s.recent_tasks.map((t) => (
          <div key={t.id} className="acts" style={{ margin: "6px 0" }} onContextMenu={menu(() => taskItems({ ...t, staff_id: s.id }, s.name))}><StatusChip status={t.status} /><Link href={`/chat/?view=work&task=${t.id}`}>{t.brief.slice(0, 90)}</Link><span className="small">{ago(t.created_at)}</span></div>
        )) : <p className="small">No tasks yet.</p>}
      </div>
      <Err error={err} />
    </div>
  );
}

function BudgetSection({ s, onSave }: { s: Staff & { budget?: { budget_usd: number; budget_tokens: number; cost_usd: number; tokens: number; pct: number | null } }; onSave: (b: Record<string, unknown>) => Promise<void> | void }) {
  const b = s.budget;
  const [usd, setUsd] = useState(String(s.budget_usd_month || ""));
  const [tok, setTok] = useState(String(b?.budget_tokens || ""));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setUsd(String(s.budget_usd_month || "")); setTok(String(b?.budget_tokens || "")); }, [s.budget_usd_month, b?.budget_tokens]);
  const pct = b?.pct;
  const lv = pct == null ? "" : pct >= 100 ? "critical" : pct >= 80 ? "warning" : "good";
  return (
    <div className="sec" id="budget">
      <h2>Budget</h2>
      <p className="small" style={{ marginTop: 0 }}>A monthly limit. At 80% you get an alert in the Inbox; at 100% {s.name} pauses until you raise it or resume it. Leave empty for no limit.</p>
      {b && (
        <div className="paper" style={{ marginBottom: 12 }}>
          <div className="acts" style={{ justifyContent: "space-between" }}>
            <span className="small">This month: <b className="mono">${b.cost_usd.toFixed(2)}</b> and <b className="mono">{b.tokens.toLocaleString()}</b> tokens</span>
            {pct != null && <span className={`small bud ${lv}`}>{Math.round(pct)}% of budget</span>}
          </div>
          {pct != null && <div className="inl-bar" style={{ marginTop: 8, height: 8 }}><i style={{ width: `${Math.min(100, pct)}%`, background: lv === "critical" ? "#d03b3b" : lv === "warning" ? "#fab219" : "#0ca30c" }} /></div>}
        </div>
      )}
      <div className="grid2">
        <div><label style={{ marginTop: 0 }}>Spend per month (USD, at API prices)</label><input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="e.g. 20" /></div>
        <div><label style={{ marginTop: 0 }}>Tokens per month</label><input inputMode="numeric" value={tok} onChange={(e) => setTok(e.target.value)} placeholder="e.g. 2000000" /></div>
      </div>
      <p className="small">For helpers on the Claude Code pool, spend is what the work would cost at API prices; a token limit fits them better.</p>
      <div className="acts"><button className="btn" onClick={async () => { await onSave({ budget_usd_month: Number(usd) || 0, budget_tokens_month: Math.round(Number(tok)) || 0 }); setSaved(true); setTimeout(() => setSaved(false), 2000); }}>Save budget</button>
        {saved && <span className="small">Saved</span>}</div>
    </div>
  );
}

function engineLabel(s: Staff) {
  if (s.engine?.type === "claude-code") return s.engine?.auth === "api" ? "Claude Code · API key" : "Shared pool";
  if (s.engine?.type === "claude") return "Built-in Claude";
  return "Practice mode";
}

function StaffList() {
  usePageActions({ primary: { label: "Hire a helper", icon: "ri-user-add-line", href: "/talent/" } }, []);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [former, setFormer] = useState<Staff[]>([]);
  const load = useCallback(async () => {
    const [a, f] = await Promise.all([api<Staff[]>("/staff"), api<Staff[]>("/staff?former=true").catch(() => [] as Staff[])]);
    setStaff(a); setFormer(f);
  }, []);
  usePoll(load, 30000, [load]);

  return (
    <div>
      {/* Page Header v2 */}
      <div className="ph2">
        <div className="ph2-text">
          <h1 className="ph2-title">Team</h1>
          <p className="ph2-sub">Your AI helpers. Open one to change their job, schedule or what they may do without asking.</p>
        </div>
        <div className="ph2-actions">
          <Link href="/talent/" className="btn primary"><i className="ri-user-add-line" />Hire a helper</Link>
        </div>
      </div>

      {/* Tab strip */}
      <div className="team2-tabs">
        <span className="team2-tab on">
          <i className="ri-group-line" />Helpers
          {staff.length > 0 && <span className="team2-tab-count">{staff.length}</span>}
        </span>
        <Link href="/talent/" className="team2-tab">
          <i className="ri-store-2-line" />Hire specialists
        </Link>
      </div>

      {/* Helper list */}
      {staff.length === 0 ? (
        <Empty title="No helpers yet" text="Finish onboarding, or hire one from the Hire page." />
      ) : (
        <div className="team2-list">
          {staff.map((s) => (
            <div
              key={s.id}
              className="team2-row"
              onContextMenu={menu(() => [{ heading: s.name }, ...helperItems(s, load), sep,
                { label: `Give ${s.name} a job`, icon: "ri-add-circle-line", href: `/chat/?view=work&task=new&staff=${s.id}&full=1` },
                { label: "Copy the id", icon: "ri-file-copy-line", hint: s.id, onSelect: () => copy(s.id) }])}
            >
              {/* Identity */}
              <Link href={`/staff/?id=${s.id}`} className="team2-id">
                <Avatar who={s} size={40} state={(s as any).state === "working" ? "working" : null} />
                <span className="team2-id-text">
                  <b className="team2-name">{s.name}{s.is_chief ? <span className="team2-chief"> · Chief of Staff</span> : null}</b>
                  <span className="team2-role small">{s.role?.startsWith("agency:") ? "Specialist · The Agency" : s.role || "custom"}</span>
                </span>
              </Link>
              {/* Status */}
              <span className="team2-status">
                <HelperState h={s as any} />
                {s.shifts.length > 0 && (
                  <span className="team2-next small">next {s.shifts[0].when || s.shifts[0].cron}</span>
                )}
              </span>
              {/* Meta pillbox */}
              <span className="team2-meta">
                <span className="team2-pill">
                  <span className="team2-pill-label">Jobs</span>
                  <span className="team2-pill-val">{s.shifts.length} regular job{s.shifts.length === 1 ? "" : "s"}</span>
                </span>
                <span className="team2-pill">
                  <span className="team2-pill-label">Engine</span>
                  <span className="team2-pill-val">{engineLabel(s)}</span>
                </span>
              </span>
              {/* Actions */}
              <span className="team2-actions">
                <Link href={`/staff/?id=${s.id}`} className="btn sm">Open</Link>
                <Link href={`/chat/?view=work&task=new&staff=${s.id}&full=1`} className="btn sm quiet"><i className="ri-chat-3-line" />Chat</Link>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Former helpers */}
      {former.length > 0 && (
        <div className="sec">
          <h2>Former helpers</h2>
          <p className="small" style={{ marginTop: 4 }}>You let them go. Their past work is kept; hire one back any time.</p>
          <div className="team2-list team2-list-former">
            {former.map((s) => (
              <div key={s.id} className="team2-row team2-row-former">
                <Link href={`/staff/?id=${s.id}`} className="team2-id">
                  <Avatar who={s} size={36} mood="sad" />
                  <span className="team2-id-text">
                    <b className="team2-name">{s.name}</b>
                    <span className="team2-role small">{s.role?.startsWith("agency:") ? "Specialist · The Agency" : s.role || "custom"}</span>
                  </span>
                </Link>
                <span className="team2-status" />
                <span className="team2-meta" />
                <span className="team2-actions">
                  <Link className="btn sm quiet" href={`/staff/?id=${s.id}`}>History</Link>
                  <button className="btn sm" onClick={() => hireBack(s, load)}><i className="ri-user-add-line" />Hire back</button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested specialists */}
      <div className="sec">
        <p className="team2-suggest-head small">Suggested for your team</p>
        <div className="team2-suggest">
          {[
            { role: "Support Responder", cat: "Support", desc: "Answers customer messages in your voice and hands anything unusual to you." },
            { role: "Paid Media Buyer", cat: "Paid Media", desc: "Plans small ad tests on Instagram and Facebook. Every spend waits for your OK." },
            { role: "Bookkeeper", cat: "Finance", desc: "Matches payments to invoices each week and flags anything that does not add up." },
          ].map((sp) => (
            <div key={sp.role} className="team2-spec">
              <div className="team2-spec-top">
                <span className="team2-spec-icon"><i className="ri-robot-2-line" /></span>
                <span className="team2-spec-text">
                  <b className="team2-spec-name">{sp.role}</b>
                  <span className="team2-spec-cat small"><span className="team2-dot" />{sp.cat}</span>
                </span>
              </div>
              <p className="team2-spec-desc small">{sp.desc}</p>
              <div className="team2-spec-foot">
                <span className="sp" />
                <Link href="/talent/" className="btn sm primary">Hire</Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StaffInner() {
  const id = useSearchParams().get("id");
  return id ? <StaffDetail id={id} /> : <StaffList />;
}

export default function StaffPage() {
  return <Suspense><StaffInner /></Suspense>;
}

/* Pick a schedule in words; writes the cron expression the server stores. */
function SchedulePicker({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const [freq, setFreq] = useState("weekdays");
  const [day, setDay] = useState("1");
  const [time, setTime] = useState("09:00");
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    if (custom) return;
    const [h, m] = time.split(":").map((x) => String(Number(x)));
    const dow = freq === "daily" ? "*" : freq === "weekdays" ? "1-5" : day;
    onChange(freq === "hourly" ? `${m} * * * *` : `${m} ${h} * * ${dow}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freq, day, time, custom]);
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return (
    <div>
      {!custom ? (
        <div className="acts">
          <select style={{ width: "auto" }} value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="daily">Every day</option><option value="weekdays">Every weekday</option>
            <option value="weekly">Once a week</option><option value="hourly">Every hour</option>
          </select>
          {freq === "weekly" && <select style={{ width: "auto" }} value={day} onChange={(e) => setDay(e.target.value)}>{days.map((d, i) => <option key={d} value={String(i)}>on {d}</option>)}</select>}
          {freq !== "hourly" && <input style={{ width: "auto" }} type="time" value={time} onChange={(e) => setTime(e.target.value || "09:00")} />}
          <button type="button" className="btn quiet" onClick={() => setCustom(true)}>Advanced</button>
        </div>
      ) : (
        <div className="acts">
          <input style={{ width: 220 }} value={value} onChange={(e) => onChange(e.target.value)} placeholder="cron, e.g. 0 9 * * 1-5" />
          <button type="button" className="btn quiet" onClick={() => setCustom(false)}>Simple</button>
        </div>
      )}
    </div>
  );
}
