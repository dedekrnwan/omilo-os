"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BASE, api } from "@/lib/api";
import { openInDrawer, visibleThreads } from "@/lib/open";

/* Real-time notices: a live stream while Omilo is open (toasts, and system notifications when the tab is in the
   background), and Web Push when no tab is open. The browser asks for permission only after the owner clicks. */

export type Notice = { id: number; at: string; kind: string; title: string; body: string; url: string; tag: string; level: string; item_id?: string | null };
export type NotifyPrefs = { kinds: Record<string, Record<string, boolean>>; quiet: { on: boolean; start: string; end: string };
  focus: { from: string; until: string } | null; sound: boolean; max_per_hour: number };
export type NotifyConfig = { kinds: Record<string, string>; channels: Record<string, string>; prefs: NotifyPrefs; quiet_now: boolean; focus_now: boolean;
  timezone: string; push: boolean; vapid_public_key: string | null; devices: { id: string; agent: string; created_at: string; last_ok_at: string | null }[] };

const PREF_KEY: Record<string, string> = { nudge: "inbox", digest: "inbox" };
const wants = (p: NotifyPrefs | null, kind: string, ch: string) => kind === "test" || !p || p.kinds[PREF_KEY[kind] || kind]?.[ch] !== false;

/* A short two-note chime (no audio file needed). */
function chime(critical: boolean) {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    const notes = critical ? [880, 660, 880] : [660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.type = "sine";
      const t = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.16);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch { /* no audio here */ }
}

export const supported = () => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
export const permission = (): NotificationPermission | "unsupported" | "insecure" =>
  typeof window === "undefined" ? "unsupported" : !window.isSecureContext ? "insecure" : supported() ? Notification.permission : "unsupported";

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!supported() || !window.isSecureContext) return null;
  try { return await navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }); } catch { return null; }
}

const b64ToBytes = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Ask the browser for permission (must run from a click), then subscribe this browser to Web Push. */
export async function enableNotifications(): Promise<{ ok: boolean; detail: string }> {
  if (permission() === "insecure") return { ok: false, detail: "Browsers only allow notifications on https or localhost. Open Omilo at http://localhost:7700 or behind https." };
  if (!supported()) return { ok: false, detail: "This browser does not support notifications. On iPhone, add Omilo to the Home Screen first." };
  const p = await Notification.requestPermission();
  if (p !== "granted") return { ok: false, detail: p === "denied" ? "Notifications are blocked for this site. Allow them in the browser's site settings (the icon left of the address)." : "Not turned on." };
  const reg = await registration();
  const cfg = await api<NotifyConfig>("/notify");
  if (!reg || !cfg.push || !cfg.vapid_public_key || !("pushManager" in reg)) {
    return { ok: true, detail: "On. You will get notifications while Omilo is open in a tab." };
  }
  try {
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = b64ToBytes(cfg.vapid_public_key);
    if (sub && sub.options.applicationServerKey) {
      const cur = new Uint8Array(sub.options.applicationServerKey as ArrayBuffer);
      if (cur.length !== key.length || cur.some((v, i) => v !== key[i])) { await sub.unsubscribe(); sub = null; }
    }
    sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const j = sub.toJSON();
    await api("/notify/subscribe", { body: { endpoint: j.endpoint, keys: j.keys, agent: navigator.userAgent.slice(0, 200) } });
    return { ok: true, detail: "On. You will get notifications even when Omilo is closed (while the browser runs)." };
  } catch (e: any) {
    return { ok: true, detail: `On while Omilo is open. Background push failed: ${e?.message || e}` };
  }
}

export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager?.getSubscription();
  if (sub) { await api("/notify/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => {}); await sub.unsubscribe(); }
}

async function systemNotify(n: Notice) {
  if (permission() !== "granted") return;
  const reg = await registration();
  const opts: NotificationOptions = { body: n.body, tag: n.tag || undefined, icon: `${BASE}/icon-192.png`, data: { url: BASE + n.url }, requireInteraction: n.level === "critical" };
  if (reg) { await reg.showNotification(n.title, opts); return; }
  const x = new Notification(n.title, opts);
  x.onclick = () => { window.focus(); location.href = BASE + n.url; };
}

const ICON: Record<string, string> = { inbox: "ri-inbox-2-line", nudge: "ri-alarm-line", reply: "ri-chat-3-line", job_done: "ri-checkbox-circle-line",
  job_failed: "ri-error-warning-line", test: "ri-notification-3-line" };

export default function NotifyHost({ onNotice }: { onNotice?: (n: Notice) => void }) {
  const router = useRouter();
  const path = usePathname();
  const [toasts, setToasts] = useState<Notice[]>([]);
  const [ask, setAsk] = useState(false);
  const [askMsg, setAskMsg] = useState<string | null>(null);
  const prefs = useRef<NotifyPrefs | null>(null);
  const calm = useRef(false); // quiet hours or focus right now: no sound
  const cb = useRef(onNotice);
  cb.current = onNotice;

  const loadPrefs = useCallback(() => {
    api<NotifyConfig>("/notify").then((c) => { prefs.current = c.prefs; calm.current = c.quiet_now || c.focus_now; }).catch(() => {});
  }, []);
  useEffect(() => { const t = setInterval(loadPrefs, 5 * 60000); return () => clearInterval(t); }, [loadPrefs]); // quiet hours begin and end

  useEffect(() => {
    loadPrefs();
    const p = permission();
    let dismissed = false;
    try { dismissed = localStorage.getItem("omilo.notify.ask") === "no"; } catch { /* ignore */ }
    setAsk(p === "default" && !dismissed);
    if (p === "granted") registration(); // keep the worker fresh
    window.addEventListener("omilo:notify-prefs", loadPrefs);
    return () => window.removeEventListener("omilo:notify-prefs", loadPrefs);
  }, [loadPrefs]);


  useEffect(() => {
    const es = new EventSource(`${BASE}/api/stream`, { withCredentials: true });
    es.addEventListener("notice", (ev) => {
      let n: Notice;
      try { n = JSON.parse((ev as MessageEvent).data); } catch { return; }
      cb.current?.(n);
      window.dispatchEvent(new CustomEvent("omilo:notice", { detail: n }));
      if (!wants(prefs.current, n.kind, "app")) return;
      const here = location.pathname + location.search;
      const looking = !document.hidden && document.hasFocus();
      if (looking && n.kind === "reply" && (here.endsWith(n.url) || [...visibleThreads].some((t) => n.url.includes(t)))) return; // already on screen
      const hush = calm.current && n.level !== "critical"; // quiet hours or focus: Critical only
      if (prefs.current?.sound && !hush && (n.kind === "inbox" || n.kind === "nudge" || n.level === "critical")) chime(n.level === "critical");
      if (looking) {
        setToasts((t) => [...t.filter((x) => !(n.tag && x.tag === n.tag)), n].slice(-3));
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), n.level === "critical" ? 15000 : 7000);
      } else if (!hush) {
        systemNotify(n).catch(() => {}); // the tab title and icon already show the Inbox count (see Shell)
      }
    });
    return () => es.close();
  }, []);

  const turnOn = async () => {
    const r = await enableNotifications();
    setAskMsg(r.detail);
    if (r.ok) setTimeout(() => setAsk(false), 2500);
  };
  const later = () => { setAsk(false); try { localStorage.setItem("omilo.notify.ask", "no"); } catch { /* ignore */ } };

  return (
    <>
      {ask && path !== "/onboarding/" && (
        <div className="notify-ask" role="region" aria-label="Notifications">
          <i className="ri-notification-3-line" />
          <span className="grow">{askMsg || "Get a notification when a helper needs your approval or replies, even when this tab is in the background."}</span>
          {!askMsg && <button className="btn sm primary" onClick={turnOn}>Turn on</button>}
          <button className="btn sm quiet" onClick={later}>{askMsg ? "Close" : "Not now"}</button>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`} role="button" tabIndex={0}
            onClick={() => { setToasts((x) => x.filter((y) => y.id !== t.id)); if (!openInDrawer(t.url)) router.push(t.url); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !openInDrawer(t.url)) router.push(t.url); }}>
            <i className={ICON[t.kind] || "ri-notification-3-line"} />
            <div className="tx"><b>{t.title}</b>{t.body && <span>{t.body}</span>}</div>
            <button className="iconbtn" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}><i className="ri-close-line" /></button>
          </div>
        ))}
      </div>
    </>
  );
}
