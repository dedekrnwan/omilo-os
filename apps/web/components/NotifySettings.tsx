"use client";
import { useCallback, useState } from "react";
import { ago, api, when } from "@/lib/api";
import { usePoll } from "@/lib/poll";
import { NotifyConfig, NotifyPrefs, disablePush, enableNotifications, permission } from "./Notify";

const FOCUS: [string, string][] = [["1h", "1 hour"], ["2h", "2 hours"], ["tomorrow", "Until tomorrow 08:00"]];

/* Settings → Notifications: turn them on for this browser, choose what to hear about and where, quiet hours, focus,
   sound, and a test. */
export default function NotifySettings({ embedded = false }: { embedded?: boolean }) {
  const [cfg, setCfg] = useState<NotifyConfig | null>(null);
  const [perm, setPerm] = useState<string>("default");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { setPerm(permission()); try { setCfg(await api<NotifyConfig>("/notify")); } catch { /* ignore */ } }, []);
  usePoll(load, 60000, [load]);
  if (!cfg) return null;

  const p = cfg.prefs;
  const save = async (body: Record<string, unknown>) => {
    setErr(null);
    try {
      const r = await api<NotifyPrefs & { quiet_now: boolean; focus_now: boolean }>(`/notify/prefs`, { method: "PUT", body });
      const { quiet_now, focus_now, ...prefs } = r;
      setCfg({ ...cfg, prefs, quiet_now, focus_now });
      window.dispatchEvent(new Event("omilo:notify-prefs"));
    } catch (e: any) { setErr(e.message); }
  };
  const flip = (k: string, ch: string) => save({ kinds: { [k]: { [ch]: !p.kinds[k]?.[ch] } } });
  const state = perm === "granted" ? ["up", "On in this browser"] : perm === "denied" ? ["down", "Blocked in this browser"]
    : perm === "insecure" ? ["warn", "Needs https or localhost"] : perm === "unsupported" ? ["idle", "Not supported here"] : ["idle", "Off"];

  return (
    <div className={embedded ? "" : "paper"} style={embedded ? undefined : { marginBottom: 24 }}>
      <div className="acts" style={{ justifyContent: "space-between" }}>
        {embedded ? <b>This browser</b> : <h2 style={{ margin: 0 }}>Notifications</h2>}<span className={`chip ${state[0]}`}>{state[1]}</span>
      </div>
      <p className="note">Omilo tells you right away when a helper needs you, and reminds you again until you decide, snooze or hand it
        to the Chief of Staff. Inside the app you see a small pop-up; when the tab is in the background or closed, your computer or
        phone shows a notification.</p>
      <div className="acts">
        {perm !== "granted" && perm !== "unsupported" && perm !== "insecure" && (
          <button className="btn primary" onClick={async () => { const r = await enableNotifications(); setMsg(r.detail); load(); }}><i className="ri-notification-3-line" />Turn on notifications</button>
        )}
        {perm === "granted" && <button className="btn" onClick={async () => { const r = await enableNotifications(); setMsg(r.detail); load(); }}>Reconnect this browser</button>}
        <button className="btn" onClick={async () => { await api("/notify/test", { body: {} }); setMsg("Sent. Switch to another tab to see it as a system notification."); }}>Send a test</button>
        {cfg.devices.length > 0 && <button className="btn quiet" onClick={async () => { await disablePush(); setMsg("This browser will not get notifications while Omilo is closed."); load(); }}>Stop background notifications here</button>}
      </div>
      {msg && <div className="callout" style={{ marginTop: 10 }}>{msg}</div>}
      {perm === "denied" && <p className="small">Allow notifications in your browser's site settings (the icon left of the address), then press Reconnect.</p>}
      {perm === "insecure" && <p className="small">Browsers only allow notifications on https or on localhost. Open Omilo at http://localhost:7700, or put it behind https.</p>}
      {!cfg.push && <p className="small">Background notifications (when no tab is open) need the <code>pywebpush</code> package on the server.</p>}

      <label>Focus</label>
      <div className="nrow">
        <div className="seg" role="group" aria-label="Focus">
          <button className={!cfg.focus_now ? "on" : ""} onClick={() => save({ focus: "off" })}>Off</button>
          {FOCUS.map(([v, l]) => <button key={v} onClick={() => save({ focus: v })}>{l}</button>)}
        </div>
        {cfg.focus_now && p.focus && <span className="chip warn"><i className="ri-focus-3-line" />Focusing until {when(p.focus.until)}</span>}
      </div>
      <p className="small" style={{ marginTop: 0 }}>Holds every notification except Critical ones. Reminders wait and arrive when focus ends.</p>

      <label>Quiet hours</label>
      <div className="nrow">
        <button type="button" className={`switch ${p.quiet.on ? "on" : ""}`} role="switch" aria-checked={p.quiet.on} aria-label="Quiet hours"
          onClick={() => save({ quiet: { on: !p.quiet.on } })}><i /></button>
        <span>From</span>
        <input type="time" value={p.quiet.start} disabled={!p.quiet.on} aria-label="Quiet hours start" onChange={(e) => e.target.value && save({ quiet: { start: e.target.value } })} />
        <span>to</span>
        <input type="time" value={p.quiet.end} disabled={!p.quiet.on} aria-label="Quiet hours end" onChange={(e) => e.target.value && save({ quiet: { end: e.target.value } })} />
        <span className="small">{cfg.timezone}</span>
        {cfg.quiet_now && <span className="chip idle"><i className="ri-moon-line" />Quiet now</span>}
      </div>
      <p className="small" style={{ marginTop: 0 }}>No pushes and no reminders at night. Critical items (production down, budget cap hit) still come through.</p>

      <label>Tell me about</label>
      <table className="ntable">
        <thead><tr><th>What</th>{Object.entries(cfg.channels).map(([c, l]) => <th key={c} title={l}>{c === "push" ? "Notification" : "In the app"}</th>)}</tr></thead>
        <tbody>
          {Object.entries(cfg.kinds).map(([k, label]) => (
            <tr key={k}>
              <td>{label}</td>
              {Object.keys(cfg.channels).map((c) => (
                <td key={c}>
                  <button type="button" className={`switch ${p.kinds[k]?.[c] ? "on" : ""}`} role="switch" aria-checked={!!p.kinds[k]?.[c]}
                    aria-label={`${label}: ${c === "push" ? "notification" : "in the app"}`} onClick={() => flip(k, c)}><i /></button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small">At most {p.max_per_hour} notifications an hour; beyond that they merge into one ("4 new approvals from Marketing and Sales").
        Low-risk approvals get an Approve button right on the notification when you signed in within the last 12 hours.</p>

      <button type="button" className="mi" style={{ paddingLeft: 0 }} onClick={() => save({ sound: !p.sound })}>
        <span className="t"><b>Play a sound</b><span className="small">for approvals and questions while Omilo is open</span></span>
        <span className={`switch ${p.sound ? "on" : ""}`} role="switch" aria-checked={p.sound}><i /></span>
      </button>
      {err && <div className="callout" style={{ marginTop: 10 }}>{err}</div>}

      {cfg.devices.length > 0 && (
        <p className="small" style={{ marginBottom: 0 }}>Background notifications go to {cfg.devices.length} browser{cfg.devices.length > 1 ? "s" : ""}
          {cfg.devices[0].last_ok_at ? `, last delivered ${ago(cfg.devices[0].last_ok_at)}` : ""}. They pause while a Omilo tab is open, so you never get two.</p>
      )}
    </div>
  );
}
