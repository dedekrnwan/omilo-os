"use client";
import { useEffect, useState } from "react";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";

/* Which embedding model turns knowledge into vectors (Settings → Knowledge, and the drawer in Docs → Knowledge). */
const BLURB: Record<string, string> = {
  local: "Free and private. Downloads once (~220 MB), then works offline. Understands Indonesian.",
  voyage: "Anthropic's recommended embeddings. Best quality; billed by Voyage per token.",
  openai: "text-embedding-3. Cheap and good; billed by OpenAI.",
  hash: "Word matching only (for tests).",
};

export default function KnowledgeSettings({ onChanged }: { onChanged?: () => void }) {
  const [s, setS] = useState<any>(null);
  const [form, setForm] = useState<{ provider: string; model: string; api_key: string }>({ provider: "local", model: "", api_key: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<any>("/kb/settings").then((x) => { setS(x); setForm({ provider: x.current.provider || "local", model: x.current.model || "", api_key: "" }); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (!s) return <><p className="small">Loading…</p><Err error={err} /></>;
  const p = s.providers?.[form.provider];
  const dirty = form.provider !== s.current.provider || (form.model || Object.keys(p?.models || {})[0]) !== s.current.model || !!form.api_key;
  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api("/kb/settings", { method: "PUT", body: { provider: form.provider, model: form.model || null, api_key: form.api_key || null } });
      setMsg("Saved. Knowledge is re-embedded in the background; search by words keeps working meanwhile.");
      load(); onChanged?.();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const reindex = async () => {
    if (!(await confirmDialog({ title: "Re-embed all knowledge?", body: "Every piece is embedded again in the background. Search keeps working by words meanwhile.", confirm: "Re-embed" }))) return;
    const r = await api<{ chunks: number }>("/kb/reindex", { body: {} });
    setMsg(`Re-embedding ${r.chunks} pieces in the background.`); onChanged?.();
  };
  return (
    <div className="ks">
      <div className="set-radio">
        {Object.entries(s.providers as Record<string, any>).filter(([k]) => k !== "hash" || s.current.provider === "hash").map(([k, v]) => (
          <button key={k} type="button" className={`set-opt ${form.provider === k ? "on" : ""}`} onClick={() => setForm({ provider: k, model: Object.keys(v.models)[0], api_key: "" })}>
            <span className="dot" /><span className="t"><b>{v.label}{k === "local" && <em className="chip up">Default</em>}</b><span>{BLURB[k]}</span></span>
          </button>
        ))}
      </div>
      {p && (
        <div className="set-fields">
          <label>Model</label>
          <select value={form.model || Object.keys(p.models)[0]} onChange={(e) => setForm({ ...form, model: e.target.value })}>
            {Object.entries(p.models as Record<string, string>).map(([m, l]) => <option key={m} value={m}>{l}</option>)}
          </select>
          {p.needs_key && (
            <>
              <label>API key</label>
              <input type="password" autoComplete="off" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                placeholder={s.keys[form.provider] ? `Saved: …${s.keys[form.provider]}` : "Paste the key"} />
              <p className="dw-help">Stored encrypted; only the last 4 characters are shown again.</p>
            </>
          )}
        </div>
      )}
      {s.current.provider === "local" && s.current.local?.error && <div className="error">{s.current.local.error}</div>}
      <p className="small">Now: <b>{s.providers[s.current.provider]?.label || s.current.provider}</b> · {String(s.current.model || "").split("/").pop()}{s.current.dim ? ` · ${s.current.dim} dims` : ""}
        {s.current.provider === "local" && <> · {s.current.local?.loaded ? "loaded" : "loads on first use"}</>}</p>
      {msg && <div className="callout ok" style={{ margin: "8px 0" }}>{msg}</div>}
      <Err error={err} />
      <div className="acts">
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? "Checking…" : "Save"}</button>
        <button className="btn quiet" onClick={reindex}><i className="ri-refresh-line" />Re-embed everything</button>
      </div>
    </div>
  );
}
