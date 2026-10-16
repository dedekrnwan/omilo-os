"use client";
import { useEffect, useState } from "react";
import { BASE, api } from "@/lib/api";
import { copy, menu } from "@/lib/menu";

/* The Browser panel: the pages a helper opened, as a real picture of the page. A screenshot the helper's own browser
   took comes first; otherwise Saga OS takes one with the Chrome on this computer. "Live" shows the page itself
   (some sites refuse to be shown inside another app; open them in a new tab then). */

export type Visit = { url: string; title?: string; image?: string; via?: string };
type Meta = { url: string; final_url?: string; status?: number; title?: string; description?: string; image?: string; site?: string; icon?: string; shot?: boolean };

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export default function BrowserView({ trail }: { trail: Visit[] }) {
  const pages = trail.filter((v, i) => trail.findIndex((x) => x.url === v.url) === i || v.image);  // newest first
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<"shot" | "live">("shot");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [shotState, setShotState] = useState<"loading" | "ok" | "failed">("loading");
  const [bust, setBust] = useState(0);
  useEffect(() => { setI(0); }, [pages.length]);  // follow the helper to its newest page
  const cur = pages[Math.min(i, pages.length - 1)];
  useEffect(() => {
    setMeta(null); setMetaErr(null); setShotState("loading");
    if (!cur) return;
    api<Meta>(`/browser/preview?url=${encodeURIComponent(cur.url)}`).then(setMeta).catch((e) => setMetaErr(e.message));
  }, [cur?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur) return <div className="empty"><b>No pages opened yet</b><span>When a helper searches or opens a website, you see it here.</span></div>;
  const shotUrl = cur.image || `${BASE}/api/browser/shot?url=${encodeURIComponent(cur.url)}${bust ? `&fresh=1&b=${bust}` : ""}`;
  const title = meta?.title || (cur.title && cur.title !== cur.url ? cur.title : "") || host(cur.url);
  return (
    <div className="bv">
      <div className="browser">
        <div className="bar">
          <button className="iconbtn" aria-label="Back" disabled={i >= pages.length - 1} onClick={() => setI(i + 1)}><i className="ri-arrow-left-line" /></button>
          <button className="iconbtn" aria-label="Forward" disabled={i <= 0} onClick={() => setI(i - 1)}><i className="ri-arrow-right-line" /></button>
          <button className="iconbtn" aria-label="Take a new picture" onClick={() => { setMode("shot"); setShotState("loading"); setBust(Date.now()); }}><i className="ri-refresh-line" /></button>
          <span className="url" title={cur.url} onContextMenu={menu(() => [{ label: "Copy address", icon: "ri-link", onSelect: () => copy(cur.url) },
            { label: "Open in a new tab", icon: "ri-external-link-line", onSelect: () => window.open(cur.url, "_blank", "noopener") }])}>
            {meta?.icon && <img src={meta.icon} alt="" width={14} height={14} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}{cur.url}</span>
          <div className="seg bv-mode">
            <button className={mode === "shot" ? "on" : ""} onClick={() => setMode("shot")}>Picture</button>
            <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>Live</button>
          </div>
          <a className="iconbtn" href={cur.url} target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab"><i className="ri-external-link-line" /></a>
        </div>
        <div className="view bv-view">
          {mode === "live" ? (
            <iframe key={cur.url} src={cur.url} title={title} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
          ) : (
            <>
              {shotState !== "failed" && (
                <img key={shotUrl} src={shotUrl} alt={title} className={shotState === "loading" ? "loading" : ""}
                  onLoad={() => setShotState("ok")} onError={() => setShotState("failed")} />
              )}
              {shotState === "loading" && <div className="bv-wait"><span className="spin" /> Taking a picture of the page…</div>}
              {shotState === "failed" && (
                meta?.image ? <img src={meta.image} alt={title} /> :
                  <div className="bv-none"><i className="ri-global-line" /><b>{title}</b>
                    <span className="small">{meta?.shot === false ? "Install Chrome on this computer to see pictures of pages here." : "A picture of this page could not be taken."} Try Live, or open it in a new tab.</span></div>
              )}
            </>
          )}
        </div>
      </div>
      <div className="bv-meta">
        <b>{title}</b>
        {meta?.description && <span className="small">{meta.description}</span>}
        <span className="small">{meta?.site ? `${meta.site} · ` : ""}{host(meta?.final_url || cur.url)}{cur.via ? ` · ${cur.via === "browser" ? "opened in the helper's browser" : cur.via === "WebSearch" ? "found by searching" : "read by the helper"}` : ""}</span>
        {metaErr && <span className="small">{metaErr}</span>}
      </div>
      {pages.length > 1 && (
        <div className="sec" style={{ marginTop: 14 }}>
          <div className="small" style={{ marginBottom: 6 }}>All pages · {pages.length}</div>
          {pages.slice(0, 30).map((p, k) => (
            <button key={k} className={`ws-item ${k === i ? "on" : ""}`} onClick={() => { setI(k); setMode("shot"); }}
              onContextMenu={menu(() => [{ label: "Open in a new tab", icon: "ri-external-link-line", onSelect: () => window.open(p.url, "_blank", "noopener") },
                { label: "Copy address", icon: "ri-link", onSelect: () => copy(p.url) }])}>
              <i className={p.image ? "ri-image-line" : "ri-global-line"} /><span className="t"><b>{p.title && p.title !== p.url ? p.title : host(p.url)}</b><span>{p.url}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
