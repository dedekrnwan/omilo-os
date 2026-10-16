"use client";
import { useCallback, useEffect, useState } from "react";
import { ago, api } from "@/lib/api";
import { usePoll } from "@/lib/poll";
import { NotifyConfig, disablePush, enableNotifications, permission } from "./Notify";

/* Settings → Notifications: turn them on for this browser, choose what to hear about, send a test. */
export default function NotifySettings() {
  const [cfg, setCfg] = useState<NotifyConfig | null>(null);
  const [perm, setPerm] = useState<string>("default");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { setPerm(permission()); try { setCfg(await api<NotifyConfig>("/notify")); } catch { /* ignore */ } }, []);
  usePoll(load, 60000, [load]);
  if (!cfg) return null;

  const state = perm === "granted" ? ["up", "On in this browser"] : perm === "denied" ? ["down", "Blocked in this browser"]
    : perm === "insecure" ? ["warn", "Needs https or localhost"] : perm === "unsupported" ? ["idle", "Not supported here"] : ["idle", "Off"];
  const toggle = async (k: string) => {
    setCfg({ ...cfg, prefs: await api(`/notify/prefs`, { method: "PUT", body: { [k]: !cfg.prefs[k] } }) });
    window.dispatchEvent(new Event("saga:notify-prefs"));
  };

  return (
    <div className="paper" style={{ marginBottom: 24 }}>
      <div className="acts" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Notifications</h2><span className={`chip ${state[0]}`}>{state[1]}</span>
      </div>
      <p className="note">Saga OS tells you right away when a helper needs you. Inside the app you see a small pop-up; when the tab is in the
        background or closed, your computer or phone shows a notification.</p>
      <div className="acts">
        {perm !== "granted" && perm !== "unsupported" && perm !== "insecure" && (
          <button className="btn primary" onClick={async () => { const r = await enableNotifications(); setMsg(r.detail); load(); }}><i className="ri-notification-3-line" />Turn on notifications</button>
        )}
        {perm === "granted" && <button className="btn" onClick={async () => { const r = await enableNotifications(); setMsg(r.detail); load(); }}>Reconnect this browser</button>}
        <button className="btn" onClick={async () => { await api("/notify/test", { body: {} }); setMsg("Sent. Switch to another tab to see it as a system notification."); }}>Send a test</button>
        {cfg.devices.length > 0 && <button className="btn quiet" onClick={async () => { await disablePush(); setMsg("This browser will not get notifications while Saga OS is closed."); load(); }}>Stop background notifications here</button>}
      </div>
      {msg && <div className="callout" style={{ marginTop: 10 }}>{msg}</div>}
      {perm === "denied" && <p className="small">Allow notifications in your browser's site settings (the icon left of the address), then press Reconnect.</p>}
      {perm === "insecure" && <p className="small">Browsers only allow notifications on https or on localhost. Open Saga OS at http://localhost:7700, or put it behind https.</p>}
      {!cfg.push && <p className="small">Background notifications (when no tab is open) need the <code>pywebpush</code> package on the server.</p>}

      <label>Tell me about</label>
      {Object.entries(cfg.kinds).map(([k, label]) => (
        <button key={k} type="button" className="mi" style={{ paddingLeft: 0 }} onClick={() => toggle(k)}>
          <span className="t"><b>{label}</b></span>
          <span className={`switch ${cfg.prefs[k] ? "on" : ""}`} role="switch" aria-checked={!!cfg.prefs[k]}><i /></span>
        </button>
      ))}
      {cfg.devices.length > 0 && (
        <p className="small" style={{ marginBottom: 0 }}>Background notifications go to {cfg.devices.length} browser{cfg.devices.length > 1 ? "s" : ""}
          {cfg.devices[0].last_ok_at ? `, last delivered ${ago(cfg.devices[0].last_ok_at)}` : ""}. They pause while a Saga OS tab is open, so you never get two.</p>
      )}
    </div>
  );
}
