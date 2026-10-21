"use client";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import ClaudeCodeSetup from "@/components/ClaudeCodeSetup";
import ProviderLogo from "@/components/ProviderLogo";
import Avatar from "@/components/Avatar";
import { Err } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import { Mark } from "@/components/Logo";
import Stepper from "@/components/onboarding/Stepper";
import { WelcomeNotes, LiveNotes, EditableNotes, NOTE_DEFS, TOPIC_TO_NOTE, NoteKey } from "@/components/onboarding/Notes";

/* Onboarding v2 — 5 screens, 7-note model, 4-step stepper.
   Steps: 0 Welcome · 1 Your AI · 2 Get to know you · 3 Check · 4 Your team */

type Opt = Record<string, string | { label: string; [k: string]: unknown }>;
type Options = {
  industries: Opt; stages: Opt; team_sizes: Opt; goals: Opt; tones: Opt; languages: Opt; tools: Opt;
  rules: Record<string, { label: string; default: boolean }>;
  approval_modes: Record<string, { label: string; detail: string; strict: boolean }>;
};
type Answers = Record<string, any> & { company_name: string };
type Provider = {
  id: string; label: string; by: string; domain: string; kind: "key" | "subscription" | "local"; blurb: string;
  key_url?: string; recommended?: boolean; more?: boolean; has_key?: boolean;
};
type Ai = { provider: string; label: string; model?: string | null; chosen: boolean };
type Hist = { role: "owner" | "ai"; text: string; options?: string[]; field?: string; multi?: boolean; saved?: string[] };
type Topic = { id: string; label: string; icon: string; done: boolean; filled: number; of: number };
type Helper = { id: string; base: string; name: string; focus: string; why: string; enabled?: boolean };
type RoleCard = { id: string; name: string; tagline: string; summary: string };
type State = {
  answers: Answers; step: number; options: Options; timezone: string; ai: Ai; providers: Provider[];
  interview: { history: Hist[]; topic: string }; topics: Topic[]; team: Helper[] | null;
};
type Turn = { history: Hist[]; topic: string; answers: Answers; coverage: Topic[]; ai: Ai };

/* ---------- helpers ---------- */
const label = (v: Opt[string] | undefined) =>
  v === undefined ? "" : typeof v === "string" ? v : v.label;
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "helper";
function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}
function allTimezones(current: string): string[] {
  try {
    const l = (Intl as any).supportedValuesOf("timeZone") as string[];
    return l.includes(current) ? l : [current, ...l];
  } catch {
    return Array.from(new Set([current, "UTC", "Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura",
      "Asia/Singapore", "Europe/London", "America/New_York"]));
  }
}

/* Derive 7-note values from answers */
const SHOWN: Record<string, [string, string][]> = {
  business: [["company_name", "Name"], ["one_liner", "What you do"], ["industry", "Type"], ["stage", "Stage"], ["location", "Where"]],
  customers: [["customers", "Customers"], ["customer_problem", "What they need"], ["customer_objections", "Why they hesitate"]],
  offer: [["offers", "Products and prices"], ["different", "What makes you different"]],
  goals: [["goals", "Goals"], ["goal_notes", "Targets"]],
  work: [["workload", "Your time goes to"], ["handoff", "Hand off first"], ["team_size", "Team"]],
  voice: [["languages", "Language"], ["tones", "Tone"], ["avoid", "Avoid"]],
  rules: [["tools", "Apps you use"], ["rules_other", "Your own rules"]],
};
const ENUM: Record<string, keyof Options> = {
  industry: "industries", stage: "stages", team_size: "team_sizes",
  goals: "goals", languages: "languages", tones: "tones", tools: "tools",
};
const TEXT_EDIT = new Set(["company_name", "one_liner", "location", "customers", "customer_problem",
  "customer_objections", "different", "workload", "handoff", "avoid", "rules_other"]);

function showField(a: Answers, f: string, o: Options): string {
  const v = a[f];
  if (f === "offers") return (v || []).filter((x: any) => x.name).map((x: any) => x.price ? `${x.name} (${x.price})` : x.name).join(", ");
  if (f === "goal_notes") return Object.values(v || {}).filter(Boolean).join("; ");
  if (ENUM[f]) return Array.isArray(v) ? v.map((k: string) => label(o[ENUM[f]]?.[k] as any) || k).join(", ") : label(o[ENUM[f]]?.[v] as any) || "";
  return String(v || "");
}

function answersToNoteValues(answers: Answers, o: Options): Record<NoteKey, string> {
  const noteFields: Record<NoteKey, string[]> = {
    company:   ["company_name", "one_liner", "industry", "stage", "location"],
    customers: ["customers", "customer_problem", "customer_objections"],
    goals:     ["goals", "goal_notes"],
    offer:     ["offers", "different"],
    rules:     ["tools", "rules_other"],
    systems:   ["workload", "handoff", "team_size"],
    voice:     ["languages", "tones", "avoid"],
  };
  const out = {} as Record<NoteKey, string>;
  for (const key of NOTE_DEFS.map((d) => d.key)) {
    const k = key as NoteKey;
    out[k] = noteFields[k].map((f) => showField(answers, f, o)).filter(Boolean).join(" · ");
  }
  return out;
}

/* ---------- top bar ---------- */
function TopBar({ company, onLogout }: { company: string; onLogout: () => void }) {
  return (
    <div className="ob2-bar">
      <div className="ob2-brand">
        <Mark size={22} />
        <b>Omilo</b>
        <span>· Setting up {company}</span>
      </div>
      <span className="sp" />
      <span className="ob2-saved"><i className="ri-save-3-line" />Saved as you go</span>
      <button className="btn quiet sm" onClick={onLogout} style={{ marginLeft: 8 }}>
        <i className="ri-logout-box-r-line" />Log out
      </button>
    </div>
  );
}

/* ================================================================ Screen 1: Welcome */
function WelcomeScreen({ company, onStart }: { company: string; onStart: () => void }) {
  return (
    <div className="ob2-layout">
      <div className="ob2-form">
        <div className="ob2-inner">
          <div style={{ display: "flex", gap: 12, marginBottom: 18, alignItems: "center" }}>
            <Avatar who={{ id: "chief-of-staff", name: "Chief of Staff", is_chief: true }} size={36} />
            <Avatar who={{ id: "builder", name: "Builder", role: "builder" }} size={36} />
            <Avatar who={{ id: "grower", name: "Grower", role: "grower" }} size={36} />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Let&apos;s build your AI team</h1>
          <p className="lead" style={{ marginBottom: 24 }}>
            I&apos;m Chief of Staff. I&apos;ll ask about {company} the way a good advisor would: one question
            at a time, with ideas when you&apos;re not sure.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
            {[
              { n: 1, label: "Connect the AI you already have", time: "1 min" },
              { n: 2, label: "Talk about your business", time: "~10 min" },
              { n: 3, label: "Meet your team and approve their jobs", time: "2 min" },
            ].map((s) => (
              <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{
                  width: 24, height: 24, borderRadius: "50%", background: "var(--primary)",
                  color: "var(--primary-ink)", display: "grid", placeItems: "center",
                  fontSize: 12, fontWeight: 700, flexShrink: 0,
                }}>{s.n}</span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{s.label}</span>
                <span className="small" style={{ color: "var(--muted)" }}>{s.time}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button className="btn primary" style={{ width: "fit-content" }} onClick={onStart}>
              Let&apos;s start<i className="ri-arrow-right-line" />
            </button>
            <p className="small" style={{ color: "var(--muted)", margin: 0 }}>
              You can stop anytime and pick up later.
            </p>
          </div>
        </div>
      </div>
      <div className="ob2-rail">
        <div style={{ padding: "16px 12px 8px" }}>
          <p className="small" style={{ fontWeight: 700, letterSpacing: "0.05em", color: "var(--muted)", marginBottom: 4 }}>
            WHAT YOUR TEAM WILL KNOW
          </p>
          <p className="small" style={{ color: "var(--muted)", marginBottom: 12 }}>
            Everything you tell me becomes 7 short notes. Helpers read them before every job.
          </p>
        </div>
        <div style={{ padding: "0 12px 16px" }}>
          <WelcomeNotes />
        </div>
      </div>
    </div>
  );
}

/* ================================================================ Screen 2: Your AI */
const GOOD_TO_KNOW = [
  { icon: "ri-team-line", title: "It runs your whole team", body: "Every helper and every job uses the AI you connect here." },
  { icon: "ri-coins-line", title: "Costs stay with you", body: "A sign-in or subscription costs nothing extra. With a key, you pay your provider directly." },
  { icon: "ri-settings-3-line", title: "Change it anytime", body: "Add more accounts later and Omilo spreads jobs across them." },
  { icon: "ri-lock-line", title: "Your data stays yours", body: "Omilo runs on this computer. We never see your chats or files." },
];

function AiScreen({
  providers, ai, onBack, onDone, onSkip,
}: {
  providers: Provider[]; ai: Ai;
  onBack: () => void; onDone: (ai: Ai) => void; onSkip: () => void;
}) {
  const [sel, setSel] = useState<string | null>(() => {
    if (ai.chosen && ai.provider !== "fake") return ai.provider === "anthropic" ? "claude" : ai.provider;
    // Auto-select local login if available
    const local = providers.find((p) => p.kind === "local");
    if (local) return local.id;
    return null;
  });
  const [more, setMore] = useState(false);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [subReady, setSubReady] = useState(false);
  const [token, setToken] = useState("");

  const p = providers.find((x) => x.id === sel);

  // Group providers into the 3 option types
  const localProvider = providers.find((x) => x.kind === "local");
  const subProvider = providers.find((x) => x.kind === "subscription");
  const keyProviders = providers.filter((x) => x.kind === "key" && (!x.more || more || x.id === sel));

  const connect = async (provider: string) => {
    setBusy(true); setErr(null);
    try {
      if (provider === "claude-code" && token.trim())
        await api("/harness/accounts", { body: { label: "My Claude", token: token.trim() } });
      onDone(await api<Ai>("/onboarding/ai", { body: { provider, api_key: key.trim() || undefined, model: model.trim() || undefined } }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const aiOptions: { id: string; title: string; subtitle: string; badge?: string; isLocal?: boolean; isSub?: boolean }[] = [
    ...(localProvider ? [{
      id: localProvider.id,
      title: "Already signed in on this computer",
      subtitle: "No key, no extra cost. Your login never leaves this machine.",
      badge: "Recommended",
      isLocal: true,
    }] : []),
    ...(subProvider ? [{
      id: subProvider.id,
      title: "A subscription you already pay for",
      subtitle: "Like Claude Pro or Max. Sign in once in your browser.",
      isSub: true,
    }] : []),
    { id: "__key", title: "An API key", subtitle: "Pay as you go with your own key." },
  ];

  const selIsKey = sel && !localProvider?.id && sel !== subProvider?.id && sel !== "__key"
    ? true
    : sel === "__key";

  return (
    <div className="ob2-layout">
      <div className="ob2-form">
        <div className="ob2-inner">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Avatar who={{ id: "chief-of-staff", name: "Chief of Staff", is_chief: true }} size={28} />
            <span className="small" style={{ color: "var(--muted)" }}>Step 1 of 4</span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
            Which AI should your team think with?
          </h1>
          <p className="lead" style={{ marginBottom: 20 }}>
            Your helpers, and our chat next, run on it. Pick what you already have; you can change it later.
          </p>

          <div className="ob2-ai-options">
            {aiOptions.map((opt) => {
              const isOn = sel === opt.id || (opt.id === "__key" && selIsKey && sel !== localProvider?.id && sel !== subProvider?.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`ob2-ai-option${isOn ? " on" : ""}`}
                  onClick={() => { setSel(opt.id === "__key" ? (keyProviders[0]?.id || "__key") : opt.id); setErr(null); }}
                >
                  <span className="ob2-ai-dot" />
                  <span className="ob2-ai-t">
                    <b>
                      {opt.title}
                      {opt.badge && <span className="chip up" style={{ fontSize: 11 }}>{opt.badge}</span>}
                    </b>
                    <span>{opt.subtitle}</span>
                    {opt.isLocal && localProvider?.has_key && (
                      <span style={{ fontSize: 12, color: "var(--ok)", display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                        <i className="ri-check-circle-fill" />
                        Claude Code signed in · <button type="button" className="linkbtn" style={{ fontSize: 12 }} onClick={() => {}}>Use another</button>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* API key provider sub-selection */}
          {selIsKey && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {keyProviders.map((x) => (
                <button key={x.id} type="button" className={`chipbtn${sel === x.id ? " on" : ""}`}
                  onClick={() => setSel(x.id)}>
                  {x.label}
                </button>
              ))}
              {!more && providers.some((x) => x.more && x.kind === "key") && (
                <button type="button" className="chipbtn" onClick={() => setMore(true)}>More…</button>
              )}
            </div>
          )}

          {/* Connection panel */}
          {p && (
            <div className="paper" style={{ marginTop: 16, padding: 16 }}>
              {p.kind === "key" ? (
                <>
                  <label style={{ marginTop: 0 }}>Your {p.label} API key</label>
                  <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
                    placeholder={p.has_key ? "Saved. Paste a new one to replace it" : "Paste it here"} />
                  <p className="small">Get one at{" "}
                    <a href={p.key_url} target="_blank" rel="noopener noreferrer">
                      {p.key_url?.replace(/^https?:\/\//, "").split("/")[0]}
                    </a>: sign in, create a key, copy it here. Stored encrypted, only used by your Omilo.
                  </p>
                  <details><summary className="small">Advanced: a specific model</summary>
                    <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Leave empty for a good default" />
                  </details>
                </>
              ) : p.kind === "local" ? (
                <p style={{ marginTop: 0 }}>Use your own Claude Code sign-in on this machine — no key needed.</p>
              ) : (
                <>
                  <p style={{ marginTop: 0 }}>Use your Claude Pro or Max plan. Omilo runs Claude Code on this computer with it.</p>
                  <ClaudeCodeSetup autoInstall onReady={setSubReady} />
                  <label>Your Claude token</label>
                  <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
                    placeholder={p.has_key ? "Connected. Paste another to add it" : "sk-ant-oat…"} />
                  <p className="small">In the Terminal app run <code>claude setup-token</code>, sign in with your Claude account in the browser, then paste the token it shows.</p>
                </>
              )}
            </div>
          )}

          <Err error={err} />
        </div>
      </div>

      {/* Right rail: GOOD TO KNOW */}
      <div className="ob2-rail">
        <div style={{ padding: "14px 12px 6px" }}>
          <p className="small" style={{ fontWeight: 700, letterSpacing: "0.05em", color: "var(--muted)", margin: 0 }}>
            GOOD TO KNOW
          </p>
        </div>
        <div className="ob2-know-tiles">
          {GOOD_TO_KNOW.map((t) => (
            <div key={t.title} className="ob2-know-tile">
              <i className={t.icon} />
              <div className="ob2-kt-t"><b>{t.title}</b>{t.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="ob2-nav" style={{ gridColumn: "1 / -1" }}>
        <button className="btn" onClick={onBack}><i className="ri-arrow-left-line" />Back</button>
        <span className="sp" />
        <span className="small" style={{ color: "var(--muted)" }}>
          No AI yet?{" "}
          <button type="button" className="linkbtn" disabled={busy} onClick={onSkip}>
            Try with fixed questions
          </button>
        </span>
        <button
          className="btn primary"
          disabled={busy || !sel || sel === "__key" || (p?.kind === "key" && !key.trim() && !p?.has_key) || (p?.kind === "subscription" && ((!token.trim() && !p?.has_key) || !subReady))}
          onClick={() => p && connect(p.id)}
        >
          {busy ? "Checking…" : "Connect and continue"}<i className="ri-arrow-right-line" />
        </button>
      </div>
    </div>
  );
}

/* ================================================================ Screen 3: Interview */
function buildLiveNotes(answers: Answers, topics: Topic[], topic: string) {
  const doneTopics = new Set(topics.filter((t) => t.done).map((t) => t.id));
  const currentNote = TOPIC_TO_NOTE[topic];
  return NOTE_DEFS.map((d) => {
    const topicId = Object.entries(TOPIC_TO_NOTE).find(([, v]) => v === d.key)?.[0];
    const filled = topicId ? doneTopics.has(topicId) : false;
    const isNext = d.key === currentNote && !filled;
    const body = filled && topicId ? Object.entries(SHOWN[topicId] || {}).map(([, [f]]) => showField(answers, f, {} as any)).filter(Boolean).join(" · ") : undefined;
    return { key: d.key, status: (filled ? "filled" : isNext ? "next" : "empty") as "filled" | "next" | "empty", body };
  });
}

function InterviewScreen({
  st, onAnswers, onDone,
}: {
  st: State; onAnswers: (a: Answers, t: Topic[]) => void; onDone: () => void;
}) {
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
  const doneCount = st.topics.filter((t) => t.done).length;
  const totalTopics = st.topics.length || 7;
  const topicIndex = st.topics.findIndex((t) => t.id === topic) + 1 || 1;
  const currentTopicLabel = st.topics.find((t) => t.id === topic)?.label || topic;
  const pct = (doneCount / Math.max(1, totalTopics)) * 100;

  const submit = () => { const t = text.trim(); if (!t || busy) return; setText(""); send(t); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } };

  const liveNotes = buildLiveNotes(st.answers, st.topics, topic);

  return (
    <div className="ob2-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) 340px" }}>
      {/* Left: interview chat */}
      <div className="ob2-form">
        <div className="ob2-interview" style={{ padding: "0 20px" }}>
          {/* Topic bar */}
          <div className="ob2-topic-bar">
            <span className="ob2-topic-label">
              Topic {topicIndex} of {totalTopics} · {currentTopicLabel}
            </span>
            <span className="sp" />
            {!finished && (
              <>
                <button className="linkbtn small" disabled={busy} onClick={() => send("Let's skip this topic for now.")}>
                  Skip this topic
                </button>
                <button className="linkbtn small" disabled={busy} onClick={onDone} style={{ marginLeft: 8 }}>
                  Finish later
                </button>
              </>
            )}
          </div>
          <div className="ob2-progress"><i style={{ width: `${pct}%` }} /></div>

          {/* Chat log */}
          <div className="iv-log" aria-live="polite" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {hist.map((h, i) =>
              h.role === "ai" ? (
                <div key={i} className="reply-shell">
                  <div className="reply-av">
                    <Avatar who={{ id: "chief-of-staff", name: "Omilo", is_chief: true }} size={28} />
                  </div>
                  <div className="reply-body">
                    <div className="reply-who">
                      <b>Chief of Staff</b>
                    </div>
                    <div className="reply-blocks">
                      <div className="reply-md">
                        <Markdown text={h.text} />
                      </div>
                      {!!h.saved?.length && (
                        <div className="iv-saved"><i className="ri-save-3-line" /> Noted in your profile</div>
                      )}
                      {i === hist.length - 1 && !busy && !!h.options?.length && (
                        <div className="choices">
                          {h.options.map((o) => (
                            <button key={o} type="button"
                              className={`pick ${picked.includes(o) ? "on" : ""}`}
                              onClick={() => h.multi
                                ? setPicked((p) => p.includes(o) ? p.filter((x) => x !== o) : [...p, o])
                                : send(o)}>{o}</button>
                          ))}
                          {h.multi && picked.length > 0 && (
                            <button type="button" className="btn sm primary"
                              onClick={() => send(picked.join(", "))}>Send {picked.length}</button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div key={i} className="iv-me">
                  <div className="bubble">{h.text}</div>
                </div>
              )
            )}
            {busy && (
              <div className="reply-shell">
                <div className="reply-av">
                  <Avatar who={{ id: "chief-of-staff", name: "Omilo", is_chief: true }} size={28} state="working" />
                </div>
                <div className="reply-body">
                  <div className="reply-who">
                    <b>Chief of Staff</b>
                  </div>
                  <div className="reply-blocks">
                    <div className="reply-md small">Thinking…</div>
                  </div>
                </div>
              </div>
            )}
            <div ref={end} />
          </div>

          <Err error={err} />

          {finished ? (
            <div className="callout ok" style={{ margin: "8px 0" }}>
              That&apos;s what I needed. Next: check what I learned, then build your team.
            </div>
          ) : (
            <div className="iv-compose" style={{ flexShrink: 0 }}>
              <textarea
                rows={2} value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder={last?.multi ? "Pick above, or write your own…" : "Type your answer, or hold space to talk…"}
                disabled={busy}
              />
              <button className="btn primary" disabled={busy || !text.trim()} onClick={submit} aria-label="Send">
                <i className="ri-send-plane-2-line" />
              </button>
            </div>
          )}

          {/* Nav */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0 14px", flexShrink: 0 }}>
            <span className="sp" />
            <button
              className={`btn ${finished || enough ? "primary" : ""}`}
              disabled={busy}
              onClick={onDone}
            >
              {finished ? "Check what I learned" : enough ? "That’s enough, check it" : "Check what I learned so far"}
              <i className="ri-arrow-right-line" />
            </button>
          </div>
        </div>
      </div>

      {/* Right: What I've learned */}
      <div className="ob2-rail">
        <div style={{ padding: "14px 12px 6px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>What I&apos;ve learned</span>
          <span className="small" style={{ color: "var(--muted)" }}>{doneCount} of {totalTopics} done</span>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 12px 12px" }}>
          <LiveNotes notes={liveNotes} />
        </div>
        {/* Speed up strip */}
        <div style={{ padding: "0 12px 14px" }}>
          <div className="ob2-speedup">
            <i className="ri-flashlight-line" />
            <div className="ob2-sp-t">
              <b>Speed up</b>
              <span>Skip questions: let me read your website or a doc first.</span>
            </div>
            <button className="btn sm"><i className="ri-upload-2-line" />Upload</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ Screen 4: Check */
function CheckScreen({
  st, noteValues, onNoteChange, onBack, onDone, busy,
}: {
  st: State;
  noteValues: Record<NoteKey, string>;
  onNoteChange: (key: NoteKey, val: string) => void;
  onBack: () => void;
  onDone: () => void;
  busy: boolean;
}) {
  const company = st.answers.company_name || "your business";
  const answerCount = Object.values(st.answers).filter(Boolean).length;
  return (
    <div className="ob2-layout" style={{ gridTemplateColumns: "1fr" }}>
      <div className="ob2-form">
        <div className="ob2-inner" style={{ maxWidth: 760 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Avatar who={{ id: "chief-of-staff", name: "Chief of Staff", is_chief: true }} size={32} />
            <div>
              <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>
                Here&apos;s what I understood about {company}
              </p>
              <p className="small" style={{ color: "var(--muted)", margin: 0 }}>
                Fix anything that&apos;s off. Helpers read these 7 notes before every job, and you can update them any time.
              </p>
            </div>
          </div>
          <EditableNotes values={noteValues} onChange={onNoteChange} />
        </div>
      </div>

      {/* Bottom nav */}
      <div className="ob2-nav" style={{ gridColumn: "1 / -1" }}>
        <button className="btn" onClick={onBack}><i className="ri-arrow-left-line" />Back to our chat</button>
        <span className="sp" />
        <span className="ob2-count">~9 min · {answerCount} answers</span>
        <button className="btn primary" disabled={busy} onClick={onDone}>
          Looks right, build my team<i className="ri-arrow-right-line" />
        </button>
      </div>
    </div>
  );
}

/* ================================================================ Screen 5: Your Team */
function TeamScreen({
  st, team, setTeam, roles, teamBy, mode, setMode, tz, setTz, onBack, onFinish, busy, err,
}: {
  st: State; team: Helper[]; setTeam: (t: Helper[]) => void;
  roles: RoleCard[]; teamBy: string; mode: string; setMode: (m: string) => void;
  tz: string; setTz: (z: string) => void;
  onBack: () => void; onFinish: () => void; busy: boolean; err: string | null;
}) {
  const company = st.answers.company_name || "your business";
  const activeCount = team.filter((h) => h.enabled !== false).length;
  const slug2 = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "helper";

  const toggle = (i: number) =>
    setTeam(team.map((h, j) => j === i ? { ...h, enabled: h.enabled === false ? true : false } : h));

  return (
    <div className="ob2-layout" style={{ gridTemplateColumns: "1fr" }}>
      <div className="ob2-form">
        <div className="ob2-inner" style={{ maxWidth: 680 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
            Your team for {company}
          </h2>
          <p className="lead" style={{ marginBottom: 20 }}>
            {teamBy === "ai"
              ? "Based on your goals and the work you want to hand off."
              : "Picked from your goals."}{" "}
            After you create them, each helper proposes its own job, you approve.
          </p>

          <div className="ob2-team-grid">
            {/* Chief of Staff — always on */}
            <div className="ob2-team-card chief">
              <Avatar who={{ id: "chief-of-staff", name: "Chief of Staff", is_chief: true }} size={40} />
              <div className="ob2-tc-t">
                <b>Chief of Staff <span className="chip" style={{ fontSize: 11 }}>Always included</span></b>
                <span>Writes your morning brief, routes every request, and runs the weekly retro.</span>
                <span className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                  <i className="ri-information-line" /> Every team needs one
                </span>
              </div>
            </div>

            {team.map((h, i) => (
              <div key={h.id + i} className={`ob2-team-card${h.enabled === false ? " off" : ""}`}
                style={{ opacity: h.enabled === false ? 0.55 : 1, transition: "opacity .2s" }}>
                <Avatar who={{ id: h.id, name: h.name, role: h.base }} size={40} />
                <div className="ob2-tc-t">
                  <b>
                    {h.name}
                    {roles.find((r) => r.id === h.base) &&
                      <span className="chip" style={{ fontSize: 11, marginLeft: 6 }}>
                        {roles.find((r) => r.id === h.base)?.tagline || h.base}
                      </span>}
                  </b>
                  <span>{h.focus}</span>
                  {h.why && (
                    <span className="small" style={{ color: "var(--muted)", marginTop: 2 }}>
                      <i className="ri-information-line" /> {h.why}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className={`toggle${h.enabled !== false ? " on" : ""}`}
                  aria-checked={h.enabled !== false}
                  role="switch"
                  aria-label={`${h.enabled !== false ? "Remove" : "Add"} ${h.name}`}
                  onClick={() => toggle(i)}
                  style={{
                    width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", flexShrink: 0,
                    background: h.enabled !== false ? "var(--ok)" : "var(--line-strong)",
                    transition: "background .2s", position: "relative",
                  }}
                >
                  <span style={{
                    position: "absolute", top: 2, width: 16, height: 16, borderRadius: "50%",
                    background: "#fff", transition: "left .2s",
                    left: h.enabled !== false ? 18 : 2,
                  }} />
                </button>
              </div>
            ))}
          </div>

          {/* Persona hint */}
          <div className="callout" style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
            <i className="ri-user-star-line" style={{ fontSize: 16, color: "var(--muted)" }} />
            <span className="small" style={{ flex: 1, color: "var(--ink-2)" }}>
              Want a real professional&apos;s experience? You can also hire a Persona later from the Personas gallery.{" "}
              <button type="button" className="linkbtn small">Browse</button>
            </span>
          </div>

          {/* Approval mode */}
          <label style={{ marginTop: 20 }}>How much freedom should your helpers have?</label>
          {Object.entries(st.options.approval_modes).map(([k, m]) => (
            <button type="button" key={k} className={`choice ${mode === k ? "on" : ""}`} onClick={() => setMode(k)}>
              <b>{m.label}{k === "ask_all" && <span className="rec">Recommended to start</span>}</b>
              <span>{m.detail}</span>
            </button>
          ))}

          <label style={{ marginTop: 16 }}>Your time zone</label>
          <select value={tz} onChange={(e) => setTz(e.target.value)}>
            {allTimezones(tz).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>

          <Err error={err} />
        </div>
      </div>

      {/* Bottom nav */}
      <div className="ob2-nav" style={{ gridColumn: "1 / -1" }}>
        <button className="btn" onClick={onBack}><i className="ri-arrow-left-line" />Back</button>
        <span className="sp" />
        <span className="ob2-count">
          {activeCount} helper{activeCount !== 1 ? "s" : ""} · they sleep until they have work
        </span>
        <button className="btn primary" disabled={busy} onClick={onFinish}>
          {busy ? "Creating your team…" : "Create my team"}<i className="ri-arrow-right-line" />
        </button>
      </div>
    </div>
  );
}

/* ================================================================ Done screen */
function DoneScreen({ company, team, done, onGo }: { company: string; team: Helper[]; done: string[]; onGo: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, padding: 32, textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>Your team is ready</h1>
      <p className="lead" style={{ maxWidth: 440, marginBottom: 24 }}>
        Before they start, every helper sends you its proposal in its own chat.
      </p>
      <ul className="checklist" style={{ textAlign: "left", maxWidth: 400, marginBottom: 28 }}>
        <li><i className="ri-briefcase-4-line" /><span>How it understands its job at {company}, and what it will own.</span></li>
        <li><i className="ri-flag-2-line" /><span>The goals it suggests, with numbers, and its first ideas.</span></li>
        <li><i className="ri-check-double-line" /><span><b>Approve</b> with one click, or reply with what to change.</span></li>
        <li><i className="ri-shield-check-line" /><span>Nothing is posted, sent or paid without your OK.</span></li>
      </ul>
      <button className="btn primary" onClick={onGo}>Meet my team<i className="ri-arrow-right-line" /></button>
    </div>
  );
}

/* ================================================================ Main page */
// Step indices: 0=welcome, 1=ai, 2=interview, 3=check, 4=team
// Stepper shows steps 1-4.

export default function Onboarding() {
  const router = useRouter();
  const [st, setSt] = useState<State | null>(null);
  const [step, setStep] = useState(0);
  const [team, setTeamState] = useState<Helper[] | null>(null);
  const [roles, setRoles] = useState<RoleCard[]>([]);
  const [teamBy, setTeamBy] = useState("");
  const [tz, setTz] = useState("UTC");
  const [mode, setMode] = useState("ask_all");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noteValues, setNoteValues] = useState<Record<NoteKey, string>>({} as Record<NoteKey, string>);

  const setTeam = useCallback((t: Helper[]) => setTeamState(t), []);

  useEffect(() => {
    api<State>("/onboarding").then((s) => {
      setSt(s);
      // Map old step to new: 0=welcome,1=ai,2=interview,3(old team)→4; add check(3) as new
      const oldStep = s.step || 0;
      const mappedStep = oldStep >= 3 ? oldStep + 1 : oldStep; // old team(3) → new team(4)
      setStep(Math.min(mappedStep, 4));
      setTz(s.timezone && s.timezone !== "UTC" ? s.timezone : browserTimezone());
      setMode(s.answers.approval_mode || "ask_all");
      if (s.team) setTeamState(s.team.map((h) => ({ ...h, enabled: true })));
    }).catch((e) => setErr(e.message));
  }, []);

  // When we arrive at check, derive note values from answers
  useEffect(() => {
    if (step === 3 && st) {
      setNoteValues(answersToNoteValues(st.answers, st.options));
    }
  }, [step, st]);

  const go = async (n: number) => {
    setErr(null);
    if (st) api("/onboarding", { method: "PUT", body: { answers: st.answers, step: n >= 4 ? 3 : n } }).catch(() => {});
    setStep(n);
  };

  const onAnswers = useCallback((answers: Answers, topics: Topic[]) =>
    setSt((s) => s ? { ...s, answers, topics } : s), []);

  const editField = async (f: string, v: string) => {
    if (!st) return;
    const answers = { ...st.answers, [f]: v };
    setSt({ ...st, answers });
    await api("/onboarding", { method: "PUT", body: { answers, step } }).catch((e) => setErr(e.message));
  };

  const planTeam = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ helpers: Helper[]; roles: RoleCard[]; by: string }>("/onboarding/team-plan", { body: {} });
      setTeamState(r.helpers.map((h) => ({ ...h, enabled: true })));
      setRoles(r.roles); setTeamBy(r.by);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (step === 4 && (!team || !roles.length)) planTeam();
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    if (!st || !team) return;
    setBusy(true); setErr(null);
    const activeHelpers = team.filter((h) => h.enabled !== false);
    try {
      const r = await api<{ created: string[] }>("/onboarding/finish", {
        body: {
          answers: { ...st.answers, approval_mode: mode },
          helpers: activeHelpers.map((h) => ({ id: h.id, base: h.base, name: h.name, focus: h.focus })),
          approval_mode: mode, timezone: tz, practice_task: false,
        },
      });
      setDone(r.created);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const logout = async () => {
    await api("/auth/logout", { body: {} });
    router.replace("/login/");
  };

  // --- loading / error states ---
  if (err && !st) return (
    <div className="ob2-page">
      <div style={{ padding: 24 }}><Err error={err} /></div>
    </div>
  );
  if (!st) return (
    <div className="ob2-page">
      <p className="small" style={{ padding: 24 }}>Loading…</p>
    </div>
  );

  const company = st.answers.company_name || "your company";

  // --- done ---
  if (done) {
    return (
      <div className="ob2-page">
        <TopBar company={company} onLogout={logout} />
        <DoneScreen company={company} team={team || []} done={done} onGo={() => router.replace("/chat/")} />
      </div>
    );
  }

  const stepperActive = step; // 1-4 maps 1:1; step 0 (welcome) → stepper shows step 1 not highlighted

  return (
    <div className="ob2-page">
      <TopBar company={company} onLogout={logout} />
      {step > 0 && <Stepper active={stepperActive} />}

      {step === 0 && (
        <WelcomeScreen company={company} onStart={() => go(1)} />
      )}

      {step === 1 && (
        <AiScreen
          providers={st.providers}
          ai={st.ai}
          onBack={() => go(0)}
          onDone={(ai) => { setSt({ ...st, ai }); go(2); }}
          onSkip={async () => {
            const ai = await api<Ai>("/onboarding/ai", { body: { provider: "fake" } }).catch(() => null);
            if (ai) setSt({ ...st, ai });
            go(2);
          }}
        />
      )}

      {step === 2 && (
        <InterviewScreen
          st={st}
          onAnswers={onAnswers}
          onDone={() => go(3)}
        />
      )}

      {step === 3 && (
        <CheckScreen
          st={st}
          noteValues={noteValues}
          onNoteChange={(key, val) => {
            setNoteValues((prev) => ({ ...prev, [key]: val }));
            // Map note key back to field and save if it's a single-field topic
            const topicId = Object.entries(TOPIC_TO_NOTE).find(([, nk]) => nk === key)?.[0];
            if (topicId && st) {
              const fields = SHOWN[topicId];
              if (fields?.length === 1) editField(fields[0][0], val);
            }
          }}
          onBack={() => go(2)}
          onDone={() => go(4)}
          busy={busy}
        />
      )}

      {step === 4 && (
        !team ? (
          <div style={{ padding: 24, flex: 1 }}>
            <p className="small">{busy ? "Putting your team together from what you told me…" : ""}</p>
            <Err error={err} />
          </div>
        ) : (
          <TeamScreen
            st={st}
            team={team}
            setTeam={setTeam}
            roles={roles}
            teamBy={teamBy}
            mode={mode}
            setMode={setMode}
            tz={tz}
            setTz={setTz}
            onBack={() => go(3)}
            onFinish={finish}
            busy={busy}
            err={err}
          />
        )
      )}
    </div>
  );
}
