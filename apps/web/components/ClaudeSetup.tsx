"use client";
import { useState } from "react";
import { api } from "@/lib/api";

/* Paste a Claude API key, check it, pick a model in plain words. Used by onboarding and Settings.
   The key is sent to Omilo only when saved (stored encrypted); it is never kept in the onboarding draft. */

export type ClaudeChoice = { key: string; model: string; ok: boolean };
type Model = { id: string; name: string };

function tier(id: string): { label: string; detail: string; rank: number } {
  if (id.includes("sonnet")) return { label: "Balanced", detail: "Smart and fast. The best fit for most work.", rank: 0 };
  if (id.includes("opus")) return { label: "Smartest", detail: "For hard thinking. Slower and costs more.", rank: 1 };
  if (id.includes("haiku")) return { label: "Fastest and cheapest", detail: "Good for simple, repetitive jobs.", rank: 2 };
  return { label: "", detail: "", rank: 9 };
}

/* Newest model of each tier first (the API lists newest first). */
function mainModels(models: Model[]): Model[] {
  const seen = new Set<number>();
  return models.filter((m) => {
    const r = tier(m.id).rank;
    if (r === 9 || seen.has(r)) return false;
    seen.add(r);
    return true;
  }).sort((a, b) => tier(a.id).rank - tier(b.id).rank);
}

export default function ClaudeSetup({ value, onChange, savedHint }: {
  value: ClaudeChoice; onChange: (v: ClaudeChoice) => void; savedHint?: string | null;
}) {
  const [models, setModels] = useState<Model[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const check = async () => {
    setChecking(true); setMsg(null);
    try {
      const r = await api<{ ok: boolean; error?: string; models?: Model[]; recommended?: string }>("/ai/check", { body: { api_key: value.key } });
      if (!r.ok) { setMsg(r.error || "That key did not work."); onChange({ ...value, ok: false }); return; }
      setModels(r.models || []);
      onChange({ ...value, ok: true, model: value.model && r.models?.some((m) => m.id === value.model) ? value.model : (r.recommended || "") });
    } catch (e: any) { setMsg(e.message); } finally { setChecking(false); }
  };

  const shown = models ? (showAll ? models : mainModels(models)) : [];
  return (
    <div>
      <div className="q">
        <b>Your Claude API key</b>
        <span className="hint">
          Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> → API keys → Create key.
          You pay Anthropic directly for what your helpers use. The key is stored encrypted and never shown again.
        </span>
        <div className="acts" style={{ flexWrap: "nowrap" }}>
          <input type="password" autoComplete="off" spellCheck={false} value={value.key}
            placeholder={savedHint ? `Saved key ending in ${savedHint} (paste a new one to replace it)` : "sk-ant-…"}
            onChange={(e) => { onChange({ ...value, key: e.target.value, ok: false }); setModels(null); setMsg(null); }} />
          <button type="button" className="btn" onClick={check} disabled={checking || (!value.key.trim() && !savedHint)}>{checking ? "Checking…" : "Check key"}</button>
        </div>
        {msg && <div className="error">{msg}</div>}
        {value.ok && <div className="callout ok" style={{ margin: "10px 0 0" }}>✓ The key works.</div>}
      </div>
      {models && models.length > 0 && (
        <div className="q">
          <b>Which Claude should your helpers use?</b>
          <span className="hint">You can change this later in Settings.</span>
          {shown.map((m) => {
            const t = tier(m.id);
            return (
              <button type="button" key={m.id} className={`choice ${value.model === m.id ? "on" : ""}`} onClick={() => onChange({ ...value, model: m.id })}>
                <b>{t.label ? `${t.label} · ` : ""}{m.name}{t.rank === 0 && <span className="rec">Recommended</span>}</b>
                {t.detail && <span>{t.detail}</span>}
              </button>
            );
          })}
          <button type="button" className="btn quiet" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${models.length} models`}</button>
        </div>
      )}
    </div>
  );
}
