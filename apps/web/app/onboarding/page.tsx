"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

type Templates = {
  roles: Record<string, { name: string; job: string; shifts: { name: string; cron: string }[] }>;
  presets: Record<string, { label: string; concurrent: number; roles: string[] }>;
  knowledge_files: Record<string, string>;
};

const HINTS: Record<string, string> = {
  "company.md": "What you sell, to whom, where, stage, team size, what makes you different.",
  "goals.md": "Current phase and 3-5 goals with numbers and dates.",
  "customers.md": "Segments, buyer vs user, pains, objections.",
  "offer.md": "Products, plans, prices, and what is NOT live yet (agents must not sell it).",
  "voice.md": "Language, tone, words to use and avoid, an example you like.",
  "systems.md": "Tools and systems in use; where code and data live.",
  "rules.md": "Hard lines: never say, never do, legal limits, who may be contacted.",
};

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [t, setT] = useState<Templates | null>(null);
  const [company, setCompany] = useState("");
  const [files, setFiles] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState("small");
  const [engine, setEngine] = useState<{ type: string; base_url: string; model: string }>({ type: "fake", base_url: "http://127.0.0.1:8642/v1", model: "hermes-agent" });
  const [concurrent, setConcurrent] = useState(4);
  const [tokens, setTokens] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const tp = await api<Templates>("/templates");
      setT(tp);
      const s = await api<{ company_name: string }>("/setup");
      setCompany(s.company_name || "");
      const have = new Set((await api<{ name: string }[]>("/knowledge")).map((f) => f.name));
      const existing: Record<string, string> = {};
      for (const k of Object.keys(tp.knowledge_files)) {
        existing[k] = have.has(k) ? (await api<{ content: string }>(`/knowledge/${k}`)).content : tp.knowledge_files[k];
      }
      setFiles(existing);
    })().catch((e) => setErr(e.message));
  }, []);

  const saveCompany = async () => {
    setErr(null);
    try { await api("/onboarding/company", { body: { company_name: company, files } }); setStep(2); } catch (e: any) { setErr(e.message); }
  };
  const applyTeam = async () => {
    setErr(null);
    try {
      const eng = engine.type === "fake" ? { type: "fake" } : { type: "hermes", base_url: engine.base_url, model: engine.model };
      const r = await api<{ mcp_tokens: Record<string, string> }>("/team/apply", { body: { preset, engine: eng, max_concurrent_tasks: concurrent } });
      setTokens(r.mcp_tokens);
      setStep(3);
    } catch (e: any) { setErr(e.message); }
  };

  if (!t) return <p className="small">Loading…</p>;
  const roster = t.presets[preset]?.roles || [];

  return (
    <div>
      <div className="eyebrow">Onboarding · step {step} of 3</div>
      <h1>{step === 1 ? "Your company" : step === 2 ? "Your team" : "Connect the engine"}</h1>

      {step === 1 && (
        <>
          <p className="sub">Agents read these files before every task. Write what a new hire would need on day one; you can edit them later in Company.</p>
          <label>Company name</label>
          <input value={company} onChange={(e) => setCompany(e.target.value)} />
          {Object.keys(t.knowledge_files).map((k) => (
            <div key={k}>
              <label>{k} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· {HINTS[k]}</span></label>
              <textarea value={files[k] || ""} onChange={(e) => setFiles({ ...files, [k]: e.target.value })} rows={5} />
            </div>
          ))}
          <div className="acts" style={{ marginTop: 16 }}><button className="btn primary" onClick={saveCompany} disabled={!company}>Save and continue</button></div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="sub">How many agents may work at the same time decides the recommended team. Everything is editable later in Staff.</p>
          <div className="seg">
            {Object.entries(t.presets).map(([k, p]) => (
              <button key={k} className={preset === k ? "on" : ""} onClick={() => { setPreset(k); setConcurrent(p.concurrent); }}>{p.label}</button>
            ))}
          </div>
          <div className="cards" style={{ marginTop: 16 }}>
            {roster.map((r) => (
              <div className="card" key={r}>
                <span className="fn small">{r}</span><b>{t.roles[r]?.name}</b>
                <span className="small">{t.roles[r]?.shifts.map((s) => `${s.name} (${s.cron})`).join(", ")}</span>
              </div>
            ))}
          </div>
          <div className="grid2">
            <div>
              <label>Agents working at the same time</label>
              <input type="number" min={1} max={50} value={concurrent} onChange={(e) => setConcurrent(Number(e.target.value))} />
            </div>
            <div>
              <label>Engine</label>
              <select value={engine.type} onChange={(e) => setEngine({ ...engine, type: e.target.value })}>
                <option value="fake">Demo engine (no AI, for trying it out)</option>
                <option value="hermes">Hermes (OpenAI-compatible API server)</option>
              </select>
            </div>
          </div>
          {engine.type === "hermes" && (
            <div className="grid2">
              <div><label>Hermes API base URL</label><input value={engine.base_url} onChange={(e) => setEngine({ ...engine, base_url: e.target.value })} /></div>
              <div><label>Model name</label><input value={engine.model} onChange={(e) => setEngine({ ...engine, model: e.target.value })} /></div>
            </div>
          )}
          <p className="note">New installs start strict: anything that leaves the company needs your approval. You can loosen it per agent later.</p>
          <div className="acts"><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn primary" onClick={applyTeam}>Create the team</button></div>
        </>
      )}

      {step === 3 && tokens && (
        <>
          <p className="sub">Each agent connects back to Saga OS through MCP with its own token. These tokens are shown once; copy them into each Hermes profile now (you can rotate them later in Staff).</p>
          <pre className="code">{JSON.stringify(Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, {
            url: `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/mcp`, headers: { Authorization: `Bearer ${v}` } }])), null, 2)}</pre>
          {engine.type === "fake" && <p className="note">You chose the demo engine: it already knows the tokens, nothing to copy.</p>}
          <div className="acts"><button className="btn primary" onClick={() => router.replace("/")}>Go to the Inbox</button></div>
        </>
      )}
      <Err error={err} />
    </div>
  );
}
