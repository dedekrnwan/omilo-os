"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { COLORS, Look, Mascot, PROPS, SHAPES, lookFor, saveLook, useLooks } from "./Avatar";

/* A helper's look: colour, shape and prop for its mascot, or a picture you upload. */
export default function LookEditor({ who }: { who: { id: string; name: string; role?: string; is_chief?: boolean } }) {
  const looks = useLooks();
  const cur = looks[who.id] || {};
  const look = lookFor(who, cur);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = async (patch: Look | null) => {
    setBusy(true); setErr(null);
    try { await saveLook(who.id, patch === null ? null : { ...cur, ...patch }); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { setErr("Use a PNG, JPEG, GIF or WebP picture."); return; }
    if (f.size > 4 * 1024 * 1024) { setErr("Pick a picture under 4 MB."); return; }
    const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.readAsDataURL(f); });
    try { const up = await api<{ id: string }>("/files", { body: { name: f.name, data } }); await set({ image: up.id }); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="look">
      <div className="look-preview"><Mascot look={look} size={96} title={who.name} /></div>
      <div className="look-opts">
        <label style={{ marginTop: 0 }}>Colour</label>
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} type="button" className={`swatch ${look.color === c && !look.image ? "on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`}
              disabled={busy} onClick={() => set({ color: c, image: null })} />
          ))}
        </div>
        <label>Shape</label>
        <div className="look-row">
          {SHAPES.map((sh) => (
            <button key={sh} type="button" className={`look-pick ${look.shape === sh && !look.image ? "on" : ""}`} disabled={busy} onClick={() => set({ shape: sh, image: null })} aria-label={`Shape ${sh}`}>
              <Mascot look={{ ...look, shape: sh, image: null }} size={40} />
            </button>
          ))}
        </div>
        <label>Prop</label>
        <div className="look-row">
          {Object.entries(PROPS).map(([p, label]) => (
            <button key={p} type="button" className={`look-pick ${look.prop === p && !look.image ? "on" : ""}`} title={label} aria-label={label} disabled={busy} onClick={() => set({ prop: p, image: null })}>
              <Mascot look={{ ...look, prop: p, image: null }} size={40} />
            </button>
          ))}
        </div>
        <div className="acts" style={{ marginTop: 14 }}>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn sm" disabled={busy} onClick={() => file.current?.click()}><i className="ri-image-add-line" />Use a picture</button>
          {(cur.color || cur.shape || cur.prop || cur.image) && <button className="btn sm quiet" disabled={busy} onClick={() => set(null)}>Back to the original</button>}
        </div>
        {err && <div className="error">{err}</div>}
      </div>
    </div>
  );
}
