"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BASE, api } from "@/lib/api";

/* Real-time notices: a live stream while Saga OS is open (toasts, and system notifications when the tab is in the
   background), and Web Push when no tab is open. The browser asks for permission only after the owner clicks. */

export type Notice = { id: number; at: string; kind: string; title: string; body: string; url: string; tag: string; level: string };
export type NotifyConfig = { kinds: Record<string, string>; prefs: Record<string, boolean>; push: boolean; vapid_public_key: string | null;
  devices: { id: string; agent: string; created_at: string; last_ok_at: string | null }[] };

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
  if (permission() === "insecure") return { ok: false, detail: "Browsers only allow notifications on https or localhost. Open Saga OS at http://localhost:7700 or behind https." };
  if (!supported()) return { ok: false, detail: "This browser does not support notifications. On iPhone, add Saga OS to the Home Screen first." };
  const p = await Notification.requestPermission();
  if (p !== "granted") return { ok: false, detail: p === "denied" ? "Notifications are blocked for this site. Allow them in the browser's site settings (the icon left of the address)." : "Not turned on." };
  const reg = await registration();
  const cfg = await api<NotifyConfig>("/notify");
  if (!reg || !cfg.push || !cfg.vapid_public_key || !("pushManager" in reg)) {
    return { ok: true, detail: "On. You will get notifications while Saga OS is open in a tab." };
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
    return { ok: true, detail: "On. You will get notifications even when Saga OS is closed (while the browser runs)." };
  } catch (e: any) {
    return { ok: true, detail: `On while Saga OS is open. Background push failed: ${e?.message || e}` };
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

const ICON: Record<string, string> = { inbox: "ri-inbox-2-line", reply: "ri-chat-3-line", job_done: "ri-checkbox-circle-line", job_failed: "ri-error-warning-line", test: "ri-notification-3-line" };

export default function NotifyHost({ onNotice }: { onNotice?: (n: Notice) => void }) {
  const router = useRouter();
  const path = usePathname();
  const [toasts, setToasts] = useState<Notice[]>([]);
  const [ask, setAsk] = useState(false);
  const [askMsg, setAskMsg] = useState<string | null>(null);
  const prefs = useRef<Record<string, boolean>>({ inbox: true, reply: true, job_failed: true, job_done: false });
  const unseen = useRef(0);
  const baseTitle = useRef<string>("");
  const cb = useRef(onNotice);
  cb.current = onNotice;

  const loadPrefs = useCallback(() => { api<NotifyConfig>("/notify").then((c) => { prefs.current = c.prefs; }).catch(() => {}); }, []);

  useEffect(() => {
    loadPrefs();
    const p = permission();
    let dismissed = false;
    try { dismissed = localStorage.getItem("saga.notify.ask") === "no"; } catch { /* ignore */ }
    setAsk(p === "default" && !dismissed);
    if (p === "granted") registration(); // keep the worker fresh
    window.addEventListener("saga:notify-prefs", loadPrefs);
    return () => window.removeEventListener("saga:notify-prefs", loadPrefs);
  }, [loadPrefs]);

  useEffect(() => {
    const vis = () => { if (!document.hidden) { unseen.current = 0; if (baseTitle.current) document.title = baseTitle.current; } };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);

  useEffect(() => {
    const es = new EventSource(`${BASE}/api/stream`, { withCredentials: true });
    es.addEventListener("notice", (ev) => {
      let n: Notice;
      try { n = JSON.parse((ev as MessageEvent).data); } catch { return; }
      cb.current?.(n);
      window.dispatchEvent(new CustomEvent("saga:notice", { detail: n }));
      if (n.kind !== "test" && prefs.current[n.kind] === false) return;
      const here = location.pathname + location.search;
      const looking = !document.hidden && document.hasFocus();
      if (looking && n.kind === "reply" && here.endsWith(n.url)) return; // already on screen
      if (looking) {
        setToasts((t) => [...t.filter((x) => !(n.tag && x.tag === n.tag)), n].slice(-3));
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), n.level === "critical" ? 15000 : 7000);
      } else {
        systemNotify(n).catch(() => {});
        if (!baseTitle.current || !document.title.startsWith("(")) baseTitle.current = document.title;
        unseen.current += 1;
        document.title = `(${unseen.current}) ${baseTitle.current}`;
      }
    });
    return () => es.close();
  }, []);

  const turnOn = async () => {
    const r = await enableNotifications();
    setAskMsg(r.detail);
    if (r.ok) setTimeout(() => setAsk(false), 2500);
  };
  const later = () => { setAsk(false); try { localStorage.setItem("saga.notify.ask", "no"); } catch { /* ignore */ } };

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
            onClick={() => { setToasts((x) => x.filter((y) => y.id !== t.id)); router.push(t.url); }}
            onKeyDown={(e) => { if (e.key === "Enter") router.push(t.url); }}>
            <i className={ICON[t.kind] || "ri-notification-3-line"} />
            <div className="tx"><b>{t.title}</b>{t.body && <span>{t.body}</span>}</div>
            <button className="iconbtn" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); setToasts((x) => x.filter((y) => y.id !== t.id)); }}><i className="ri-close-line" /></button>
          </div>
        ))}
      </div>
    </>
  );
}
