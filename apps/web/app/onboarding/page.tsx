"use client";
import { useRouter } from "next/navigation";
import StepCard, { Tone } from "@/components/StepCard";
import { ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import ClaudeSetup, { ClaudeChoice } from "@/components/ClaudeSetup";
import ClaudeCodeSetup from "@/components/ClaudeCodeSetup";
import { Err } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";

/* Hybrid onboarding: a guided form (left) and a setup assistant (right) that fills the form from what the
   owner says or pastes. The form is the source of truth; every change the assistant makes is highlighted. */

type Opt = Record<string, string | { label: string; [k: string]: unknown }>;
type Options = {
  industries: Opt; stages: Opt; team_sizes: Opt; goals: Opt; tones: Opt; languages: Opt; tools: Opt;
  rules: Record<string, { label: string; default: boolean }>;
  approval_modes: Record<string, { label: string; detail: string; strict: boolean }>;
};
type Role = { name: string; tagline: string; summary: string; does: string[]; is_chief: boolean; schedule: string[]; software: boolean };
type Offer = { name: string; price: string; note: string };
type Answers = {
  company_name: string; one_liner?: string; industry?: string; industry_other?: string; location?: string; stage?: string;
  team_size?: string; website?: string; different?: string;
  customers?: string; customer_problem?: string; customer_objections?: string;
  offers: Offer[]; not_yet?: string;
  has_software: boolean; goals: string[]; goal_notes?: Record<string, string>; focus_until?: string;
  languages: string[]; language_other?: string; tones: string[]; avoid?: string; example?: string;
  tools: string[]; tools_other?: string; rules: string[]; rules_other?: string;
  team_style: string; approval_mode: string; roles?: string[];
  engine_type?: string; engine_url?: string; engine_model?: string; claude_model?: string; no_hermes?: boolean; practice?: boolean;
};
type State = { answers: Answers; step: number; options: Options; roles: Record<string, Role>; timezone: string };
type Preview = { files: Record<string, string>; completeness: { items: Record<string, boolean>; score: number };
  recommended: { roles: string[]; max_concurrent_tasks: number } };
type Finished = { created: string[]; mcp_tokens: Record<string, string>; mcp_url: string; practice: { task_id: string; staff_id: string } | null };
type ChatMsg = { role: "owner" | "assistant" | "note"; text: string };

const STEPS: { id: string; title: string; icon: string; tone: Tone; caption: string }[] = [
  { id: "welcome", title: "Welcome", icon: "ri-hand-heart-line", tone: "ink", caption: "Hi, I'm Saga. Let's set up your AI team together." },
  { id: "ai", title: "Your AI", icon: "ri-cpu-line", tone: "violet", caption: "First, the brain your helpers think with." },
  { id: "business", title: "Your business", icon: "ri-building-line", tone: "orange", caption: "We need a few details about what you do." },
  { id: "customers", title: "Your customers", icon: "ri-user-heart-line", tone: "rose", caption: "Who you serve, and what keeps them up at night." },
  { id: "offer", title: "What you sell", icon: "ri-price-tag-3-line", tone: "amber", caption: "Your products and prices, so nobody invents them." },
  { id: "goals", title: "Your goals", icon: "ri-flag-2-line", tone: "green", caption: "What winning looks like for the next few months." },
  { id: "voice", title: "How you talk", icon: "ri-chat-quote-line", tone: "blue", caption: "So every post and message sounds like you." },
  { id: "rules", title: "Tools and rules", icon: "ri-shield-check-line", tone: "teal", caption: "What your helpers may use, and what they must never do." },
  { id: "team", title: "Your team", icon: "ri-team-line", tone: "violet", caption: "Pick the helpers who join. You can hire more later." },
  { id: "finish", title: "Check and finish", icon: "ri-checkbox-circle-line", tone: "green", caption: "One last look before your team gets to work." },
];
const IDX = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));
const FIELD_LABELS: Record<string, string> = {
  company_name: "name", one_liner: "what you do", industry: "type of business", location: "location", stage: "stage", team_size: "team size",
  has_software: "own app", website: "website", different: "what makes you different", customers: "customers", customer_problem: "problem you solve",
  customer_objections: "doubts", offers: "products and prices", not_yet: "not available yet", goals: "goals", goal_notes: "targets",
  focus_until: "focus period", languages: "languages", language_other: "languages", tones: "tone", avoid: "words to avoid", example: "example",
  tools: "tools", tools_other: "tools", rules: "rules", rules_other: "rules",
};
const FIELD_STEP: Record<string, string> = {
  company_name: "business", one_liner: "business", industry: "business", industry_other: "business", location: "business", stage: "business",
  team_size: "business", has_software: "business", website: "business", different: "business", customers: "customers",
  customer_problem: "customers", customer_objections: "customers", offers: "offer", not_yet: "offer", goals: "goals", goal_notes: "goals",
  focus_until: "goals", languages: "voice", language_other: "voice", tones: "voice", avoid: "voice", example: "voice",
  tools: "rules", tools_other: "rules", rules: "rules", rules_other: "rules",
};
const label = (v: Opt[string]) => (typeof v === "string" ? v : v.label);

/* ------------------------------------------------------------------ building blocks */
const FlashCtx = createContext<Set<string>>(new Set());

function Q({ title, hint, optional, f, children }: { title: string; hint?: string; optional?: boolean; f?: string | string[]; children: ReactNode }) {
  const flash = useContext(FlashCtx);
  const on = (Array.isArray(f) ? f : f ? [f] : []).some((k) => flash.has(k));
  return (
    <div className={`q ${on ? "flash" : ""}`}>
      <b>{title}{optional && <span className="opt-tag">optional</span>}{on && <span className="rec" style={{ background: "#fef9c3", color: "#854d0e", borderColor: "#fde68a" }}>filled by assistant</span>}</b>
      {hint && <span className="hint">{hint}</span>}
      {children}
    </div>
  );
}

function Picks({ opts, value, onChange, multi, max, only }: {
  opts: Opt; value: string | string[] | undefined; onChange: (v: any) => void; multi?: boolean; max?: number; only?: (k: string) => boolean;
}) {
  const sel = Array.isArray(value) ? value : value ? [value] : [];
  const toggle = (k: string) => {
    if (!multi) return onChange(sel[0] === k ? "" : k);
    if (sel.includes(k)) return onChange(sel.filter((x) => x !== k));
    if (max && sel.length >= max) return;
    onChange([...sel, k]);
  };
  return (
    <div className="picks" role={multi ? "group" : "radiogroup"}>
      {Object.entries(opts).filter(([k]) => !only || only(k)).map(([k, v]) => (
        <button type="button" key={k} className={`pick ${sel.includes(k) ? "on" : ""}`} aria-pressed={sel.includes(k)} onClick={() => toggle(k)}>
          {label(v)}
        </button>
      ))}
    </div>
  );
}

function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}
function allTimezones(current: string): string[] {
  try { const l = (Intl as any).supportedValuesOf("timeZone") as string[]; return l.includes(current) ? l : [current, ...l]; }
  catch { return Array.from(new Set([current, "UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura", "Asia/Singapore", "Europe/London", "America/New_York"])); }
}


/* ------------------------------------------------------------------ the setup assistant (chat half) */
function Assistant({ answers, stepTitle, aiReady, onPatch, open, onClose, goAi }: {
  answers: Answers; stepTitle: string; aiReady: boolean; onPatch: (p: Partial<Answers>) => void; open: boolean; onClose: () => void; goAi: () => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const send = async (t: string) => {
    const msg = t.trim();
    if (!msg || busy) return;
    const next: ChatMsg[] = [...msgs, { role: "owner", text: msg }];
    setMsgs(next); setText(""); setBusy(true);
    try {
      const history = next.filter((m) => m.role !== "note").map((m) => ({ role: m.role, text: m.text }));
      const r = await api<{ reply: string; patch: Partial<Answers> }>("/onboarding/assist", { body: { answers, messages: history, step: stepTitle } });
      const keys = Object.keys(r.patch || {});
      if (keys.length) onPatch(r.patch);
      const filled = Array.from(new Set(keys.map((k) => FIELD_LABELS[k]).filter(Boolean)));
      setMsgs((m) => [...m, ...(filled.length ? [{ role: "note" as const, text: `Filled in: ${filled.join(", ")}` }] : []), { role: "assistant", text: r.reply }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "note", text: e.message }]);
    } finally { setBusy(false); }
  };

  const ideas = ["Here is our website: ", "In my own words, my business is ", "What should I write here?"];
  return (
    <aside className={`ob-chat ${open ? "open" : ""}`} aria-label="Setup assistant">
      <div className="head">
        <i className="ri-sparkling-2-line" style={{ color: "var(--ink)" }} />
        <b style={{ fontWeight: 500 }}>Setup assistant</b>
        <span className="sp" />
        <button className="iconbtn chatclose" aria-label="Close assistant" onClick={onClose}><i className="ri-close-line" /></button>
      </div>
      <div className="msgs" style={{ flex: 1, overflowY: "auto" }}>
        <div className="msg agent">
          <div className="md"><p>Hi! Tell me about your business in your own words, or paste your website or Instagram link. I&apos;ll fill in the form for you, and you can change anything.</p></div>
        </div>
        {!aiReady && (
          <div className="callout" style={{ margin: 0 }}>
            I need your Claude key to help. <button className="btn sm" onClick={goAi} style={{ marginLeft: 6 }}>Connect it</button>
            <div className="small" style={{ marginTop: 6 }}>Or just fill in the form yourself. It works without me.</div>
          </div>
        )}
        {msgs.map((m, i) => m.role === "note"
          ? <div key={i} className="msg system"><i className="ri-check-line" /> {m.text}</div>
          : <div key={i} className={`msg ${m.role === "owner" ? "owner" : "agent"}`}>{m.role === "owner" ? m.text : <Markdown text={m.text} />}</div>)}
        {busy && <div className="typing">Thinking…</div>}
        <div ref={end} />
      </div>
      {aiReady && msgs.length === 0 && (
        <div className="suggest" style={{ padding: "0 12px 10px", gridTemplateColumns: "1fr" }}>
          {ideas.map((s) => <button key={s} onClick={() => setText(s)}>{s.replace(/: $| $/, "")}</button>)}
        </div>
      )}
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea value={text} disabled={!aiReady} placeholder={aiReady ? "Describe your business, paste a link, or ask a question…" : "Connect your Claude key to chat"}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <div className="row">
          <span className="small">{stepTitle}</span><span className="sp" />
          <button className="btn primary sm" type="submit" disabled={!aiReady || busy || !text.trim()}><i className="ri-send-plane-2-line" />Send</button>
        </div>
      </form>
    </aside>
  );
}

/* ------------------------------------------------------------------ page */
export default function Onboarding() {
  const router = useRouter();
  const [st, setSt] = useState<State | null>(null);
  const [a, setA] = useState<Answers | null>(null);
  const [step, setStep] = useState(0);
  const [tz, setTz] = useState("UTC");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Finished | null>(null);
  const [copied, setCopied] = useState(false);
  const [claude, setClaude] = useState<ClaudeChoice>({ key: "", model: "", ok: false });
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [ccReady, setCcReady] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([api<State>("/onboarding"), api<{ claude_key_hint: string | null }>("/ai").catch(() => ({ claude_key_hint: null }))]).then(([s, ai]) => {
      setSt(s);
      setA({ engine_type: "fake", practice: true, ...s.answers, ...(s.answers?.engine_type === "hermes" ? { engine_type: "claude" } : {}) });
      setStep(Math.min(s.step || 0, STEPS.length - 1));
      setTz(s.timezone && s.timezone !== "UTC" ? s.timezone : browserTimezone());
      setKeyHint(ai.claude_key_hint);
    }).catch((e) => setErr(e.message));
  }, []);

  const set = (patch: Partial<Answers>) => setA((x) => (x ? { ...x, ...patch } : x));
  const stepId = STEPS[step]?.id || "welcome";
  const usingClaude = a?.engine_type === "claude";
  const aiReady = !!keyHint;  // the assistant can help once a Claude key is saved

  const recKey = a ? JSON.stringify([a.goals, a.has_software, a.team_style, a.industry]) : "";
  useEffect(() => {
    if (!a || step < IDX.team) return;
    api<Preview>("/onboarding/preview", { body: { answers: a } }).then((p) => {
      setPreview(p);
      setA((x) => (x && x.roles === undefined ? { ...x, roles: p.recommended.roles } : x));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey, step]);

  const save = useCallback(async (answers: Answers, n: number) => {
    try { await api("/onboarding", { method: "PUT", body: { answers, step: n } }); } catch { /* best effort */ }
  }, []);

  const applyPatch = (p: Partial<Answers>) => {
    if (!a) return;
    const merged = { ...a, ...p } as Answers;
    setA(merged);
    save(merged, step);
    const keys = new Set(Object.keys(p));
    setFlash(keys);
    setTimeout(() => setFlash(new Set()), 4000);
    // if the assistant filled something on another page, show where (only while still on the intro steps)
    const firstStep = Object.keys(p).map((k) => IDX[FIELD_STEP[k]]).filter((x) => x !== undefined).sort((x, y) => x - y)[0];
    if (firstStep !== undefined && step <= IDX.ai) setStep(firstStep);
  };

  if (err && !st) return <div className="wiz" style={{ padding: 24 }}><Err error={err} /></div>;
  if (!st || !a) return <p className="small" style={{ padding: 24 }}>Loading…</p>;
  const o = st.options;

  const go = async (n: number) => {
    setErr(null);
    if (n > step && stepId === "business" && !a.company_name.trim()) { setErr("Please give your business a name first."); return; }
    if (n > step && stepId === "ai" && usingClaude && !keyHint) { setErr("Check your Claude key first, or choose practice mode."); return; }
    await save(a, n);
    setStep(n);
    top.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveKey = async (c: ClaudeChoice) => {
    setClaude(c);
    if (c.ok && c.model) {
      try {
        if (c.key.trim()) { const r = await api<{ claude_key_hint: string }>("/ai/key", { body: { api_key: c.key, model: c.model } }); setKeyHint(r.claude_key_hint); }
        set({ claude_model: c.model });
        if (!a.no_hermes) api("/harness/install", { body: {} }).catch(() => {});  // Claude Code installs while the owner keeps going
      } catch (e: any) { setErr(e.message); }
    }
  };

  const pickStyle = (style: string) => set({ team_style: style, roles: undefined });

  const canFinish = !usingClaude || a.no_hermes || ccReady;
  const finish = async () => {
    setBusy(true); setErr(null);
    try {
      const engine = usingClaude ? { type: a.no_hermes ? "claude-direct" : "claude", model: a.claude_model } : { type: "fake" };
      const r = await api<Finished>("/onboarding/finish", { body: {
        answers: a, roles: a.roles || [], engine, approval_mode: a.approval_mode, timezone: tz, practice_task: a.practice !== false } });
      setDone(r);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  /* ------------------------------------------------------------------ done */
  if (done) {
    const chiefName = st.roles["chief-of-staff"]?.name || "Chief of Staff";

    return (
      <div className="obx">
        <StepCard wide icon="ri-rocket-2-line" title="Your team is ready" tone="green" seed={7} mascot caption={`${a.company_name} is up and running.`}
          next={{ icon: "ri-inbox-line", title: "Your Inbox", tone: "orange" }}
          footer={<>
            <button className="btn primary sc-next" onClick={() => router.replace("/")}>Open my Inbox</button>
            <div className="row" style={{ justifyContent: "center" }}><button className="sc-skip" onClick={() => router.replace("/chat/")}>Chat with my {chiefName}</button></div>
          </>}>
          <h1>Your team is ready</h1>
          <p className="lead">{done.created.length} AI helper{done.created.length === 1 ? "" : "s"} joined {a.company_name}. Here is what happens next.</p>
          <ul className="checklist">
            <li><i className="ri-time-line" /><span>Your helpers work on their own schedule. For example, your {chiefName} writes you a brief every morning.</span></li>
            <li><i className="ri-inbox-2-line" /><span>When something needs your OK, it shows up in your <b>Inbox</b>.</span></li>
            <li><i className="ri-shield-check-line" /><span>You approve, ask for changes, or say no. Nothing is posted, sent or paid without you.</span></li>
            <li><i className="ri-chat-3-line" /><span>Want something done? Just ask in <b>Chat</b>, in your own words.</span></li>
          </ul>
          {done.practice && <div className="callout ok">We started a practice job: a short post introducing {a.company_name}. In a minute or two it will be in your Inbox so you can try approving it.</div>}
          {usingClaude && <div className="callout">Your helpers use <b>Claude</b> with your own API key{a.no_hermes ? " (built-in: web search and Saga's tools)" : ", working in Claude Code on this computer (files in the folders you share, web, connectors)"}. Change it any time in Settings.</div>}
          {a.engine_type === "fake" && <div className="callout">You are in <b>practice mode</b>: helpers show sample work, no real AI is used yet. Connect your AI any time in Settings.</div>}
        </StepCard>
      </div>
    );
  }

  /* ------------------------------------------------------------------ steps */
  const roles = st.roles;
  const softwareOk = (k: string) => !(o.goals[k] as any)?.software || a.has_software || a.industry === "software";
  const chosen = new Set(a.roles || []);
  const shownRoles = Object.entries(roles).filter(([k, r]) =>
    !r.is_chief && (showAll || chosen.has(k) || (preview?.recommended.roles || []).includes(k)) && (!r.software || a.has_software || a.industry === "software" || showAll));
  const toggleRole = (k: string) => set({ roles: chosen.has(k) ? (a.roles || []).filter((x) => x !== k) : [...(a.roles || []), k] });
  const isQuestionStep = step >= IDX.business && step <= IDX.rules;

  const nextBtn = stepId === "welcome"
    ? <button className="btn primary sc-next" onClick={() => go(1)}>Let&apos;s start</button>
    : stepId !== "finish"
      ? <button className="btn primary sc-next" onClick={() => go(step + 1)} disabled={stepId === "ai" && usingClaude && !keyHint}>Next</button>
      : <button className="btn primary sc-next" onClick={finish} disabled={busy || !preview || !canFinish}>
          {busy ? "Creating your team…" : canFinish ? "Create my team" : "Waiting for Claude Code…"}</button>;
  const footer = (
    <>
      {nextBtn}
      {step > 0 && (
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="sc-skip" onClick={() => go(step - 1)} disabled={busy}><i className="ri-arrow-left-s-line" />Back</button>
          {isQuestionStep && <button className="sc-skip" onClick={() => go(step + 1)}>Skip for now</button>}
        </div>
      )}
    </>
  );
  const cur = STEPS[step];
  const nxt = STEPS[step + 1];
  const progress = step > 0 ? (
    <span className="acts" style={{ gap: 8 }}>
      <span className="sc-steps" aria-hidden>{STEPS.slice(1).map((_, i) => <i key={i} className={i + 1 < step ? "done" : i + 1 === step ? "now" : ""} />)}</span>
      <span className="small">{step} of {STEPS.length - 1}</span>
    </span>
  ) : null;

  const form = (
    <div className="inner">

      {stepId === "welcome" && (
        <>
          <h1>Set up your AI team</h1>
          <p className="lead">Saga OS gives {a.company_name || "your business"} a team of AI helpers that do real work: write content, find customers, look after customer questions, watch your numbers. You stay the boss.</p>
          <ul className="checklist">
            <li><i className="ri-time-line" /><span>About 10 minutes. No technical knowledge needed.</span></li>
            <li><i className="ri-sparkling-2-line" /><span>Fill in the form yourself, or let the assistant fill it from a description or your website.</span></li>
            <li><i className="ri-shield-check-line" /><span>Nothing is posted, sent or paid without your OK.</span></li>
            <li><i className="ri-save-3-line" /><span>Skip anything and change it later. Your answers are saved as you go.</span></li>
          </ul>
        </>
      )}

      {stepId === "ai" && (
        <>
          <p className="lead">Your helpers need an AI &ldquo;brain&rdquo;. Connect it now and the assistant can also help you fill in the rest of this setup.</p>
          <button type="button" className={`choice ${usingClaude ? "on" : ""}`} onClick={() => set({ engine_type: "claude" })}>
            <b>Use my Claude API key <span className="rec">Recommended</span></b>
            <span>Paste a key from Anthropic. Saga OS installs Claude Code for you in the background, so your helpers can work with files, search the web and use your connectors.</span>
          </button>
          {usingClaude && (
            <div className="paper" style={{ marginTop: -2, marginBottom: 10 }}>
              <ClaudeSetup value={claude} onChange={saveKey} savedHint={keyHint} />
              {keyHint && !a.no_hermes && (
                <p className="small" style={{ marginTop: 12 }}>
                  <i className="ri-loader-4-line" /> {ccReady ? "Claude Code is ready." : "Installing Claude Code in the background. Keep going, it will be ready by the end."}
                </p>
              )}
            </div>
          )}
          <button type="button" className={`choice ${a.engine_type === "fake" ? "on" : ""}`} onClick={() => set({ engine_type: "fake" })}>
            <b>Practice mode first</b>
            <span>No key and no cost. Helpers produce sample work so you can learn how approvals and chat work. Switch to real AI any time in Settings.</span>
          </button>
          <details className="tech" open={!!a.no_hermes}>
            <summary>Advanced</summary>
            {usingClaude && (
              <label className="check" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={!!a.no_hermes} onChange={(e) => set({ no_hermes: e.target.checked })} />
                <span>Use built-in Claude instead (nothing to install: web search and Saga&apos;s tools, but no files, commands or browser)</span>
              </label>
            )}
          </details>
        </>
      )}

      {stepId === "business" && (
        <>
          <p className="lead">The basics, the way you would explain it to a new employee on their first day.</p>
          <Q title="What is your business called?" f="company_name">
            <input value={a.company_name} onChange={(e) => set({ company_name: e.target.value })} placeholder="e.g. Warung Bu Sri" autoFocus />
          </Q>
          <Q title="What does your business do?" hint="One or two sentences: what you offer, to whom, and where." f="one_liner">
            <textarea rows={3} value={a.one_liner || ""} onChange={(e) => set({ one_liner: e.target.value })} placeholder="e.g. We deliver home-cooked lunch boxes to offices in South Jakarta." />
          </Q>
          <Q title="What kind of business is it?" f={["industry", "industry_other"]}>
            <Picks opts={o.industries} value={a.industry} onChange={(v) => set({ industry: v })} />
            {a.industry === "other" && <input style={{ marginTop: 8 }} value={a.industry_other || ""} onChange={(e) => set({ industry_other: e.target.value })} placeholder="Describe it in a few words" />}
          </Q>
          <Q title="Where do you operate?" optional f="location">
            <input value={a.location || ""} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Jakarta, all of Indonesia, online worldwide" />
          </Q>
          <Q title="How far along are you?" f="stage"><Picks opts={o.stages} value={a.stage} onChange={(v) => set({ stage: v })} /></Q>
          <Q title="How many people work in the business?" f="team_size"><Picks opts={o.team_sizes} value={a.team_size} onChange={(v) => set({ team_size: v })} /></Q>
          <Q title="Do you have your own app or website that needs programming work?" hint="Say no if you only use ready-made tools like Instagram, a marketplace or a website builder." f="has_software">
            <Picks opts={{ yes: "Yes", no: "No" }} value={a.has_software ? "yes" : "no"} onChange={(v) => set({ has_software: v === "yes" })} />
          </Q>
          <Q title="Your website or main social page" optional f="website">
            <input value={a.website || ""} onChange={(e) => set({ website: e.target.value })} placeholder="e.g. instagram.com/warungbusri" />
          </Q>
          <Q title="What makes you different from others?" optional hint="Why do customers choose you?" f="different">
            <textarea rows={3} value={a.different || ""} onChange={(e) => set({ different: e.target.value })} placeholder="e.g. Recipes from my grandmother, always fresh, delivered before 12:00." />
          </Q>
        </>
      )}

      {stepId === "customers" && (
        <>
          <p className="lead">Your helpers write and search for the people described here, so be specific.</p>
          <Q title="Who are your customers?" hint="Describe your best customers. If you have different groups, list each one." f="customers">
            <textarea rows={4} value={a.customers || ""} onChange={(e) => set({ customers: e.target.value })} placeholder={"e.g.\n- Office workers who want a proper lunch\n- HR and admin staff ordering for meetings"} />
          </Q>
          <Q title="What problem do you solve for them?" optional f="customer_problem">
            <textarea rows={3} value={a.customer_problem || ""} onChange={(e) => set({ customer_problem: e.target.value })} placeholder="e.g. No time to go out for lunch, tired of fast food." />
          </Q>
          <Q title="Why do some people hesitate to buy?" optional hint="Common doubts or questions you hear. Helpers use this to answer them honestly." f="customer_objections">
            <textarea rows={3} value={a.customer_objections || ""} onChange={(e) => set({ customer_objections: e.target.value })} placeholder="e.g. Worried about hygiene, minimum order too high." />
          </Q>
        </>
      )}

      {stepId === "offer" && (
        <>
          <p className="lead">Your helpers will only mention the products and prices you list here.</p>
          <Q title="Your products or services" hint="One per line. The price can be a range or 'on request'." f="offers">
            {a.offers.map((of, i) => (
              <div className="offer-row" key={i}>
                <input aria-label="Name" value={of.name} placeholder="Name, e.g. Nasi box" onChange={(e) => set({ offers: a.offers.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                <input aria-label="Price" value={of.price} placeholder="Price" onChange={(e) => set({ offers: a.offers.map((x, j) => j === i ? { ...x, price: e.target.value } : x) })} />
                <input aria-label="Notes" value={of.note} placeholder="Notes, e.g. minimum 10" onChange={(e) => set({ offers: a.offers.map((x, j) => j === i ? { ...x, note: e.target.value } : x) })} />
                <button type="button" className="iconbtn" aria-label="Remove" onClick={() => set({ offers: a.offers.length > 1 ? a.offers.filter((_, j) => j !== i) : [{ name: "", price: "", note: "" }] })}><i className="ri-close-line" /></button>
              </div>
            ))}
            <button type="button" className="btn sm" onClick={() => set({ offers: [...a.offers, { name: "", price: "", note: "" }] })}><i className="ri-add-line" />Add another</button>
          </Q>
          <Q title="Anything that is NOT available yet?" optional hint="Helpers will never promise or sell these." f="not_yet">
            <textarea rows={2} value={a.not_yet || ""} onChange={(e) => set({ not_yet: e.target.value })} placeholder="e.g. Wedding catering (coming next year)" />
          </Q>
        </>
      )}

      {stepId === "goals" && (
        <>
          <p className="lead">Pick what matters most right now. We use this to suggest the right helpers.</p>
          <Q title="What do you want help with?" hint="Pick as many as you like." f="goals">
            <Picks multi opts={o.goals} value={a.goals} onChange={(v) => set({ goals: v })} only={softwareOk} />
          </Q>
          {a.goals.filter(softwareOk).length > 0 && (
            <Q title="Any targets?" optional hint="A number and a date helps helpers know what success looks like." f="goal_notes">
              {a.goals.filter(softwareOk).map((g) => (
                <div key={g} style={{ marginBottom: 8 }}>
                  <span className="small">{label(o.goals[g])}</span>
                  <input value={a.goal_notes?.[g] || ""} onChange={(e) => set({ goal_notes: { ...(a.goal_notes || {}), [g]: e.target.value } })} placeholder="e.g. 20 new customers by March" />
                </div>
              ))}
            </Q>
          )}
          <Q title="Until when is this your focus?" optional f="focus_until">
            <input value={a.focus_until || ""} onChange={(e) => set({ focus_until: e.target.value })} placeholder="e.g. end of this year" />
          </Q>
        </>
      )}

      {stepId === "voice" && (
        <>
          <p className="lead">So everything your helpers write sounds like you.</p>
          <Q title="Which languages do you use with customers?" f={["languages", "language_other"]}>
            <Picks multi opts={o.languages} value={a.languages} onChange={(v) => set({ languages: v })} />
            <input style={{ marginTop: 8 }} value={a.language_other || ""} onChange={(e) => set({ language_other: e.target.value })} placeholder="Another language? e.g. Javanese" />
          </Q>
          <Q title="What tone fits your business?" hint="Pick up to 3." f="tones"><Picks multi max={3} opts={o.tones} value={a.tones} onChange={(v) => set({ tones: v })} /></Q>
          <Q title="Words or topics to avoid" optional f="avoid">
            <input value={a.avoid || ""} onChange={(e) => set({ avoid: e.target.value })} placeholder="e.g. slang, politics, 'cheap'" />
          </Q>
          <Q title="Paste an example you like" optional hint="A post, caption or message that sounds the way you want." f="example">
            <textarea rows={4} value={a.example || ""} onChange={(e) => set({ example: e.target.value })} />
          </Q>
        </>
      )}

      {stepId === "rules" && (
        <>
          <p className="lead">What you already use, and the lines your helpers must never cross.</p>
          <Q title="Which tools do you use today?" hint="Just so helpers know. Connecting tools comes later and always needs your OK." f={["tools", "tools_other"]}>
            <Picks multi opts={o.tools} value={a.tools} onChange={(v) => set({ tools: v })} />
            <input style={{ marginTop: 8 }} value={a.tools_other || ""} onChange={(e) => set({ tools_other: e.target.value })} placeholder="Others? e.g. Moka POS, Canva" />
          </Q>
          <Q title="House rules" hint="We ticked the ones most businesses want. Untick any that do not fit." f="rules">
            {Object.entries(o.rules).map(([k, r]) => (
              <label className="check" key={k}>
                <input type="checkbox" checked={a.rules.includes(k)} onChange={() => set({ rules: a.rules.includes(k) ? a.rules.filter((x) => x !== k) : [...a.rules, k] })} />
                <span>{r.label}</span>
              </label>
            ))}
          </Q>
          <Q title="Any other rules?" optional hint="One per line." f="rules_other">
            <textarea rows={3} value={a.rules_other || ""} onChange={(e) => set({ rules_other: e.target.value })} placeholder="e.g. Never mention our supplier's name." />
          </Q>
        </>
      )}

      {stepId === "team" && (
        <>
          <p className="lead">Based on your goals, here is the team we suggest. Each helper is an AI that works on its own schedule and reports to you.</p>
          <Q title="How big should your team be?">
            <button type="button" className={`choice ${a.team_style === "small" ? "on" : ""}`} onClick={() => pickStyle("small")}>
              <b>Start small <span className="rec">Recommended</span></b>
              <span>A few all-round helpers. Easier to follow, lower AI costs. You can add more later.</span>
            </button>
            <button type="button" className={`choice ${a.team_style === "full" ? "on" : ""}`} onClick={() => pickStyle("full")}>
              <b>Full team</b>
              <span>One specialist per job (content, sales, customer care…). More output, more to review.</span>
            </button>
          </Q>
          <Q title="Your helpers" hint="Tap a helper to add or remove it.">
            <div className="cards">
              <div className="card helper" style={{ background: "var(--soft)" }}>
                <span className="chip" style={{ alignSelf: "flex-start" }}>Always included</span>
                <b>{roles["chief-of-staff"].name}</b>
                <span className="small">{roles["chief-of-staff"].tagline}. {roles["chief-of-staff"].summary}</span>
                <ul>{roles["chief-of-staff"].does.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
              {shownRoles.map(([k, r]) => (
                <button type="button" key={k} className={`card helper choice ${chosen.has(k) ? "on" : ""}`} style={{ margin: 0 }} onClick={() => toggleRole(k)} aria-pressed={chosen.has(k)}>
                  <b><i className={chosen.has(k) ? "ri-checkbox-circle-fill" : "ri-add-circle-line"} style={{ color: chosen.has(k) ? "var(--ink)" : undefined }} /> {r.name}</b>
                  <span>{r.tagline}. {r.summary}</span>
                  <ul>{r.does.map((d) => <li key={d}>{d}</li>)}</ul>
                  <div className="when">{r.schedule.join(" · ")}</div>
                </button>
              ))}
            </div>
            <button type="button" className="btn quiet sm" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>{showAll ? "Show only suggested helpers" : "Show all available helpers"}</button>
          </Q>
          <Q title="Your time zone" hint="Helpers follow your local time for their schedules.">
            <select value={tz} onChange={(e) => setTz(e.target.value)}>
              {allTimezones(tz).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </select>
          </Q>
          <Q title="How much freedom should your helpers have?">
            {Object.entries(o.approval_modes).map(([k, m]) => (
              <button type="button" key={k} className={`choice ${a.approval_mode === k ? "on" : ""}`} onClick={() => set({ approval_mode: k })}>
                <b>{m.label}{k === "ask_all" && <span className="rec">Recommended to start</span>}</b>
                <span>{m.detail}</span>
              </button>
            ))}
          </Q>
          <Q title="Try it right away?">
            <label className="check">
              <input type="checkbox" checked={a.practice !== false} onChange={(e) => set({ practice: e.target.checked })} />
              <span>Start a practice job when I finish: a helper drafts a short post about my business so I can try approving it.</span>
            </label>
          </Q>
        </>
      )}

      {stepId === "finish" && (
        <>
          <p className="lead">Here is what your helpers will know. Missing parts are fine: helpers will ask you when they need them.</p>
          {preview ? (
            <>
              <ul className="checklist">
                {Object.entries(preview.completeness.items).map(([k, ok], i) => (
                  <li key={k}>
                    <i className={ok ? "ri-checkbox-circle-fill" : "ri-error-warning-line"} style={{ color: ok ? "var(--ok)" : "var(--warn)" }} />
                    <span style={{ flex: 1 }}>{k}{ok ? "" : " (not filled in)"}</span>
                    {!ok && <button className="btn sm" onClick={() => go([IDX.business, IDX.customers, IDX.offer, IDX.goals, IDX.voice, IDX.rules][i])}>Add</button>}
                  </li>
                ))}
              </ul>
              <div className="soft" style={{ marginTop: 16 }}>
                <div className="small">Your team</div>
                <p style={{ margin: "2px 0 6px", fontWeight: 500 }}>{["chief-of-staff", ...(a.roles || []).filter((r) => r !== "chief-of-staff")].map((r) => roles[r]?.name).join(", ")}</p>
                <div className="small">{o.approval_modes[a.approval_mode]?.label} · {a.engine_type === "fake" ? "Practice mode" : usingClaude ? (a.no_hermes ? "Built-in Claude" : "Claude Code with your key") : "Practice mode"} · {tz.replace(/_/g, " ")}</div>
              </div>
              {usingClaude && !a.no_hermes && <ClaudeCodeSetup autoInstall onReady={setCcReady} />}
              <details className="tech">
                <summary>See exactly what your helpers will read</summary>
                {Object.entries(preview.files).map(([n, c]) => <div key={n} className="paper" style={{ marginTop: 10 }}><Markdown text={c} /></div>)}
                <p className="small">You can edit all of this later under Company.</p>
              </details>
            </>
          ) : <p className="small">Preparing your summary…</p>}
        </>
      )}

      <Err error={err} />
    </div>
  );

  return (
    <FlashCtx.Provider value={flash}>
      <div className="obx">
        <StepCard ref={top} wide icon={cur.icon} title={cur.title} tone={cur.tone} seed={step} caption={cur.caption} mascot={stepId === "welcome"}
          next={nxt ? { icon: nxt.icon, title: nxt.title, tone: nxt.tone } : null} meta={progress} footer={footer}>
          {form}
        </StepCard>
        <Assistant answers={a} stepTitle={cur.title} aiReady={aiReady} onPatch={applyPatch}
          open={chatOpen} onClose={() => setChatOpen(false)} goAi={() => { setChatOpen(false); go(IDX.ai); }} />
        {!chatOpen && <button className="btn primary chatfab" onClick={() => setChatOpen(true)}><i className="ri-sparkling-2-line" />Setup assistant</button>}
      </div>
    </FlashCtx.Provider>
  );
}
