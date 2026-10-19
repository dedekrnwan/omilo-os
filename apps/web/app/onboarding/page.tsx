"use client";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import StepCard, { Tone } from "@/components/StepCard";
import ClaudeCodeSetup from "@/components/ClaudeCodeSetup";
import ProviderLogo from "@/components/ProviderLogo";
import Avatar from "@/components/Avatar";
import { Err } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import OmiloGuide from "@/components/OmiloGuide";

/* Onboarding, AI first, for owners who are not technical:
   1. Pick your AI: cards with each provider's logo; paste a key, use your Claude subscription, or try without AI.
   2. The interview: the AI interviews you about the business like an advisor (one question at a time, digs into vague
      answers, brainstorms options you can click), following topics we set; what it learns fills your company profile,
      which you can see and correct on the left.
   3. Your team: the helpers that fit what you said, each with its own focus and why; edit, remove or add.
   4. Done: every helper writes to you with how it sees its job, goals and first ideas, for you to approve. */

type Opt = Record<string, string | { label: string; [k: string]: unknown }>;
type Options = { industries: Opt; stages: Opt; team_sizes: Opt; goals: Opt; tones: Opt; languages: Opt; tools: Opt;
  rules: Record<string, { label: string; default: boolean }>; approval_modes: Record<string, { label: string; detail: string; strict: boolean }> };
type Answers = Record<string, any> & { company_name: string };
type Provider = { id: string; label: string; by: string; domain: string; kind: "key" | "subscription" | "local"; blurb: string; key_url?: string;
  recommended?: boolean; more?: boolean; has_key?: boolean };
type Ai = { provider: string; label: string; model?: string | null; chosen: boolean };
type Hist = { role: "owner" | "ai"; text: string; options?: string[]; field?: string; multi?: boolean; saved?: string[] };
type Topic = { id: string; label: string; icon: string; done: boolean; filled: number; of: number };
type Helper = { id: string; base: string; name: string; focus: string; why: string };
type RoleCard = { id: string; name: string; tagline: string; summary: string };
type State = { answers: Answers; step: number; options: Options; timezone: string; ai: Ai; providers: Provider[];
  interview: { history: Hist[]; topic: string }; topics: Topic[]; team: Helper[] | null };
type Turn = { history: Hist[]; topic: string; answers: Answers; coverage: Topic[]; ai: Ai };

const STEPS: { id: string; title: string; icon: string; tone: Tone }[] = [
  { id: "welcome", title: "Welcome", icon: "ri-hand-heart-line", tone: "violet" },
  { id: "ai", title: "Your AI", icon: "ri-sparkling-2-line", tone: "violet" },
  { id: "interview", title: "Get to know you", icon: "ri-question-answer-line", tone: "orange" },
  { id: "team", title: "Your team", icon: "ri-team-line", tone: "green" },
];
const label = (v: Opt[string] | undefined) => (v === undefined ? "" : typeof v === "string" ? v : v.label);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "helper";
function browserTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } }
function allTimezones(current: string): string[] {
  try { const l = (Intl as any).supportedValuesOf("timeZone") as string[]; return l.includes(current) ? l : [current, ...l]; }
  catch { return Array.from(new Set([current, "UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "Europe/London", "America/New_York"])); }
}

/* ------------------------------------------------------------------ 1. pick your AI */
function AiStep({ providers, ai, onDone }: { providers: Provider[]; ai: Ai; onDone: (ai: Ai) => void }) {
  const [sel, setSel] = useState<string | null>(ai.chosen && ai.provider !== "fake" ? (ai.provider === "anthropic" ? "claude" : ai.provider) : null);
  const [more, setMore] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [subReady, setSubReady] = useState(false);
  const [token, setToken] = useState("");
  const p = providers.find((x) => x.id === sel);
  const connect = async (provider: string) => {
    setBusy(true); setErr(null);
    try {
      if (provider === "claude-code" && token.trim()) await api("/harness/accounts", { body: { label: "My Claude", token: token.trim() } });
      onDone(await api<Ai>("/onboarding/ai", { body: { provider, api_key: key.trim() || undefined, model: model.trim() || undefined } }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const shown = providers.filter((x) => !x.more || more || x.id === sel);
  return (
    <>
      <h1>Which AI should your team think with?</h1>
      <p className="lead">Your helpers, and the interview that comes next, run on the AI you pick. You can change it later.</p>
      <div className="pcards">
        {shown.map((x) => (
          <button key={x.id} type="button" className={`pcard ${sel === x.id ? "on" : ""}`} onClick={() => { setSel(x.id); setErr(null); }} aria-pressed={sel === x.id}>
            <ProviderLogo id={x.id} domain={x.domain} label={x.label} />
            <span className="pc-t"><b>{x.label}</b><span className="small">{x.by}</span></span>
            {x.recommended && <span className="chip up pc-rec">Recommended</span>}
            {x.has_key && <span className="chip pc-rec">{x.kind === "subscription" ? "Connected" : "Key saved"}</span>}
            <span className="pc-b">{x.blurb}</span>
          </button>
        ))}
      </div>
      {!more && providers.some((x) => x.more) && <button type="button" className="btn quiet sm" onClick={() => setMore(true)}><i className="ri-add-line" />More AI providers</button>}

      {p && (
        <div className="paper pconnect">
          {p.kind === "key" ? (
            <>
              <label style={{ marginTop: 0 }}>Your {p.label} API key</label>
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
                placeholder={p.has_key ? "Saved. Paste a new one to replace it" : "Paste it here"} />
              <p className="small">Get one at <a href={p.key_url} target="_blank" rel="noopener noreferrer">{p.key_url?.replace(/^https:\/\//, "").split("/")[0]}</a>: sign in, create a key, copy it here.
                It is stored encrypted and only used by your Omilo.</p>
              <details><summary className="small">Advanced: a specific model</summary>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Leave empty for a good default" /></details>
            </>
          ) : p.kind === "local" ? (
            <p style={{ marginTop: 0 }}>Use your own Claude Code sign-in on this machine — no key needed.</p>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>Use your Claude Pro or Max plan. Omilo runs Claude Code on this computer with it.</p>
              <ClaudeCodeSetup autoInstall onReady={setSubReady} />
              <label>Your Claude token</label>
              <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={p.has_key ? "Connected. Paste another to add it" : "sk-ant-oat…"} />
              <p className="small">In the Terminal app run <code>claude setup-token</code>, sign in with your Claude account in the browser, then paste the token it shows.</p>
            </>
          )}
          <div className="acts" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={busy || (p.kind === "key" && !key.trim() && !p.has_key) || (p.kind === "subscription" && ((!token.trim() && !p.has_key) || !subReady))}
              onClick={() => connect(p.id)}>{busy ? "Checking…" : `Connect ${p.label}`}</button>
          </div>
          <Err error={err} />
        </div>
      )}
      <p className="small" style={{ marginTop: 18 }}>No AI account yet? <button type="button" className="linkbtn" disabled={busy} onClick={() => connect("fake")}>Try Omilo without AI first</button>:
        a short list of fixed questions, and helpers show sample work. Connect an AI any time in Settings.</p>
    </>
  );
}

/* ------------------------------------------------------------------ 2. the interview */
const SHOWN: Record<string, [string, string][]> = {
  business: [["company_name", "Name"], ["one_liner", "What you do"], ["industry", "Type"], ["stage", "Stage"], ["location", "Where"]],
  customers: [["customers", "Customers"], ["customer_problem", "What they need"], ["customer_objections", "Why they hesitate"]],
  offer: [["offers", "Products and prices"], ["different", "What makes you different"]],
  goals: [["goals", "Goals"], ["goal_notes", "Targets"]],
  work: [["workload", "Your time goes to"], ["handoff", "Hand off first"], ["team_size", "Team"]],
  voice: [["languages", "Language"], ["tones", "Tone"], ["avoid", "Avoid"]],
  rules: [["tools", "Apps you use"], ["rules_other", "Your own rules"]],
};
const ENUM: Record<string, keyof Options> = { industry: "industries", stage: "stages", team_size: "team_sizes", goals: "goals", languages: "languages", tones: "tones", tools: "tools" };
const TEXT_EDIT = new Set(["company_name", "one_liner", "location", "customers", "customer_problem", "customer_objections", "different", "workload", "handoff", "avoid", "rules_other"]);

function show(a: Answers, f: string, o: Options): string {
  const v = a[f];
  if (f === "offers") return (v || []).filter((x: any) => x.name).map((x: any) => x.price ? `${x.name} (${x.price})` : x.name).join(", ");
  if (f === "goal_notes") return Object.values(v || {}).filter(Boolean).join("; ");
  if (ENUM[f]) return Array.isArray(v) ? v.map((k: string) => label(o[ENUM[f]][k] as any) || k).join(", ") : label(o[ENUM[f]][v] as any) || "";
  return String(v || "");
}

function Profile({ a, o, topics, topic, onEdit }: { a: Answers; o: Options; topics: Topic[]; topic: string; onEdit: (f: string, v: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [val, setVal] = useState("");
  const done = topics.filter((t) => t.done).length;
  return (
    <div className="iv-profile">
      <div className="iv-ph"><b>What I&apos;ve learned</b><span className="small">{done} of {topics.length} topics</span></div>
      <div className="iv-bar"><i style={{ width: `${(done / Math.max(1, topics.length)) * 100}%` }} /></div>
      {topics.map((t) => (
        <section key={t.id} className={`iv-topic ${t.id === topic ? "now" : ""} ${t.done ? "done" : ""}`}>
          <h4><i className={t.done ? "ri-checkbox-circle-fill" : t.icon} />{t.label}</h4>
          {(SHOWN[t.id] || []).map(([f, l]) => {
            const v = show(a, f, o);
            if (!v && editing !== f) return null;
            return (
              <div key={f} className="iv-field">
                <span className="small">{l}</span>
                {editing === f ? (
                  <div><textarea rows={2} autoFocus value={val} onChange={(e) => setVal(e.target.value)} />
                    <div className="acts" style={{ gap: 6 }}><button className="btn sm primary" onClick={() => { onEdit(f, val); setEditing(null); }}>Save</button>
                      <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button></div></div>
                ) : (
                  <span className="iv-v">{v}{TEXT_EDIT.has(f) && <button className="iconbtn" aria-label={`Edit ${l}`} title="Correct this" onClick={() => { setEditing(f); setVal(String(a[f] || "")); }}><i className="ri-pencil-line" /></button>}</span>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function Interview({ st, onAnswers, onDone }: { st: State; onAnswers: (a: Answers, t: Topic[]) => void; onDone: () => void }) {
  const [hist, setHist] = useState<Hist[]>(st.interview.history || []);
  const [topic, setTopic] = useState(st.interview.topic || "business");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const send = useCallback(async (message: string) => {
    setBusy(true); setErr(null);
    if (message) setHist((h) => [...h, { role: "owner", text: message }]);
    try {
      const r = await api<Turn>("/onboarding/interview", { body: { message } });
      setHist(r.history); setTopic(r.topic); onAnswers(r.answers, r.coverage); setPicked([]);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, [onAnswers]);
  useEffect(() => { if (!hist.length) send(""); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [hist.length, busy]);
  const last = hist[hist.length - 1];
  const finished = topic === "finish";
  const enough = ["business", "goals", "work"].every((id) => st.topics.find((t) => t.id === id)?.done);
  const submit = () => { const t = text.trim(); if (!t || busy) return; setText(""); send(t); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };
  return (
    <div className="iv">
      <div className="iv-log" aria-live="polite">
        {hist.map((h, i) => h.role === "ai" ? (
          <div key={i} className="iv-ai">
            <span className="iv-who"><Avatar who={{ id: "chief-of-staff", name: "Omilo", is_chief: true }} size={28} /></span>
            <div className="iv-msg"><Markdown text={h.text} />
              {!!h.saved?.length && <div className="iv-saved"><i className="ri-save-3-line" /> Noted in your profile</div>}
              {i === hist.length - 1 && !busy && !!h.options?.length && (
                <div className="iv-chips">
                  {h.options.map((o) => (
                    <button key={o} type="button" className={`chipbtn ${picked.includes(o) ? "on" : ""}`}
                      onClick={() => h.multi ? setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o])) : send(o)}>{o}</button>
                  ))}
                  {h.multi && picked.length > 0 && <button type="button" className="btn sm primary" onClick={() => send(picked.join(", "))}>Send {picked.length}</button>}
                </div>
              )}
            </div>
          </div>
        ) : <div key={i} className="iv-me"><div className="bubble">{h.text}</div></div>)}
        {busy && <div className="iv-ai"><span className="iv-who"><Avatar who={{ id: "chief-of-staff", name: "Omilo", is_chief: true }} size={28} state="working" /></span><div className="iv-msg small">Thinking…</div></div>}
        <div ref={end} />
      </div>
      <Err error={err} />
      {finished ? (
        <div className="callout ok" style={{ marginTop: 8 }}>That&apos;s what I needed. Next: the team that fits what you told me.</div>
      ) : (
        <div className="iv-compose">
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder={last?.multi ? "Pick above, or write your own…" : "Write your answer… (Enter to send)"} disabled={busy} />
          <button className="btn primary" disabled={busy || !text.trim()} onClick={submit} aria-label="Send"><i className="ri-send-plane-2-line" /></button>
        </div>
      )}
      <div className="acts" style={{ justifyContent: "space-between", marginTop: 8 }}>
        {!finished ? <button className="linkbtn small" disabled={busy} onClick={() => send("Let's skip this topic for now.")}>Skip this topic</button> : <span />}
        <button className={`btn ${finished || enough ? "primary" : ""}`} disabled={busy} onClick={onDone}>
          {finished ? "See my team" : enough ? "That's enough, build my team" : "Build my team now"}<i className="ri-arrow-right-line" /></button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 3. the team */
function TeamStep({ team, setTeam, roles, why }: { team: Helper[]; setTeam: (t: Helper[]) => void; roles: RoleCard[]; why: string }) {
  const [adding, setAdding] = useState("");
  const upd = (i: number, p: Partial<Helper>) => setTeam(team.map((h, j) => (j === i ? { ...h, ...p } : h)));
  return (
    <>
      <h1>Your team</h1>
      <p className="lead">{why}</p>
      <div className="tm-card chief">
        <Avatar who={{ id: "chief-of-staff", name: "Chief of Staff", is_chief: true }} size={44} />
        <div><b>Chief of Staff</b><span className="small"> · always on the team</span>
          <p className="small" style={{ margin: "2px 0 0" }}>Your right hand: hands out work to the others, keeps track, and briefs you every morning.</p></div>
      </div>
      {team.map((h, i) => (
        <div key={h.id + i} className="tm-card">
          <Avatar who={{ id: h.id, name: h.name, role: h.base }} size={44} />
          <div className="tm-body">
            <div className="acts" style={{ gap: 8, flexWrap: "nowrap" }}>
              <input className="tm-name" aria-label="Helper name" value={h.name} onChange={(e) => upd(i, { name: e.target.value, id: slug(e.target.value) === h.base ? h.base : slug(e.target.value) })} />
              <span className="chip">{roles.find((r) => r.id === h.base)?.name || h.base} skills</span>
              <button className="iconbtn" aria-label={`Remove ${h.name}`} title="Remove" onClick={() => setTeam(team.filter((_, j) => j !== i))}><i className="ri-close-line" /></button>
            </div>
            <textarea rows={2} aria-label={`What ${h.name} takes off your plate`} value={h.focus} onChange={(e) => upd(i, { focus: e.target.value })} />
            {h.why && <p className="small tm-why"><i className="ri-lightbulb-line" /> {h.why}</p>}
          </div>
        </div>
      ))}
      <div className="acts" style={{ marginTop: 8 }}>
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add a helper" style={{ maxWidth: 320 }}>
          <option value="">Add another helper…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}: {r.tagline}</option>)}
        </select>
        <button className="btn" disabled={!adding} onClick={() => {
          const r = roles.find((x) => x.id === adding)!;
          let id = r.id; let n = 2; while (team.some((h) => h.id === id)) id = `${r.id}-${n++}`;
          setTeam([...team, { id, base: r.id, name: r.name, focus: r.summary, why: "Added by you." }]); setAdding("");
        }}><i className="ri-add-line" />Add</button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ the page */
export default function Onboarding() {
  const router = useRouter();
  const [st, setSt] = useState<State | null>(null);
  const [step, setStep] = useState(0);
  const [team, setTeam] = useState<Helper[] | null>(null);
  const [roles, setRoles] = useState<RoleCard[]>([]);
  const [teamBy, setTeamBy] = useState("");
  const [tz, setTz] = useState("UTC");
  const [mode, setMode] = useState("ask_all");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<State>("/onboarding").then((s) => {
      setSt(s);
      setStep(Math.min(s.step || 0, STEPS.length - 1));
      setTz(s.timezone && s.timezone !== "UTC" ? s.timezone : browserTimezone());
      setMode(s.answers.approval_mode || "ask_all");
      if (s.team) setTeam(s.team);
    }).catch((e) => setErr(e.message));
  }, []);

  const go = async (n: number) => {
    setErr(null);
    if (st) api("/onboarding", { method: "PUT", body: { answers: st.answers, step: n } }).catch(() => {});
    setStep(n);
  };
  const onAnswers = useCallback((answers: Answers, topics: Topic[]) => setSt((s) => (s ? { ...s, answers, topics } : s)), []);
  const editField = async (f: string, v: string) => {
    if (!st) return;
    const answers = { ...st.answers, [f]: v };
    setSt({ ...st, answers });
    await api("/onboarding", { method: "PUT", body: { answers, step } }).catch((e) => setErr(e.message));
  };
  const planTeam = useCallback(async () => {
    setBusy(true); setErr(null);
    try { const r = await api<{ helpers: Helper[]; roles: RoleCard[]; by: string }>("/onboarding/team-plan", { body: {} }); setTeam(r.helpers); setRoles(r.roles); setTeamBy(r.by); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (STEPS[step]?.id === "team" && (!team || !roles.length)) planTeam(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    if (!st || !team) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ created: string[] }>("/onboarding/finish", { body: { answers: { ...st.answers, approval_mode: mode },
        helpers: team.map((h) => ({ id: h.id, base: h.base, name: h.name, focus: h.focus })), approval_mode: mode, timezone: tz, practice_task: false } });
      setDone(r.created);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (err && !st) return <div style={{ padding: 24 }}><Err error={err} /></div>;
  if (!st) return <p className="small" style={{ padding: 24 }}>Loading…</p>;
  const o = st.options;
  const cur = STEPS[step];
  const nxt = STEPS[step + 1];
  const company = st.answers.company_name || "your business";

  if (done) {
    return (
      <div className="obx">
        <StepCard wide icon="ri-rocket-2-line" title="Your team is ready" tone="green" seed={7} mascot caption={`${company} is up and running.`}
          art={<OmiloGuide tone="fresh" line={`${done.length} helpers joined ${company}. Each one is writing to you now about its job.`}
            team={done.map((id) => ({ id, name: team?.find((h) => h.id === id)?.name || (id === "chief-of-staff" ? "Chief of Staff" : id), role: team?.find((h) => h.id === id)?.base || id, is_chief: id === "chief-of-staff" }))} known={null} />}
          footer={<button className="btn primary sc-next" onClick={() => router.replace("/chat/")}>Meet my team</button>}>
          <h1>Your team is ready</h1>
          <p className="lead">Before they start, every helper sends you its proposal in its own chat:</p>
          <ul className="checklist">
            <li><i className="ri-briefcase-4-line" /><span>How it understands its job at {company}, and what it will own.</span></li>
            <li><i className="ri-flag-2-line" /><span>The goals it suggests, with numbers, and its first ideas.</span></li>
            <li><i className="ri-check-double-line" /><span><b>Approve</b> with one click, or reply with what to change and it sends a new version.</span></li>
            <li><i className="ri-shield-check-line" /><span>Nothing is posted, sent or paid without your OK.</span></li>
          </ul>
        </StepCard>
      </div>
    );
  }

  const progress = step > 0 ? (
    <span className="acts" style={{ gap: 8 }}>
      <span className="sc-steps" aria-hidden>{STEPS.slice(1).map((_, i) => <i key={i} className={i + 1 < step ? "done" : i + 1 === step ? "now" : ""} />)}</span>
      <span className="small">{step} of {STEPS.length - 1}</span>
    </span>
  ) : null;
  const back = step > 0 ? <div className="row" style={{ justifyContent: "center" }}><button className="sc-skip" onClick={() => go(step - 1)} disabled={busy}><i className="ri-arrow-left-s-line" />Back</button></div> : null;

  if (cur.id === "interview") {
    return (
      <div className="obx">
        <StepCard wide icon={cur.icon} title={cur.title} tone={cur.tone} next={nxt && { icon: nxt.icon, title: nxt.title, tone: nxt.tone }} meta={progress}
          art={<Profile a={st.answers} o={o} topics={st.topics} topic={st.interview.topic} onEdit={editField} />} footer={back}>
          <Interview st={st} onAnswers={onAnswers} onDone={() => go(step + 1)} />
        </StepCard>
      </div>
    );
  }

  return (
    <div className="obx">
      <StepCard wide={cur.id !== "welcome"} icon={cur.icon} title={cur.title} tone={cur.tone} mascot={cur.id === "welcome"} next={nxt && { icon: nxt.icon, title: nxt.title, tone: nxt.tone }} meta={progress}
        caption={cur.id === "welcome" ? "Hi, I'm Omilo. Let's build your AI team together." : cur.id === "ai" ? "First, the brain your team thinks with." : "The helpers that fit what you told me."}
        footer={<>
          {cur.id === "welcome" && <button className="btn primary sc-next" onClick={() => go(1)}>Let&apos;s start</button>}
          {cur.id === "team" && <button className="btn primary sc-next" disabled={busy || !team} onClick={finish}>{busy && team ? "Creating your team…" : "Create my team"}</button>}
          {back}
        </>}>
        {cur.id === "welcome" && (
          <>
            <h1>Welcome to Omilo</h1>
            <p className="lead">Omilo gives {company} a team of AI helpers. To set them up, I&apos;ll interview you about the business, the way a good advisor would:
              one question at a time, with ideas when you&apos;re not sure.</p>
            <ul className="checklist">
              <li><i className="ri-sparkling-2-line" /><span>Pick the AI your team uses.</span></li>
              <li><i className="ri-question-answer-line" /><span>Chat about your business, customers, goals and the work you want off your plate. About 10 minutes.</span></li>
              <li><i className="ri-team-line" /><span>Get a team that fits. Each helper then proposes its own job for you to approve.</span></li>
            </ul>
          </>
        )}
        {cur.id === "ai" && <AiStep providers={st.providers} ai={st.ai} onDone={(ai) => { setSt({ ...st, ai }); go(2); }} />}
        {cur.id === "team" && (
          !team ? <p className="small">{busy ? "Putting your team together from what you told me…" : ""}</p> : (
            <>
              <TeamStep team={team} setTeam={setTeam} roles={roles}
                why={teamBy === "ai" ? "Based on your goals and the work you want to hand off. Rename helpers, change their focus, remove or add one." : "Suggested from your goals. Rename helpers, change their focus, remove or add one."} />
              <label>How much freedom should your helpers have?</label>
              {Object.entries(o.approval_modes).map(([k, m]) => (
                <button type="button" key={k} className={`choice ${mode === k ? "on" : ""}`} onClick={() => setMode(k)}>
                  <b>{m.label}{k === "ask_all" && <span className="rec">Recommended to start</span>}</b><span>{m.detail}</span>
                </button>
              ))}
              <label>Your time zone</label>
              <select value={tz} onChange={(e) => setTz(e.target.value)}>{allTimezones(tz).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}</select>
            </>
          )
        )}
        <Err error={err} />
      </StepCard>
    </div>
  );
}
