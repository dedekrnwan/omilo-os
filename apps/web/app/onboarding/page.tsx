"use client";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import ClaudeSetup, { ClaudeChoice } from "@/components/ClaudeSetup";
import { Err, Markdown } from "@/components/ui";
import { api } from "@/lib/api";

/* Guided onboarding for owners who are not engineers: plain questions, examples, no jargon.
   Saga OS writes the knowledge files from the answers (apps/api/saga_api/onboarding.py). */

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
  engine_type?: string; engine_url?: string; engine_model?: string; practice?: boolean;
};
type State = { answers: Answers; step: number; options: Options; roles: Record<string, Role>; timezone: string };
type Preview = { files: Record<string, string>; completeness: { items: Record<string, boolean>; score: number };
  recommended: { roles: string[]; max_concurrent_tasks: number } };
type Finished = { created: string[]; mcp_tokens: Record<string, string>; mcp_url: string; practice: { task_id: string; staff_id: string } | null };

const STEPS = ["Welcome", "Your business", "Your customers", "What you sell", "Your goals", "How you talk", "Tools and rules",
  "Your team", "Your AI", "Check and finish"];
const label = (v: Opt[string]) => (typeof v === "string" ? v : v.label);

/* ------------------------------------------------------------------ small building blocks */
function Q({ title, hint, optional, children }: { title: string; hint?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="q">
      <b>{title}{optional && <span className="opt-tag">optional</span>}</b>
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
  const [claude, setClaude] = useState<ClaudeChoice>({ key: "", model: "", ok: false });  // never saved in the draft
  const [err, setErr] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<State>("/onboarding").then((s) => {
      setSt(s);
      setA({ engine_type: "fake", engine_url: "http://127.0.0.1:8642/v1", engine_model: "hermes-agent", practice: true, ...s.answers });
      setStep(Math.min(s.step || 0, STEPS.length - 1));
      setTz(s.timezone && s.timezone !== "UTC" ? s.timezone : browserTimezone());
    }).catch((e) => setErr(e.message));
  }, []);

  const set = (patch: Partial<Answers>) => setA((x) => (x ? { ...x, ...patch } : x));

  // keep the recommendation and the review fresh when the answers that drive them change
  const recKey = a ? JSON.stringify([a.goals, a.has_software, a.team_style, a.industry]) : "";
  useEffect(() => {
    if (!a || step < 7) return;
    api<Preview>("/onboarding/preview", { body: { answers: a } }).then((p) => {
      setPreview(p);
      setA((x) => (x && x.roles === undefined ? { ...x, roles: p.recommended.roles } : x));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey, step]);

  if (err && !st) return <div className="wiz"><Err error={err} /></div>;
  if (!st || !a) return <p className="small">Loading…</p>;
  const o = st.options;

  const go = async (n: number) => {
    setErr(null);
    if (n > step && step === 1 && !a.company_name.trim()) { setErr("Please give your business a name first."); return; }
    try { await api("/onboarding", { method: "PUT", body: { answers: a, step: n } }); } catch { /* draft save is best effort */ }
    setStep(n);
    top.current?.scrollIntoView({ behavior: "smooth" });
  };

  const pickStyle = (style: string) => {
    set({ team_style: style, roles: undefined });  // refilled from the new recommendation
  };

  const finish = async () => {
    if (a.engine_type === "claude" && !(claude.ok && claude.model)) {  // e.g. the page was reloaded: keys are never kept in the draft
      setStep(8); setErr("Please paste and check your Claude API key again.");
      return;
    }
    setBusy(true); setErr(null);
    try {
      const engine = a.engine_type === "hermes" ? { type: "hermes", base_url: a.engine_url, model: a.engine_model }
        : a.engine_type === "claude" ? { type: "claude", model: claude.model } : { type: "fake" };
      const r = await api<Finished>("/onboarding/finish", { body: {
        answers: a, roles: a.roles || [], engine, approval_mode: a.approval_mode, timezone: tz, practice_task: a.practice !== false,
        api_key: a.engine_type === "claude" ? claude.key : undefined } });
      setDone(r);
      top.current?.scrollIntoView({ behavior: "smooth" });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  /* ------------------------------------------------------------------ done */
  if (done) {
    const chiefName = st.roles["chief-of-staff"]?.name || "Chief of Staff";
    const techNote = [
      `Saga OS setup for ${a.company_name}`, "",
      "Each AI helper below runs as a Hermes profile and must connect back to Saga OS through MCP:",
      `  URL: ${done.mcp_url}`, "",
      ...Object.entries(done.mcp_tokens).map(([k, v]) => `  ${k}: Authorization: Bearer ${v}`), "",
      "Put the Hermes API key on the Saga OS server as HERMES_API_KEY.",
      "These tokens are shown once. New ones can be made in Saga OS: Staff → helper → Rotate token.",
    ].join("\n");
    return (
      <div className="wiz" ref={top}>
        <div className="eyebrow">All set</div>
        <h1>Your team is ready</h1>
        <p className="lead">{done.created.length} AI helper{done.created.length === 1 ? "" : "s"} joined {a.company_name}. Here is what happens next.</p>
        <ul className="checklist">
          <li><span className="yes">1</span><span>Your helpers work on their own schedule (for example, your {chiefName} writes you a brief every morning).</span></li>
          <li><span className="yes">2</span><span>When something needs your OK, it shows up in your <b>Inbox</b> with a red number.</span></li>
          <li><span className="yes">3</span><span>You approve, ask for changes, or say no. Nothing is posted, sent or paid without you.</span></li>
          <li><span className="yes">4</span><span>Want something done? Just ask in <b>Chat</b>, in your own words.</span></li>
        </ul>
        {done.practice && (
          <div className="callout ok">
            We started a practice job: a short post introducing {a.company_name}. In a minute or two it will appear in your Inbox so you can try approving it.
          </div>
        )}
        {a.engine_type === "claude" && (
          <div className="callout">Your helpers use <b>Claude</b> with your own API key. You can change the model or key any time in Settings → AI.</div>
        )}
        {a.engine_type === "fake" && (
          <div className="callout">You are in <b>practice mode</b>: helpers show sample work, no real AI is used yet. Connect your AI any time in Settings.</div>
        )}
        <div className="wiz-nav">
          <button className="btn primary" onClick={() => router.replace("/")}>Open my Inbox</button>
          <button className="btn" onClick={() => router.replace("/chat/")}>Chat with my {chiefName}</button>
        </div>
        {a.engine_type === "hermes" && Object.keys(done.mcp_tokens).length > 0 && (
          <details className="tech" open>
            <summary>For your technical helper (one-time connection details)</summary>
            <p className="small">Send this to whoever set up your AI server. It contains passwords for your helpers, so share it privately. It is only shown now.</p>
            <pre className="code">{techNote}</pre>
            <button className="btn" onClick={async () => { await navigator.clipboard.writeText(techNote); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button>
          </details>
        )}
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

  return (
    <div className="wiz" ref={top}>
      {step > 0 && (
        <>
          <div className="progress" aria-hidden>{STEPS.slice(1).map((_, i) => <i key={i} className={i + 1 < step ? "done" : i + 1 === step ? "now" : ""} />)}</div>
          <div className="eyebrow">Step {step} of {STEPS.length - 1} · {STEPS[step]}</div>
        </>
      )}

      {step === 0 && (
        <>
          <div className="eyebrow">Welcome{a.company_name ? `, ${a.company_name}` : ""}</div>
          <h1>Let&apos;s set up your AI team</h1>
          <p className="lead">Saga OS gives you a team of AI helpers that do real work for your business: write content, find customers, look after customer questions, watch your numbers. You stay the boss.</p>
          <ul className="checklist">
            <li><span className="yes">✓</span><span>About 10 minutes of simple questions. No technical knowledge needed.</span></li>
            <li><span className="yes">✓</span><span>Your helpers read your answers before every job, so the better you describe your business, the better they work.</span></li>
            <li><span className="yes">✓</span><span>Nothing is posted, sent or paid without your OK.</span></li>
            <li><span className="yes">✓</span><span>Skip anything you are not sure about and change it later. Your answers are saved as you go.</span></li>
          </ul>
          <div className="wiz-nav"><button className="btn primary" onClick={() => go(1)}>Let&apos;s start</button></div>
        </>
      )}

      {step === 1 && (
        <>
          <h1>Your business</h1>
          <p className="lead">Tell us the basics, the way you would explain it to a new employee on their first day.</p>
          <Q title="What is your business called?">
            <input value={a.company_name} onChange={(e) => set({ company_name: e.target.value })} placeholder="e.g. Warung Bu Sri" autoFocus />
          </Q>
          <Q title="What does your business do?" hint="One or two sentences: what you offer, to whom, and where.">
            <textarea rows={3} value={a.one_liner || ""} onChange={(e) => set({ one_liner: e.target.value })}
              placeholder="e.g. We deliver home-cooked lunch boxes to offices in South Jakarta." />
          </Q>
          <Q title="What kind of business is it?">
            <Picks opts={o.industries} value={a.industry} onChange={(v) => set({ industry: v })} />
            {a.industry === "other" && <input style={{ marginTop: 8 }} value={a.industry_other || ""} onChange={(e) => set({ industry_other: e.target.value })} placeholder="Describe it in a few words" />}
          </Q>
          <Q title="Where do you operate?" optional>
            <input value={a.location || ""} onChange={(e) => set({ location: e.target.value })} placeholder="e.g. Jakarta, all of Indonesia, online worldwide" />
          </Q>
          <Q title="How far along are you?">
            <Picks opts={o.stages} value={a.stage} onChange={(v) => set({ stage: v })} />
          </Q>
          <Q title="How many people work in the business?">
            <Picks opts={o.team_sizes} value={a.team_size} onChange={(v) => set({ team_size: v })} />
          </Q>
          <Q title="Do you have your own app or website that needs programming work?" hint="Say no if you only use ready-made tools like Instagram, a marketplace or a website builder.">
            <Picks opts={{ yes: "Yes", no: "No" }} value={a.has_software ? "yes" : "no"} onChange={(v) => set({ has_software: v === "yes" })} />
          </Q>
          <Q title="Your website or main social page" optional>
            <input value={a.website || ""} onChange={(e) => set({ website: e.target.value })} placeholder="e.g. instagram.com/warungbusri" />
          </Q>
          <Q title="What makes you different from others?" optional hint="Why do customers choose you?">
            <textarea rows={3} value={a.different || ""} onChange={(e) => set({ different: e.target.value })} placeholder="e.g. Recipes from my grandmother, always fresh, delivered before 12:00." />
          </Q>
        </>
      )}

      {step === 2 && (
        <>
          <h1>Your customers</h1>
          <p className="lead">Your helpers write and search for the people described here, so be specific.</p>
          <Q title="Who are your customers?" hint="Describe your best customers. If you have different groups, list each one.">
            <textarea rows={4} value={a.customers || ""} onChange={(e) => set({ customers: e.target.value })}
              placeholder={"e.g.\n- Office workers who want a proper lunch\n- HR and admin staff ordering for meetings"} />
          </Q>
          <Q title="What problem do you solve for them?" optional>
            <textarea rows={3} value={a.customer_problem || ""} onChange={(e) => set({ customer_problem: e.target.value })} placeholder="e.g. No time to go out for lunch, tired of fast food." />
          </Q>
          <Q title="Why do some people hesitate to buy?" optional hint="Common doubts or questions you hear. Helpers use this to answer them honestly.">
            <textarea rows={3} value={a.customer_objections || ""} onChange={(e) => set({ customer_objections: e.target.value })} placeholder="e.g. Worried about hygiene, minimum order too high." />
          </Q>
        </>
      )}

      {step === 3 && (
        <>
          <h1>What you sell</h1>
          <p className="lead">Your helpers will only mention the products and prices you list here.</p>
          <Q title="Your products or services" hint="Add one per line. The price can be a range or 'on request'.">
            {a.offers.map((of, i) => (
              <div className="offer-row" key={i}>
                <input aria-label="Name" value={of.name} placeholder="Name, e.g. Nasi box" onChange={(e) => set({ offers: a.offers.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                <input aria-label="Price" value={of.price} placeholder="Price" onChange={(e) => set({ offers: a.offers.map((x, j) => j === i ? { ...x, price: e.target.value } : x) })} />
                <input aria-label="Notes" value={of.note} placeholder="Notes, e.g. minimum 10" onChange={(e) => set({ offers: a.offers.map((x, j) => j === i ? { ...x, note: e.target.value } : x) })} />
                <button type="button" className="btn quiet" aria-label="Remove" onClick={() => set({ offers: a.offers.length > 1 ? a.offers.filter((_, j) => j !== i) : [{ name: "", price: "", note: "" }] })}>✕</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => set({ offers: [...a.offers, { name: "", price: "", note: "" }] })}>+ Add another</button>
          </Q>
          <Q title="Anything that is NOT available yet?" optional hint="Helpers will never promise or sell these.">
            <textarea rows={2} value={a.not_yet || ""} onChange={(e) => set({ not_yet: e.target.value })} placeholder="e.g. Wedding catering (coming next year)" />
          </Q>
        </>
      )}

      {step === 4 && (
        <>
          <h1>Your goals</h1>
          <p className="lead">Pick what matters most right now. We use this to suggest the right helpers.</p>
          <Q title="What do you want help with?" hint="Pick as many as you like.">
            <Picks multi opts={o.goals} value={a.goals} onChange={(v) => set({ goals: v })} only={softwareOk} />
          </Q>
          {a.goals.filter(softwareOk).length > 0 && (
            <Q title="Any targets?" optional hint="A number and a date helps helpers know what success looks like.">
              {a.goals.filter(softwareOk).map((g) => (
                <div key={g} style={{ marginBottom: 8 }}>
                  <span className="small">{label(o.goals[g])}</span>
                  <input value={a.goal_notes?.[g] || ""} onChange={(e) => set({ goal_notes: { ...(a.goal_notes || {}), [g]: e.target.value } })} placeholder="e.g. 20 new customers by March" />
                </div>
              ))}
            </Q>
          )}
          <Q title="Until when is this your focus?" optional>
            <input value={a.focus_until || ""} onChange={(e) => set({ focus_until: e.target.value })} placeholder="e.g. end of this year" />
          </Q>
        </>
      )}

      {step === 5 && (
        <>
          <h1>How you talk</h1>
          <p className="lead">So everything your helpers write sounds like you.</p>
          <Q title="Which languages do you use with customers?">
            <Picks multi opts={o.languages} value={a.languages} onChange={(v) => set({ languages: v })} />
            <input style={{ marginTop: 8 }} value={a.language_other || ""} onChange={(e) => set({ language_other: e.target.value })} placeholder="Another language? e.g. Javanese" />
          </Q>
          <Q title="What tone fits your business?" hint="Pick up to 3.">
            <Picks multi max={3} opts={o.tones} value={a.tones} onChange={(v) => set({ tones: v })} />
          </Q>
          <Q title="Words or topics to avoid" optional>
            <input value={a.avoid || ""} onChange={(e) => set({ avoid: e.target.value })} placeholder="e.g. slang, politics, 'cheap'" />
          </Q>
          <Q title="Paste an example you like" optional hint="A post, caption or message that sounds the way you want.">
            <textarea rows={4} value={a.example || ""} onChange={(e) => set({ example: e.target.value })} />
          </Q>
        </>
      )}

      {step === 6 && (
        <>
          <h1>Tools and rules</h1>
          <p className="lead">What you already use, and the lines your helpers must never cross.</p>
          <Q title="Which tools do you use today?" hint="Just so helpers know. Connecting tools comes later and always needs your OK.">
            <Picks multi opts={o.tools} value={a.tools} onChange={(v) => set({ tools: v })} />
            <input style={{ marginTop: 8 }} value={a.tools_other || ""} onChange={(e) => set({ tools_other: e.target.value })} placeholder="Others? e.g. Moka POS, Canva" />
          </Q>
          <Q title="House rules" hint="We ticked the ones most businesses want. Untick any that do not fit.">
            {Object.entries(o.rules).map(([k, r]) => (
              <label className="check" key={k}>
                <input type="checkbox" checked={a.rules.includes(k)} onChange={() => set({ rules: a.rules.includes(k) ? a.rules.filter((x) => x !== k) : [...a.rules, k] })} />
                <span>{r.label}</span>
              </label>
            ))}
          </Q>
          <Q title="Any other rules?" optional hint="One per line.">
            <textarea rows={3} value={a.rules_other || ""} onChange={(e) => set({ rules_other: e.target.value })} placeholder="e.g. Never mention our supplier's name." />
          </Q>
        </>
      )}

      {step === 7 && (
        <>
          <h1>Your team</h1>
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
              <div className="card helper" style={{ borderColor: "var(--accent)" }}>
                <span className="chip run" style={{ alignSelf: "flex-start" }}>Always included</span>
                <b>{roles["chief-of-staff"].name}</b>
                <span className="small">{roles["chief-of-staff"].tagline}. {roles["chief-of-staff"].summary}</span>
                <ul>{roles["chief-of-staff"].does.map((d) => <li key={d}>{d}</li>)}</ul>
              </div>
              {shownRoles.map(([k, r]) => (
                <button type="button" key={k} className={`card helper choice ${chosen.has(k) ? "on" : ""}`} style={{ margin: 0 }} onClick={() => toggleRole(k)} aria-pressed={chosen.has(k)}>
                  <b>{chosen.has(k) ? "✓ " : "+ "}{r.name}</b>
                  <span>{r.tagline}. {r.summary}</span>
                  <ul>{r.does.map((d) => <li key={d}>{d}</li>)}</ul>
                  <div className="when">{r.schedule.join(" · ")}</div>
                </button>
              ))}
            </div>
            <button type="button" className="btn quiet" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>{showAll ? "Show only suggested helpers" : "Show all available helpers"}</button>
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
        </>
      )}

      {step === 8 && (
        <>
          <h1>Your AI</h1>
          <p className="lead">Your helpers need an AI &ldquo;brain&rdquo; to do real work. You can start without one and connect it later.</p>
          <button type="button" className={`choice ${a.engine_type === "claude" ? "on" : ""}`} onClick={() => set({ engine_type: "claude" })}>
            <b>Use my Claude API key <span className="rec">Easiest real AI</span></b>
            <span>Paste a key from Anthropic and your helpers start doing real work, including searching the internet and reading web pages. Nothing to install.</span>
          </button>
          {a.engine_type === "claude" && (
            <div className="paper" style={{ marginTop: -4, marginBottom: 10 }}>
              <ClaudeSetup value={claude} onChange={setClaude} />
            </div>
          )}
          <button type="button" className={`choice ${a.engine_type === "fake" ? "on" : ""}`} onClick={() => set({ engine_type: "fake" })}>
            <b>Practice mode first</b>
            <span>No key and no cost. Helpers produce sample work so you can learn how approvals and chat work. Switch to real AI any time in Settings.</span>
          </button>
          <details className="tech" open={a.engine_type === "hermes"}>
            <summary>Advanced: I run my own Hermes AI server</summary>
            <button type="button" className={`choice ${a.engine_type === "hermes" ? "on" : ""}`} style={{ marginTop: 10 }} onClick={() => set({ engine_type: "hermes" })}>
              <b>Use my Hermes server</b>
              <span>For technical setups: Hermes adds a real browser (clicking, logging in, filling forms), a terminal, skills and more. Your Claude key then lives in Hermes.</span>
            </button>
            {a.engine_type === "hermes" && (
              <>
                <Q title="Hermes address" hint="Usually http://127.0.0.1:8642/v1. Start Saga OS with HERMES_API_KEY set to Hermes's API_SERVER_KEY.">
                  <input value={a.engine_url || ""} onChange={(e) => set({ engine_url: e.target.value })} />
                </Q>
                <Q title="Model name" hint="Leave as hermes-agent. The Claude model is chosen inside Hermes.">
                  <input value={a.engine_model || ""} onChange={(e) => set({ engine_model: e.target.value })} />
                </Q>
              </>
            )}
          </details>
          <Q title="Try it right away?">
            <label className="check">
              <input type="checkbox" checked={a.practice !== false} onChange={(e) => set({ practice: e.target.checked })} />
              <span>Start a practice job when I finish: a helper drafts a short post about my business so I can try approving it.</span>
            </label>
          </Q>
        </>
      )}

      {step === 9 && (
        <>
          <h1>Check and finish</h1>
          <p className="lead">Here is what your helpers will know. Missing parts are fine: helpers will ask you when they need them.</p>
          {preview ? (
            <>
              <ul className="checklist">
                {Object.entries(preview.completeness.items).map(([k, ok], i) => (
                  <li key={k}>
                    <span className={ok ? "yes" : "no"}>{ok ? "✓" : "!"}</span>
                    <span style={{ flex: 1 }}>{k}{ok ? "" : " (not filled in)"}</span>
                    {!ok && <button className="btn quiet" onClick={() => go([1, 2, 3, 4, 5, 6][i])}>Add</button>}
                  </li>
                ))}
              </ul>
              <div className="q">
                <b>Your team</b>
                <p style={{ margin: "4px 0" }}>{["chief-of-staff", ...(a.roles || []).filter((r) => r !== "chief-of-staff")].map((r) => roles[r]?.name).join(", ")}</p>
                <p className="small" style={{ margin: 0 }}>{o.approval_modes[a.approval_mode]?.label} · {a.engine_type === "fake" ? "Practice mode" : a.engine_type === "claude" ? "Claude" : "Hermes"} · {tz.replace(/_/g, " ")}</p>
              </div>
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
      {step > 0 && (
        <div className="wiz-nav">
          <button className="btn" onClick={() => go(step - 1)} disabled={busy}>Back</button>
          <span className="sp" />
          {step < 9 && step > 1 && step !== 7 && step !== 8 && <button className="btn quiet" onClick={() => go(step + 1)}>Skip for now</button>}
          {step < 9
            ? <button className="btn primary" onClick={() => go(step + 1)} disabled={step === 8 && a.engine_type === "claude" && !(claude.ok && claude.model)}>Continue</button>
            : <button className="btn primary" onClick={finish} disabled={busy || !preview}>{busy ? "Creating your team…" : "Create my team"}</button>}
        </div>
      )}
    </div>
  );
}
