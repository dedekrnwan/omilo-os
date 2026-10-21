"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Markdown } from "@/components/Markdown";
import { useCommand } from "@/components/command";

/* ------------------------------------------------------------------ guide model */

type Guide = {
  title: string;
  cat: string;            // category id
  readMin: number;
  updated: string;
  badge?: string;         // small chip shown in the sidebar + meta row
  ask?: string[];         // "Ask about this guide" suggestions
  md: string;
};

const CATS: { id: string; label: string; icon: string }[] = [
  { id: "inbox", label: "Inbox & approvals", icon: "ri-inbox-line" },
  { id: "helpers", label: "Helpers & jobs", icon: "ri-team-line" },
  { id: "workflows", label: "Workflows", icon: "ri-flow-chart" },
  { id: "connectors", label: "Connectors", icon: "ri-plug-line" },
  { id: "accounts", label: "AI accounts & spend", icon: "ri-stack-line" },
  { id: "data", label: "Data & the vault", icon: "ri-database-2-line" },
  { id: "personas", label: "Personas", icon: "ri-user-smile-line" },
];
const catLabel = (id: string) => CATS.find((c) => c.id === id)?.label || id;

/* Order matters: it drives the sidebar grouping and the prev/next links. */
const GUIDES: Record<string, Guide> = {
  /* ── Inbox & approvals ─────────────────────────────────────────── */
  "how-inbox-works": {
    title: "How the Inbox works", cat: "inbox", readMin: 2, updated: "20 Oct 2026", badge: "Works for every helper",
    ask: ["What's waiting for me right now?", "Which decisions are urgent?"],
    md: `# How the Inbox works

The Inbox is where you make decisions. When a helper needs something from you — approval for a job, a reply to a question, or a choice between options — it lands here.

## What you'll see

Each card shows which helper is asking, what it wants to do, and any proposals it drafted. Related decisions are grouped so they appear together under **Needs you**.

## Statuses

- **Needs you** — a decision is waiting. Nothing runs until you act.
- **Running now** — work in progress; no action needed.
- **Done today** — finished recently, kept for reference.

## Views

Switch between **Board**, **List**, and **Map** at the top right. The Map plots work against your goals so you can see what each decision is for.`,
  },
  "approve-many": {
    title: "Approve many jobs at once", cat: "inbox", readMin: 3, updated: "20 Oct 2026", badge: "Works for every helper",
    ask: ["Approve all proposals for me", "Which proposal should I check first?"],
    md: `# Approve many jobs at once

When several helpers propose work at the same time, you don't have to open each one. You can approve them together from the decision card, and still change any single one first.

## Steps

1. Open **Inbox**. Proposals that belong together show up as one card under **Needs you**.
2. Read the list. Each row is one helper and what it wants to do. Click a row to change it.
3. Choose **Approve all**. Nothing runs until you do, and each helper starts in its own chat.

## What happens next

Each helper confirms in its own chat and starts on its schedule. The Chief of Staff folds the results into tomorrow's morning brief, and anything that still needs you lands back in the Inbox.

Changed your mind? Every approval can be undone from the helper's chat for 10 minutes, as long as the job hasn't started.`,
  },
  "reply-instead-of-approving": {
    title: "Reply instead of approving", cat: "inbox", readMin: 2, updated: "20 Oct 2026",
    ask: ["How do I ask a helper to change a draft?"],
    md: `# Reply instead of approving

Not every card is a yes/no. When a helper asks a question or drafts something you'd rather adjust, reply in plain language instead of approving.

## How it works

1. Open the card and type your reply where it says **Reply**.
2. The helper reads it and continues from there — it can revise a draft, pick a different option, or ask a follow-up.
3. The thread stays in the Inbox until the helper has what it needs.

Replying never runs the action. A helper only sends, posts, or spends after you explicitly approve.`,
  },
  "approve-by-email": {
    title: "Approve by email", cat: "inbox", readMin: 2, updated: "20 Oct 2026", badge: "SMTP",
    ask: ["How do I turn on email notifications?"],
    md: `# Approve by email

If you don't want to keep the app open, Omilo can email you when a helper needs a decision — and you can reply straight from your inbox.

## Turn it on

Go to **Settings → Notifications** and add an email address. Omilo sends a message whenever a card lands in **Needs you**.

> **Note:** email sending needs an SMTP server configured for this install. If you don't see the option, ask whoever set up Omilo to add SMTP credentials.

## Replying

Reply to the email with *approve*, *reject*, or a plain-language note. Your reply shows up in the helper's chat exactly as if you'd typed it in the app.`,
  },

  /* ── Helpers & jobs ────────────────────────────────────────────── */
  "helpers-and-jobs": {
    title: "Helpers & jobs", cat: "helpers", readMin: 3, updated: "21 Oct 2026",
    ask: ["Hire a helper for me", "What can a helper do without asking?"],
    md: `# Helpers & jobs

Helpers are your AI teammates. Each one has a job, a schedule, and a set of things it may do without asking you.

## Hiring

Open **Team → Hire a helper** and pick a role (Chief of Staff, a specialist, or a blank helper). Give it a name and the Chief of Staff it reports to.

## Configuring a helper

Open any helper to set:

- **Job description** — the instructions it reads before every task.
- **Schedule** — when its regular jobs run (see *How jobs run*).
- **Engine** — which AI account powers it (see *AI accounts & spend*).
- **Permissions** — what it may do without asking, and what always waits for you.
- **Budget** — an optional monthly spend cap in USD.
- **Access** — the folders, connectors, and skills it can reach.

## Chatting

Every helper has its own chat. Use it to give a one-off task, ask what it's working on, or correct it — corrections become lessons it reads next time.`,
  },
  "how-jobs-run": {
    title: "How jobs run", cat: "helpers", readMin: 4, updated: "21 Oct 2026",
    ask: ["What is a regular job?", "Why is a job waiting?"],
    md: `# How jobs run

A **job** is one unit of work for a helper. Jobs come from a schedule, a chat, the Plan, or another helper handing work over.

## Regular jobs (schedules)

On a helper's page, add a **regular job**: a name, a schedule (daily, weekdays, weekly — or a cron expression), and a brief describing what to do. The helper runs it automatically at that time.

## Runs and steps

When a job runs, you see it live as a **run**: a sequence of **steps** — reading files, searching, drafting, calling a connected app. Open the run to expand any step and see exactly what the helper did.

## Approvals and pauses

If a step would send, post, spend, or deploy, the helper **proposes** it instead of doing it. The job **pauses** and the proposal lands in your Inbox with the exact action and a risk level. The helper waits — it doesn't fail — until you approve, reject, or ask for changes. A helper can also pause to **ask you a question** mid-run.

## The Monitor

**Monitor** shows how your helpers are doing: who's working now, tokens and spend, jobs done vs. failed, run times, and the latest activity. The **Loops** section tracks each regular job — how often it ran and whether it's still producing useful work.

## Weekly retro

Once a week, a retro reviews each regular job and may tune a helper's instructions, brief, schedule, or lessons. Every change is measured against the previous week and kept only if results held up — and you can undo any change from the Monitor. Permissions, budgets, and the rules about what needs your approval are never changed automatically.`,
  },

  /* ── Workflows ─────────────────────────────────────────────────── */
  "workflows": {
    title: "Workflows", cat: "workflows", readMin: 2, updated: "20 Oct 2026",
    ask: ["How do I build a workflow?"],
    md: `# Workflows

A workflow is a repeatable sequence of steps you design once and reuse — for example: *draft a post → wait for your OK → publish → schedule a follow-up*.

## Building one

Open **Workflows → New** and add steps on the canvas. A step can run a helper, call a connected app, wait for your approval, or branch on a condition.

## Approvals inside a workflow

Any step that leaves the company (posts, emails, payments) can require your OK. The workflow pauses at that step and continues the moment you approve — the same pause you see for ordinary jobs.`,
  },

  /* ── Connectors ────────────────────────────────────────────────── */
  "connectors": {
    title: "Connectors", cat: "connectors", readMin: 3, updated: "21 Oct 2026",
    ask: ["Connect Gmail", "What can a helper do with WhatsApp?"],
    md: `# Connectors

Connectors give helpers the apps you already use — Gmail, Google Calendar, Google Sheets, WhatsApp, Instagram, Facebook, and more. Anything that posts, sends, or spends still waits for your OK.

## Connecting an app

1. Open **Connectors** and find the app. Search by name or filter by category.
2. Click **Connect**. A sign-in window opens and you log in with your own account.
3. When it finishes, the card shows **Connected** and lists what helpers can do with it.

## Actions and approval

Each app lists its **actions** — for example Gmail can *read*, *draft*, and *send*. Read-only actions run on their own; anything that sends or changes something is marked **needs your OK** and waits in the Inbox. The card shows a count like *"2 actions · 1 needs your OK"*.

## Who can use what

By default a connector is available to helpers you allow. On a helper's **Access** tab you can turn each connector on or off and decide whether it must ask you first. You can also toggle connectors per chat.

If a connector isn't set up on the server yet, **Connect** will tell you it isn't available — that's expected until it's enabled.`,
  },
  "custom-integrations": {
    title: "Custom integrations (MCP)", cat: "connectors", readMin: 3, updated: "21 Oct 2026",
    ask: ["How do I add a custom MCP server?"],
    md: `# Custom integrations (MCP)

Need something that isn't in the catalog? Add it yourself under **Connectors → Custom integration**. Omilo speaks **MCP** (Model Context Protocol), so you can connect any MCP server.

## Two kinds

- **A web address** — point Omilo at an MCP server's URL (good for hosted tools like Zapier, GitHub, or Context7).
- **A program** — run an MCP server on this computer, e.g. \`npx @playwright/mcp@latest\` for browser control. Omilo starts it for you.

## Setting it up

1. Pick a template or start blank, and give it a name.
2. Enter the address or command, plus any secret headers or environment variables (API keys, tokens). Secrets are encrypted.
3. Choose whether its actions run on their own or **ask you first**, and whether it's on by default in new chats.
4. **Test** the connection, then save.

Helpers can only call tools from connectors you've turned on for them — custom ones included.`,
  },

  /* ── AI accounts & spend ───────────────────────────────────────── */
  "ai-accounts": {
    title: "AI accounts & the Claude Code pool", cat: "accounts", readMin: 4, updated: "21 Oct 2026",
    ask: ["Why is an account resting?", "What does API overflow mean?"],
    md: `# AI accounts & the Claude Code pool

Helpers run on AI accounts you provide, so you control spend and capacity. There are two kinds: a **Claude Code pool** of subscription accounts, and **direct API keys**.

## The Claude Code pool

Add one or more Claude accounts to the pool. When a helper runs, it uses a free account from the pool; when that account hits its limit, it rests and the next job picks a different one. Running several accounts lets jobs run in parallel.

Pooling consumer subscriptions is opt-in and shown behind a one-time notice — if the pool ever stops working, Omilo falls back automatically and never loses work.

## Pool status

At the bottom of a chat and on the **Monitor** you'll see the pool's health:

- **N/N ready** — how many accounts are usable right now.
- **working** — helpers running at this moment.
- **resting** — accounts cooling down after hitting their limit, with when they reset.

## API overflow

If every pool account is busy or resting and you've added a direct API key, the job **spills over to the API key** instead of waiting — the run label shows which account actually answered (e.g. *"Claude Code pool + API overflow"*). With no API key set, the job waits for an account to free up rather than failing.

## Direct API keys

Add provider API keys (Anthropic, OpenAI, Gemini, and others) under **AI accounts**. Test each key to confirm it works. A helper's **Engine** setting decides whether it uses the pool or a specific API key.

## Watching spend

Each account shows its usage in the current window, tokens used, and spend. Every job records its own token use — open a run's steps to see it. You can also set a monthly budget per helper, and **Pause all helpers** in the sidebar stops new runs immediately.`,
  },

  /* ── Data & the vault ──────────────────────────────────────────── */
  "docs-vault": {
    title: "Docs & the vault", cat: "data", readMin: 3, updated: "21 Oct 2026",
    ask: ["How do helpers use the docs?", "How do I link two notes?"],
    md: `# Docs & the vault

**Docs** is the shared notebook you and your helpers read and write. It's Markdown with **[[wiki links]]** between notes — click a link to jump, and links keep working when a note is renamed or moved.

## Folders

- **Company** — who you are: profile, offer, voice, rules, KPIs. Helpers read this before they work.
- **Memory** — what helpers learned (see *Memory*).
- Plus any folders you create.

## Helpers writing docs

Helpers can draft and update notes. A change to a **Company** note comes in as a **suggestion** you approve first — every edit is attributed and logged, and you can revert to any earlier version.`,
  },
  "memory": {
    title: "Memory: what helpers learn", cat: "data", readMin: 2, updated: "21 Oct 2026",
    ask: ["What has this helper learned?", "How do I correct a helper?"],
    md: `# Memory: what helpers learn

Under **Docs → Memory**, each helper keeps two notes: **Lessons** (facts and patterns it picked up) and **Notes** (things you want it to remember). It reads both before every task.

## How it fills up

When you correct a helper in chat, or the weekly retro tunes a job, the change is written to that helper's Lessons with a short note on why. You can edit any Memory note directly — the helper reads your version next time.`,
  },
  "knowledge": {
    title: "Knowledge & search", cat: "data", readMin: 3, updated: "21 Oct 2026",
    ask: ["How does search by meaning work?", "Which embedding model should I pick?"],
    md: `# Knowledge & search

The **Knowledge** base makes everything searchable — docs, memory, finished job reports, chats, approved proposals, uploaded files, and saved pages.

## Search by meaning

Each item is embedded so helpers can search by *meaning*, not just keywords. When a helper looks something up, it finds the closest matches and shows the source and a snippet. The Knowledge **map** plots items by meaning, so related things sit together.

## Embedding model

Under **Docs → Knowledge** you choose how items are embedded:

- **Local** — free and private, with a one-time model download.
- **Voyage AI** or **OpenAI** — hosted models that trade a small cost for quality.

The **Sources** tab lists everything indexed, how many times it's been searched, and any items that failed to embed.`,
  },
  "activity-log": {
    title: "Activity & data", cat: "data", readMin: 2, updated: "21 Oct 2026",
    ask: ["Who changed this?", "Where is my data stored?"],
    md: `# Activity & data

## Activity log

**Settings → Activity log** is the audit trail: every change to jobs, proposals, docs, settings, and helpers — with the time, who did it (you, a helper, or the system), and what changed. Filter by date, type, or actor.

## Data & storage

**Settings → Data & storage** shows where this Omilo install keeps your data and its current status. What's available here depends on how your install is set up.`,
  },

  /* ── Personas ──────────────────────────────────────────────────── */
  "personas": {
    title: "Personas", cat: "personas", readMin: 2, updated: "20 Oct 2026",
    ask: ["What is a persona?"],
    md: `# Personas

A persona is the voice and character a helper uses when it talks to your customers — its tone, the traits it leans on, and the lines it should never cross.

## Setting one

Open a helper and choose or edit its persona: a short description of how it should sound, example phrases, and any hard limits. The helper uses it in every message it drafts, so replies feel consistent.`,
  },
};

/* order of slugs grouped by category, for sidebar + prev/next */
const ORDER = Object.keys(GUIDES);
const slugsInCat = (cat: string) => ORDER.filter((s) => GUIDES[s].cat === cat);

/* ------------------------------------------------------------------ helpers */

const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function useGo() {
  return (slug: string | null) => {
    const url = slug ? `/help/?a=${slug}` : "/help/";
    window.history.pushState({}, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
}

/* ------------------------------------------------------------------ sidebar */

function Sidebar({ slug, go }: { slug: string | null; go: (s: string | null) => void }) {
  const [q, setQ] = useState("");
  const current = slug ? GUIDES[slug] : null;
  const ql = q.trim().toLowerCase();

  if (ql) {
    const hits = ORDER.filter((s) => GUIDES[s].title.toLowerCase().includes(ql) || catLabel(GUIDES[s].cat).toLowerCase().includes(ql));
    return (
      <aside className="help2-side">
        <SearchBox q={q} setQ={setQ} go={go} />
        <div className="help2-side-group">
          <p className="help2-side-h">{hits.length} result{hits.length === 1 ? "" : "s"}</p>
          {hits.map((s) => <SideItem key={s} s={s} active={s === slug} go={go} />)}
          {hits.length === 0 && <p className="small" style={{ padding: "4px 10px", color: "var(--muted)" }}>No guides match.</p>}
        </div>
      </aside>
    );
  }

  const cat = current?.cat;
  const otherCats = CATS.filter((c) => c.id !== cat);
  return (
    <aside className="help2-side">
      <SearchBox q={q} setQ={setQ} go={go} />
      {current && (
        <div className="help2-side-group">
          <p className="help2-side-h"><i className={CATS.find((c) => c.id === cat)?.icon} />{catLabel(cat!)}</p>
          {slugsInCat(cat!).map((s) => <SideItem key={s} s={s} active={s === slug} go={go} />)}
        </div>
      )}
      <div className="help2-side-group">
        <p className="help2-side-h">{current ? "Other guides" : "All guides"}</p>
        {otherCats.map((c) => {
          const first = slugsInCat(c.id)[0];
          return (
            <button key={c.id} className="help2-side-cat" onClick={() => go(first)}>
              <i className={c.icon} /><span>{c.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function SearchBox({ q, setQ, go }: { q: string; setQ: (v: string) => void; go: (s: string | null) => void }) {
  return (
    <div className="help2-side-top">
      <button className="help2-allbtn" onClick={() => go(null)}><i className="ri-arrow-left-line" />All guides</button>
      <div className="help2-search">
        <i className="ri-search-line" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guides" />
      </div>
    </div>
  );
}

function SideItem({ s, active, go }: { s: string; active: boolean; go: (s: string) => void }) {
  const g = GUIDES[s];
  return (
    <button className={`help2-side-item ${active ? "on" : ""}`} onClick={() => go(s)}>
      <span>{g.title}</span>
      {g.badge === "SMTP" && <span className="help2-side-badge">SMTP</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ on this page + ask */

function Aside({ guide }: { guide: Guide }) {
  const headings = useMemo(() => (guide.md.match(/^## (.+)$/gm) || []).map((h) => h.replace(/^## /, "")), [guide]);
  const { open } = useCommand();
  const [ask, setAsk] = useState("");

  // Assign ids to the rendered H2s so the TOC can scroll to them.
  useEffect(() => {
    const hs = document.querySelectorAll<HTMLElement>(".help2-article h2");
    hs.forEach((el) => { el.id = anchor(el.textContent || ""); });
  }, [guide]);

  return (
    <aside className="help2-aside">
      {headings.length > 0 && (
        <div className="help2-toc">
          <p className="help2-aside-h">On this page</p>
          {headings.map((h) => (
            <a key={h} href={`#${anchor(h)}`} className="help2-toc-link"
              onClick={(e) => { e.preventDefault(); document.getElementById(anchor(h))?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
              {h}
            </a>
          ))}
        </div>
      )}
      <div className="help2-ask">
        <div className="help2-ask-head">
          <span className="help2-ask-ava"><i className="ri-vip-crown-2-line" /></span>
          <b>Ask about this guide</b>
        </div>
        <p className="help2-ask-sub">Chief of Staff can apply this to your company right now.</p>
        {(guide.ask || []).map((sug) => (
          <button key={sug} className="help2-ask-chip" onClick={() => open(sug)}>
            <i className="ri-sparkling-2-line" />{sug}
          </button>
        ))}
        <form className="help2-ask-form" onSubmit={(e) => { e.preventDefault(); if (ask.trim()) { open(ask.trim()); setAsk(""); } }}>
          <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Ask a question…" />
          <button type="submit" aria-label="Ask"><i className="ri-arrow-up-line" /></button>
        </form>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ article */

function Article({ slug, go }: { slug: string; go: (s: string | null) => void }) {
  const guide = GUIDES[slug];
  const [vote, setVote] = useState<"up" | "down" | null>(null);

  // next guide: next in the same category, else first of the next category
  const inCat = slugsInCat(guide.cat);
  const idxInCat = inCat.indexOf(slug);
  let next: string | null = inCat[idxInCat + 1] || null;
  if (!next) {
    const ci = CATS.findIndex((c) => c.id === guide.cat);
    for (let i = ci + 1; i < CATS.length && !next; i++) next = slugsInCat(CATS[i].id)[0] || null;
  }

  return (
    <main className="help2-main">
      <nav className="help2-crumb"><button onClick={() => go(null)}>Guides</button> <i className="ri-arrow-right-s-line" /> <span>{catLabel(guide.cat)}</span></nav>
      <h1 className="help2-title">{guide.title}</h1>
      <div className="help2-meta">
        <span>{guide.readMin} min read</span>
        <span>·</span>
        <span>Updated {guide.updated}</span>
        {guide.badge && guide.badge !== "SMTP" && <span className="help2-meta-badge">{guide.badge}</span>}
      </div>
      <article className="help2-article">
        <Markdown text={guide.md.replace(/^# .+\n/, "")} />
      </article>
      <div className="help2-foot">
        <div className="help2-helpful">
          <span>Was this helpful?</span>
          <button className={vote === "up" ? "on" : ""} onClick={() => setVote("up")} aria-label="Yes"><i className="ri-thumb-up-line" /></button>
          <button className={vote === "down" ? "on" : ""} onClick={() => setVote("down")} aria-label="No"><i className="ri-thumb-down-line" /></button>
          {vote && <span className="help2-thanks">Thanks for the feedback.</span>}
        </div>
        {next && (
          <button className="help2-next" onClick={() => go(next)}>Next: {GUIDES[next].title} <i className="ri-arrow-right-line" /></button>
        )}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ landing */

function Landing({ go }: { go: (s: string | null) => void }) {
  return (
    <main className="help2-main">
      <div className="help2-landing-head">
        <h1>Help &amp; guides</h1>
        <p>Short, practical guides for running your AI team. Search above, or ask the Chief of Staff anything with ⌘K.</p>
      </div>
      {CATS.map((c) => (
        <section key={c.id} className="help2-landing-cat">
          <p className="help2-landing-cat-h"><i className={c.icon} />{c.label}</p>
          <div className="help2-landing-grid">
            {slugsInCat(c.id).map((s) => (
              <button key={s} className="help2-card" onClick={() => go(s)}>
                <b>{GUIDES[s].title}</b>
                <span>{GUIDES[s].readMin} min</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

/* ------------------------------------------------------------------ page */

function HelpInner() {
  const params = useSearchParams();
  const [, force] = useState(0);
  const go = useGo();
  // re-render on history navigation (go() dispatches popstate)
  useEffect(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  const slug = (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("a") : params?.get("a")) || null;
  const guide = slug ? GUIDES[slug] : null;

  return (
    <div className={`help2 ${guide ? "" : "is-landing"}`}>
      <Sidebar slug={slug} go={go} />
      {guide ? (
        <>
          <Article slug={slug!} go={go} />
          <Aside guide={guide} />
        </>
      ) : (
        <Landing go={go} />
      )}
    </div>
  );
}

export default function HelpPage() {
  return (
    <Suspense fallback={<div className="help2"><p className="small" style={{ padding: 24 }}>Loading…</p></div>}>
      <HelpInner />
    </Suspense>
  );
}
