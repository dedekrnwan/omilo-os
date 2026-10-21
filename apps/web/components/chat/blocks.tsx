"use client";
/**
 * blocks.tsx — renderBlock(block, ctx)
 *
 * A switch over every block `type` emitted by Message.blocks.
 * Covers all legacy types (choices, access_request, job_proposal, question, proposal, file, mentions)
 * plus all new v2 types (reasoning, todos, markdown, code, action_card, confirmation, streaming_approval,
 * task, sources, usage_meter, document, image, streaming).
 *
 * The default: branch renders the block's text/content field as markdown (safe fallback — never crashes
 * on an unknown or future block type).
 *
 * Consumed by Reply.tsx (Tasks 2), and will be imported directly by Tasks 5 and 7.
 */

import React, { useRef, useState } from "react";
import { Markdown, Attachments, fileUrl, fileIcon, renderMarkdown } from "@/components/Markdown";
import { when } from "@/lib/api";
import type { Msg } from "@/components/Conversation";

/* ------------------------------------------------------------------ Block type union */

export type BlockType =
  | "choices"
  | "access_request"
  | "job_proposal"
  | "question"
  | "proposal"
  | "file"
  | "mentions"
  | "reasoning"
  | "todos"
  | "markdown"
  | "code"
  | "action_card"
  | "confirmation"
  | "streaming_approval"
  | "task"
  | "sources"
  | "usage_meter"
  | "document"
  | "image"
  | "streaming"
  | string; // allow unknown/future types — safe fallback

export type Block = {
  type: BlockType;
  // shared optional fields
  id?: string;
  name?: string;
  mime?: string;
  size?: number;
  request_id?: string;
  kind?: string;
  target?: Record<string, unknown>;
  reason?: string;
  decided?: string;
  proposal_id?: string;
  title?: string;
  risk?: "low" | "medium" | "high";
  summary?: string;
  item_id?: string;
  question?: string;
  options?: string[];
  // v2 fields
  text?: string;
  content?: string;
  label?: string;
  lang?: string;
  url?: string;
  generating?: boolean;
  progress?: number;
  prompt?: string;
  items?: TodoItem[];
  steps?: string;
  status?: string;
  task_id?: string;
  task_title?: string;
  task_status?: string;
  task_steps_done?: number;
  task_steps_total?: number;
  task_staff?: string;
  sources?: SourceItem[];
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  duration_s?: number;
  budget_pct?: number;
  account?: string;
  action?: string;
  action_title?: string;
  action_target?: string;
  action_icon?: string;
  details?: string[];
  done?: boolean;
  pause_label?: string;
  pause_step?: string;
  pause_quote?: string;
  pause_steps_left?: string;
  /** Optional diff lines for Code blocks — when present, renders the dark diff view */
  diff?: DiffLine[];
  // streaming_approval callbacks live in ctx
  [key: string]: unknown;
};

export type TodoItem = {
  text: string;
  status?: "done" | "active" | "pending";
};

/** One line in a code diff (optional field on a `code` block) */
export type DiffLine = {
  /** 1-based line number (or display label) */
  n: number | string;
  /** " " = context, "+" = added, "-" = removed */
  sign: " " | "+" | "-";
  /** raw code text for the line */
  text: string;
};

export type SourceItem = {
  n: number;
  icon?: string;
  title?: string;
  subtitle?: string;
  url?: string;
};

/* ------------------------------------------------------------------ Context passed through renderBlock */

export type BlockCtx = {
  /** The full message containing this block, needed for callbacks */
  m: Msg;
  messages?: Msg[];
  busy?: boolean;
  onPick?: (o: string) => void;
  onDecide?: (requestId: string, scope: "once" | "always" | "deny", note: string) => void;
  onProposal?: (proposalId: string, decision: "approve" | "reject" | "changes", note: string) => void;
  onAnswer?: (itemId: string, answer: string) => void;
  onStop?: () => void;
  /** Called when user clicks Apply on a code diff block */
  onApply?: (block: Block) => void;
  people?: { id: string; name: string }[];
};

/* ================================================================== Individual block renderers */

/* ---- choices ---- */
function ChoicesBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const [sent, setSent] = useState<string | null>(null);
  const idx = ctx.messages?.findIndex((x) => x.id === ctx.m.id) ?? -1;
  const answer = ctx.messages?.slice(idx + 1).find((x) => x.role === "owner");
  const chosen = sent || answer?.text || null;
  const open = !answer && !sent;
  const { busy, onPick } = ctx;
  return (
    <>
      <div className="choices">
        {(block.options || []).map((o) => (
          <button
            key={o}
            type="button"
            className={`pick ${chosen === o ? "on" : ""}`}
            disabled={!open || !!busy}
            title={open && busy ? "Wait until the helper finishes this turn" : undefined}
            onClick={() => { setSent(o); onPick?.(o); }}
          >
            {o}
          </button>
        ))}
      </div>
      {open && busy && <div className="small" style={{ marginTop: 4 }}>You can pick as soon as the helper finishes this turn.</div>}
    </>
  );
}

/* ---- access_request ---- */
function decidedLabel(decided: string): string {
  if (decided === "once") return "Allowed for this session";
  if (decided === "always") return "Allowed for this helper from now on (Team → Access)";
  if (decided === "deny") return "Denied";
  return decided;
}

export function accessLabel(kind: string, target: Record<string, unknown>): string {
  if (kind === "folder") {
    const path = String(target.path || "");
    const access = target.access === "write" ? "read and write" : "read";
    const hasCommands = !!target.commands;
    const cmds = hasCommands ? ", and run commands in it" : "";
    return `Folder: ${path} (${access}${cmds})`;
  }
  if (kind === "connector") return `Connection: ${String(target.name || target.id || "")}`;
  if (kind === "skill") return `Skill: ${String(target.name || target.slug || "")}`;
  return kind;
}

function AccessRequestBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const [denyOpen, setDenyOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const requestId = block.request_id || "";
  const kind = block.kind || "";
  const target = (block.target as Record<string, unknown>) || {};
  const reason = block.reason || "";
  const decided = block.decided;

  const decide = async (scope: "once" | "always" | "deny", n = "") => {
    setBusy(true);
    try { await ctx.onDecide?.(requestId, scope, n); } finally { setBusy(false); }
  };

  const openDeny = () => { setDenyOpen(true); setTimeout(() => noteRef.current?.focus(), 0); };

  if (decided) {
    return (
      <div className="callout warn" style={{ marginTop: 8 }}>
        <div className="small" style={{ fontWeight: 500, marginBottom: 4 }}>Access request</div>
        <div style={{ marginBottom: 4 }}>{accessLabel(kind, target)}</div>
        {reason && <div className="small" style={{ marginBottom: 6 }}>{reason}</div>}
        <div className="small" style={{ color: decided === "deny" ? "var(--bad)" : "var(--ok)", fontWeight: 500 }}>
          {decided === "deny" ? <i className="ri-close-circle-line" /> : <i className="ri-checkbox-circle-line" />}{" "}
          {decidedLabel(decided)}
        </div>
      </div>
    );
  }

  return (
    <div className="callout warn" style={{ marginTop: 8 }}>
      <div className="small" style={{ fontWeight: 500, marginBottom: 4 }}>Access request</div>
      <div style={{ marginBottom: 4 }}>{accessLabel(kind, target)}</div>
      {reason && <div className="small" style={{ marginBottom: 8 }}>{reason}</div>}
      {!denyOpen ? (
        <div className="acts" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" type="button" disabled={busy} onClick={() => decide("once")}>Allow once</button>
          <button className="btn sm" type="button" disabled={busy} onClick={() => decide("always")} title="This helper keeps it; change it later on Team → the helper → Access">Always allow this helper</button>
          <button className="btn sm danger" type="button" disabled={busy} onClick={openDeny}>Deny</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Optional: why you're denying this (the helper will see it)" rows={2}
            aria-label="Reason for denying (optional, visible to the helper)"
            style={{ resize: "vertical", fontSize: 13 }}
            onKeyDown={(e) => { if (e.key === "Escape") { setDenyOpen(false); setNote(""); } }} />
          <div className="acts" style={{ gap: 6 }}>
            <button className="btn sm danger" type="button" disabled={busy} onClick={() => decide("deny", note)}>Confirm deny</button>
            <button className="btn sm quiet" type="button" disabled={busy} onClick={() => { setDenyOpen(false); setNote(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- job_proposal ---- */
function JobProposalBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const [status, setStatus] = useState<string>((block as Record<string, any>).status || "pending");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { m } = ctx;
  if (status === "replaced") return <div className="small" style={{ marginTop: 6 }}><i className="ri-history-line" /> Replaced by a newer version below.</div>;
  if (status === "approved") return <div className="callout ok jobcard"><i className="ri-checkbox-circle-fill" /> Approved. It&apos;s part of the job description now (Team → the helper → Job).</div>;
  return (
    <div className="callout jobcard">
      <div className="acts" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm primary" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            const { api } = await import("@/lib/api");
            await api(`/messages/${m.id}/job`, { body: { decision: "approve" } });
            setStatus("approved");
          } catch (e: unknown) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
        }}><i className="ri-check-line" />Approve this job</button>
        <span className="small">or reply below with what to change, and I&apos;ll send a new version.</span>
      </div>
      {err && <div className="small" style={{ color: "var(--bad)", marginTop: 6 }}>{err}</div>}
    </div>
  );
}

/* ---- question ---- */
function QuestionBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const [answer, setAnswer] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const itemId = block.item_id || "";
  const questionText = block.question || "";

  const send = async () => {
    if (!answer.trim()) return;
    setBusy(true);
    try { await ctx.onAnswer?.(itemId, answer); setSent(true); } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <div className="callout" style={{ marginTop: 8 }}>
        <div className="small" style={{ marginBottom: 4 }}>{questionText}</div>
        <div className="small" style={{ color: "var(--ok)", fontWeight: 500 }}><i className="ri-checkbox-circle-line" /> Answer sent</div>
      </div>
    );
  }
  return (
    <div className="callout" style={{ marginTop: 8 }}>
      <div className="small" style={{ fontWeight: 500, marginBottom: 6 }}>{questionText}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer here" rows={2} aria-label="Your answer to the helper's question"
          style={{ resize: "vertical", fontSize: 13 }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <div className="acts" style={{ gap: 6 }}>
          <button className="btn sm primary" type="button" disabled={busy || !answer.trim()} onClick={send}><i className="ri-send-plane-line" />Send answer</button>
        </div>
      </div>
    </div>
  );
}

/* ---- proposal ---- */
function ProposalBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const [noteOpen, setNoteOpen] = useState<"reject" | "changes" | null>(null);
  const [note, setNote] = useState("");
  const [decided, setDecided] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const proposalId = block.proposal_id || "";
  const title = block.title || "";
  const risk = block.risk || "low";
  const summary = block.summary || "";

  const act = async (decision: "approve" | "reject" | "changes", n = "") => {
    setBusy(true);
    try { await ctx.onProposal?.(proposalId, decision, n); setDecided(decision); } finally { setBusy(false); }
  };

  const openNote = (kind: "reject" | "changes") => { setNoteOpen(kind); setTimeout(() => noteRef.current?.focus(), 0); };

  const riskChip = risk === "high"
    ? <span className="chip down">High risk</span>
    : risk === "medium"
    ? <span className="chip outline">Medium risk</span>
    : <span className="chip quiet">Low risk</span>;

  if (decided) {
    const label = decided === "approve" ? "Approved" : decided === "changes" ? "Changes requested" : "Rejected";
    const icon = decided === "approve" ? "ri-checkbox-circle-fill" : "ri-close-circle-line";
    const color = decided === "approve" ? "var(--ok)" : "var(--bad)";
    return (
      <div className="callout" style={{ marginTop: 8 }}>
        <div className="small" style={{ fontWeight: 500, marginBottom: 4 }}>Proposal: {title}</div>
        <div className="small" style={{ color, fontWeight: 500 }}><i className={icon} /> {label}</div>
      </div>
    );
  }
  return (
    <div className="callout" style={{ marginTop: 8 }}>
      <div className="acts" style={{ gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <div className="small" style={{ fontWeight: 500 }}>Proposal: {title}</div>
        {riskChip}
      </div>
      {summary && <div className="small" style={{ marginBottom: 8 }}>{summary}</div>}
      {!noteOpen ? (
        <div className="acts" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" type="button" disabled={busy} onClick={() => act("approve")}><i className="ri-check-line" />Approve</button>
          <button className="btn sm" type="button" disabled={busy} onClick={() => openNote("changes")}><i className="ri-edit-line" />Request changes</button>
          <button className="btn sm danger" type="button" disabled={busy} onClick={() => openNote("reject")}><i className="ri-close-line" />Reject</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={noteOpen === "changes" ? "What should change? (the helper will see this)" : "Why are you rejecting this? (the helper will see this)"}
            rows={2}
            aria-label={noteOpen === "changes" ? "Reason for requesting changes (visible to the helper)" : "Reason for rejecting (visible to the helper)"}
            style={{ resize: "vertical", fontSize: 13 }}
            onKeyDown={(e) => { if (e.key === "Escape") { setNoteOpen(null); setNote(""); } }} />
          <div className="acts" style={{ gap: 6 }}>
            <button className={noteOpen === "reject" ? "btn sm danger" : "btn sm"} type="button"
              disabled={busy || !note.trim()} onClick={() => act(noteOpen!, note)}>
              {noteOpen === "changes" ? <><i className="ri-edit-line" />Send changes</> : <><i className="ri-close-line" />Confirm reject</>}
            </button>
            <button className="btn sm quiet" type="button" disabled={busy} onClick={() => { setNoteOpen(null); setNote(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- file ---- */
function FileBlock({ block }: { block: Block }) {
  // Single file block rendered via Attachments-compatible approach
  return <Attachments blocks={[block as { type: string; id?: string; name?: string; mime?: string; size?: number }]} />;
}

/* ---- reasoning (collapsible) ---- */
function ReasoningBlock({ block }: { block: Block }) {
  const [open, setOpen] = useState(false);
  const label = block.label || block.title || "Thought";
  const content = block.content || block.text || "";
  return (
    <div className={`reply-reasoning${open ? " open" : ""}`}>
      <button type="button" className="reply-reasoning-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <i className="ri-brain-line" />
        <span>{label}</span>
        <span className="sp" />
        <i className={open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
      </button>
      {open && (
        <div className="reply-reasoning-lines">
          <Markdown text={content} />
        </div>
      )}
    </div>
  );
}

/* ---- todos ---- */
function TodosBlock({ block }: { block: Block }) {
  const items: TodoItem[] = block.items || [];
  const doneCount = items.filter((i) => i.status === "done").length;
  const label = block.title || block.label || "Plan";
  return (
    <div className="reply-todo">
      <div className="reply-todo-top">
        <span className="reply-todo-plan">{label}</span>
        {items.length > 0 && <span className="reply-todo-count">{doneCount} of {items.length} done</span>}
        <span className="sp" />
        <button type="button" className="iconbtn reply-todo-add" aria-label="Add step"><i className="ri-add-line" /></button>
      </div>
      {items.map((item, i) => {
        const s = item.status || "pending";
        return (
          <div key={i} className={`reply-todo-item ${s}`}>
            {s === "done"
              ? <i className="ri-checkbox-circle-line" />
              : s === "active"
              ? <i className="ri-loader-4-line" />
              : <i className="ri-circle-line" />}
            <span>{item.text}</span>
            {s === "pending" && <i className="ri-draggable reply-todo-grip" />}
          </div>
        );
      })}
    </div>
  );
}

/* ---- markdown ---- */
function MarkdownBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const text = block.text || block.content || "";
  return (
    <div className="reply-md">
      <Markdown text={text} people={ctx.people} />
    </div>
  );
}

/* ---- code ---- */
function CodeBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const [copied, setCopied] = useState(false);
  const diff = Array.isArray(block.diff) && block.diff.length > 0 ? (block.diff as DiffLine[]) : null;
  const code = block.text || block.content || "";
  const lang = block.lang || "";
  const filename = block.name || block.title || "";

  function handleCopy() {
    const text = diff ? diff.map((l) => l.text).join("\n") : code;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  }

  const onApply = ctx?.onApply;

  // When the block carries diff lines → render the dark code-card with diff view
  if (diff) {
    return (
      <div className="reply-code-card">
        <div className="reply-code-card-head">
          <i className="ri-file-code-line reply-code-card-file-icon" />
          {filename && <span className="reply-code-card-filename">{filename}</span>}
          {lang && <span className="reply-code-card-lang">{lang}</span>}
          <span className="reply-code-card-sp" />
          <button type="button" className="reply-code-card-copy" onClick={handleCopy}>
            <i className={copied ? "ri-check-line" : "ri-file-copy-line"} />
            {copied ? "Copied" : "Copy"}
          </button>
          {onApply ? (
            <button type="button" className="reply-code-card-apply" onClick={() => onApply(block)}>Apply</button>
          ) : (
            <button type="button" className="reply-code-card-apply" disabled aria-disabled="true">Apply</button>
          )}
        </div>
        <div className="reply-code-card-lines">
          {diff.map((line, i) => (
            <div
              key={i}
              className={`reply-code-line${line.sign === "+" ? " added" : line.sign === "-" ? " removed" : ""}`}
            >
              <span className="reply-code-ln">{line.n}</span>
              <span className={`reply-code-sign${line.sign === "+" ? " plus" : line.sign === "-" ? " minus" : ""}`}>{line.sign}</span>
              <span className="reply-code-text">{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // No diff — keep existing highlighted fenced-code rendering via shared Markdown; optionally
  // show a header row when the block has a filename or lang label.
  const fence = "```" + (lang || "") + "\n" + code + "\n```";
  if (filename || lang) {
    return (
      <div className="reply-code">
        <div className="reply-code-card-head reply-code-card-head--light">
          <i className="ri-file-code-line reply-code-card-file-icon--light" />
          {filename && <span className="reply-code-card-filename--light">{filename}</span>}
          {lang && <span className="reply-code-card-lang--light">{lang}</span>}
          <span className="reply-code-card-sp" />
          <button type="button" className="reply-code-copy-btn" onClick={handleCopy}>
            <i className={copied ? "ri-check-line" : "ri-file-copy-line"} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="reply-md reply-code-plain">
          <Markdown text={fence} />
        </div>
      </div>
    );
  }

  return (
    <div className="reply-code">
      <div className="reply-md">
        <Markdown text={fence} />
      </div>
    </div>
  );
}

/* ---- action_card ---- */
function ActionCardBlock({ block }: { block: Block }) {
  const title = block.action_title || block.title || "";
  const target = block.action_target || block.summary || "";
  const icon = block.action_icon || "ri-flashlight-line";
  const details: string[] = Array.isArray(block.details) ? block.details : [];

  return (
    <div className="reply-action-card">
      <div className="reply-ac-icon"><i className={icon} /></div>
      <div className="reply-ac-t">
        <b>{title}</b>
        {target && <span>{target}</span>}
        {details.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
            {details.map((d, i) => (
              <span key={i} className="small" style={{ color: "var(--ink-2)" }}>{d}</span>
            ))}
          </div>
        )}
        {block.url && (
          <div className="reply-ac-acts">
            <a className="btn sm" href={String(block.url)} target="_blank" rel="noopener noreferrer">
              <i className="ri-external-link-line" />Open
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- confirmation ---- */
function ConfirmationBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const [state, setState] = useState<"pending" | "done" | "cancelled">(block.done ? "done" : "pending");
  const [busy, setBusy] = useState(false);
  const title = block.title || block.action_title || "";
  const body = block.text || block.content || block.summary || "";
  const isDone = state === "done";

  const confirm = async (decision: "approve" | "deny") => {
    setBusy(true);
    try {
      if (block.proposal_id && ctx.onProposal) {
        await ctx.onProposal(String(block.proposal_id), decision === "approve" ? "approve" : "reject", "");
      } else if (block.request_id && ctx.onDecide) {
        await ctx.onDecide(String(block.request_id), decision === "approve" ? "once" : "deny", "");
      }
      setState(decision === "approve" ? "done" : "cancelled");
    } finally { setBusy(false); }
  };

  return (
    <div className={`reply-confirm ${isDone || state === "cancelled" ? "done" : ""}`}>
      <div className="reply-confirm-head">
        {isDone ? <i className="ri-checkbox-circle-fill" /> : state === "cancelled" ? <i className="ri-close-circle-line" /> : <i className="ri-send-plane-line" />}
        <span>{title}</span>
      </div>
      {body && <div className="reply-confirm-body">{body}</div>}
      {state === "pending" && (
        <div className="reply-confirm-acts">
          <button className="btn sm primary" type="button" disabled={busy} onClick={() => confirm("approve")}>Confirm</button>
          <button className="btn sm quiet" type="button" disabled={busy} onClick={() => confirm("deny")}>Cancel</button>
        </div>
      )}
      {isDone && <div className="small" style={{ color: "var(--ok)", fontWeight: 500 }}>Done</div>}
      {state === "cancelled" && <div className="small" style={{ color: "var(--bad)", fontWeight: 500 }}>Cancelled</div>}
    </div>
  );
}

/* ---- streaming_approval ---- */
function StreamingApprovalBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const [decided, setDecided] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const intro = block.text || block.content || "";
  const pauseLabel = block.pause_label || "Paused, waiting for you";
  const pauseStep = block.pause_step || "";
  const pauseQuote = block.pause_quote || "";
  const stepsLeft = block.pause_steps_left || "";

  const decide = async (decision: "approve" | "reject" | "changes", note = "") => {
    setBusy(true);
    try {
      if (block.proposal_id) await ctx.onProposal?.(String(block.proposal_id), decision, note);
      setDecided(decision);
    } finally { setBusy(false); }
  };

  return (
    <div className="reply-approval">
      {intro && <div className="reply-approval-body">{intro}</div>}
      <div className="reply-approval-head">
        <i className="ri-pause-circle-line" />
        <span>{pauseLabel}</span>
        {pauseStep && <span className="small" style={{ marginLeft: "auto" }}>{pauseStep}</span>}
      </div>
      {pauseQuote && (
        <div style={{ padding: "8px 10px", background: "var(--soft)", borderRadius: "var(--r-sm)", fontStyle: "italic", fontSize: 13, color: "var(--ink-2)" }}>
          &ldquo;{pauseQuote}&rdquo;
        </div>
      )}
      {!decided ? (
        <div className="reply-approval-acts">
          <button className="btn sm primary" type="button" disabled={busy} onClick={() => decide("approve")}>Looks right, continue</button>
          <button className="btn sm" type="button" disabled={busy} onClick={() => decide("changes")}>Change something</button>
          <button className="btn sm quiet" type="button" disabled={busy} onClick={() => decide("reject")}>Skip this step</button>
        </div>
      ) : (
        <div className="small" style={{ color: decided === "approve" ? "var(--ok)" : "var(--muted)", fontWeight: 500 }}>
          {decided === "approve" ? "Continuing…" : decided === "changes" ? "Noted, changing…" : "Step skipped"}
        </div>
      )}
      {stepsLeft && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
          <i className="ri-list-check-3" />{stepsLeft}
        </div>
      )}
    </div>
  );
}

/* ---- task ---- */
function TaskBlock({ block }: { block: Block }) {
  const title = block.task_title || block.title || "";
  const status = block.task_status || block.status || "pending";
  const stepsDone = block.task_steps_done ?? 0;
  const stepsTotal = block.task_steps_total ?? 0;
  const staffName = block.task_staff || "";
  const taskId = block.task_id || block.id || "";
  const pct = stepsTotal > 0 ? Math.round((stepsDone / stepsTotal) * 100) : 0;

  const dotClass = status === "running" ? "running" : status === "done" ? "done" : status === "failed" ? "failed" : "";
  const statusLabel = status === "running" ? "In progress" : status === "done" ? "Done" : status === "failed" ? "Failed" : "Pending";

  return (
    <a className="reply-task" href={taskId ? `/jobs/${taskId}` : undefined} target={taskId ? "_blank" : undefined} rel="noopener noreferrer">
      <div className={`reply-task-dot ${dotClass}`} />
      <div className="reply-task-t">
        <b>{title}</b>
        <span>
          {staffName && <>{staffName} · </>}{statusLabel}
          {stepsTotal > 0 && <> · {stepsDone}/{stepsTotal} steps</>}
        </span>
        {stepsTotal > 0 && (
          <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: "var(--line-strong)", overflow: "hidden" }}>
            <i style={{ display: "block", height: "100%", background: "var(--info)", borderRadius: 2, width: `${pct}%` }} />
          </div>
        )}
      </div>
      <i className="ri-arrow-right-s-line" style={{ color: "var(--faint)", flexShrink: 0 }} />
    </a>
  );
}

/* ---- sources ---- */
function SourcesBlock({ block }: { block: Block }) {
  const [expanded, setExpanded] = useState(false);
  const sources: SourceItem[] = block.sources || [];
  if (!sources.length) return null;

  return (
    <div className="reply-sources-wrap">
      <div className="reply-sources-pills">
        <span className="reply-sources-label">Sources</span>
        {sources.map((s, i) => (
          <button key={i} type="button" className="reply-source-pill" onClick={() => setExpanded(!expanded)} title={s.title || ""}>
            <span className="reply-source-pill-n">{s.n ?? i + 1}</span>
            {s.title && <span className="reply-source-pill-txt">{s.title}</span>}
          </button>
        ))}
      </div>
      {expanded && (
        <div className="reply-sources-list">
          {sources.map((s, i) => (
            <a key={i} className={`reply-sources-row${i > 0 ? " bordered" : ""}`}
              href={s.url || "#"} target={s.url ? "_blank" : undefined} rel="noopener noreferrer">
              <span className="reply-sources-n">{s.n ?? i + 1}</span>
              <i className={s.icon || "ri-file-text-line"} />
              <div className="reply-sources-t">
                <b>{s.title || "Source"}</b>
                {s.subtitle && <span>{s.subtitle}</span>}
              </div>
              <i className="ri-arrow-right-up-line reply-sources-arrow" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- usage_meter ---- */
function UsageMeterBlock({ block }: { block: Block }) {
  const tokIn = block.tokens_in ?? 0;
  const tokOut = block.tokens_out ?? 0;
  const cost = block.cost_usd;
  const dur = block.duration_s;
  const pct = block.budget_pct != null ? Math.min(100, block.budget_pct) : null;
  const account = block.account || "";

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const hasTok = tokIn > 0 || tokOut > 0;

  return (
    <div className="reply-usage">
      {/* Account: green dot + "Claude Code pool · cloud" */}
      {account && (
        <>
          <span className="reply-usage-account">
            <span className="reply-usage-dot" aria-hidden="true" />
            {account}
          </span>
          <span className="reply-usage-sep" aria-hidden="true">·</span>
        </>
      )}
      {/* Tokens: "1.2k in / 860 out" */}
      {hasTok && <span>{fmt(tokIn)} in / {fmt(tokOut)} out</span>}
      {/* Cost */}
      {cost != null && <><span className="reply-usage-sep" aria-hidden="true">·</span><span>${cost.toFixed(4)}</span></>}
      {/* Duration */}
      {dur != null && <><span className="reply-usage-sep" aria-hidden="true">·</span><span>{dur.toFixed(1)}s</span></>}
      {/* Spacer + "of today" + track */}
      {pct != null && pct > 0 && (
        <>
          <span className="sp" />
          <span className="reply-usage-today">of today</span>
          <div className="reply-usage-track">
            <i style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---- document ---- */
function DocumentBlock({ block }: { block: Block }) {
  const title = block.title || block.name || "Document";
  const meta = block.summary
    ? (block.mime ? block.mime.replace(/^application\//, "") + " · " : "") + (block.text ? block.text.slice(0, 80) : "")
    : (block.text || "");
  const snippet = block.summary || block.text || "";
  const url = block.url || (block.id ? fileUrl(String(block.id)) : null);
  // Chip label — derive from mime or kind
  const chipLabel = block.kind || (block.mime ? (block.mime.includes("pdf") ? "PDF" : block.mime.includes("markdown") ? "Markdown" : "Docs") : "Docs");

  const open = () => url && window.open(url, "_blank", "noopener");

  return (
    <div className="reply-document">
      {/* Peek thumbnail */}
      <div className="reply-document-peek" aria-hidden="true">
        <span className="reply-document-peek-title">{title}</span>
        <span className="reply-document-peek-line" />
        <span className="reply-document-peek-line" />
        <span className="reply-document-peek-line" />
        <span className="reply-document-peek-line" />
        <span className="reply-document-peek-line" />
        <span className="reply-document-peek-line" />
        <span className="reply-document-peek-line" />
      </div>
      {/* Right column */}
      <div className="reply-document-body">
        <div className="reply-document-top">
          <span className="reply-document-title">{title}</span>
          <span className="chip quiet reply-document-chip">{chipLabel}</span>
        </div>
        {meta && <span className="reply-document-meta">{meta}</span>}
        {snippet && <span className="reply-document-snippet">{snippet}</span>}
        <div className="reply-document-acts">
          <button type="button" className="btn sm" onClick={open}
            onKeyDown={(e) => e.key === "Enter" && open()}>
            <i className="ri-file-text-line" />Open in Docs
          </button>
          {url && (
            <a className="btn sm quiet" href={url} download aria-label="Download">
              <i className="ri-download-line" />Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- image ---- */
function ImageBlock({ block }: { block: Block }) {
  const isGenerating = block.generating;
  const progress = block.progress;
  const prompt = block.prompt || block.title || "";
  const url = block.url || (block.id ? fileUrl(String(block.id)) : null);
  const name = block.name || block.title || "image";

  if (isGenerating) {
    return (
      <div className="reply-image generating">
        <i className="ri-image-line" style={{ fontSize: 20 }} />
        <span>{block.text || block.title || "Generating…"}{progress != null ? ` ${progress}%` : ""}</span>
      </div>
    );
  }

  if (!url) return null;
  return (
    <div className="reply-image">
      <img src={url} alt={prompt || name} loading="lazy" style={{ display: "block", maxWidth: "min(100%, 480px)", maxHeight: 340, objectFit: "cover" }} />
    </div>
  );
}

/* ---- streaming ---- */
function StreamingBlock({ block }: { block: Block }) {
  const text = block.text || block.content || "";
  return <div className="reply-streaming">{text}</div>;
}

/* ---- mentions (inline chip display, not a block per se — render as fallback markdown) ---- */
function MentionsBlock({ block, ctx }: { block: Block; ctx: BlockCtx }) {
  const text = block.text || block.content || "";
  if (!text) return null;
  return (
    <div className="reply-md">
      <Markdown text={text} people={ctx.people} />
    </div>
  );
}

/* ================================================================== Main switch */

/**
 * renderBlock(block, ctx) — render any block type safely.
 *
 * Returns a React element. The `default:` branch renders the block's text/content as markdown
 * so an unknown or future block type never crashes the UI.
 */
export function renderBlock(block: Block, ctx: BlockCtx): React.ReactElement {
  switch (block.type) {
    /* ---------- legacy preserved types ---------- */
    case "choices":
      return <ChoicesBlock key={block.id || block.type} block={block} ctx={ctx} />;
    case "access_request":
      return <AccessRequestBlock key={block.request_id || block.type} block={block} ctx={ctx} />;
    case "job_proposal":
      return <JobProposalBlock key={block.type} block={block} ctx={ctx} />;
    case "question":
      return <QuestionBlock key={block.item_id || block.type} block={block} ctx={ctx} />;
    case "proposal":
      return <ProposalBlock key={block.proposal_id || block.type} block={block} ctx={ctx} />;
    case "file":
      return <FileBlock key={block.id || block.type} block={block} />;
    case "mentions":
      return <MentionsBlock key={block.type} block={block} ctx={ctx} />;

    /* ---------- v2 new types ---------- */
    case "reasoning":
      return <ReasoningBlock key={block.type} block={block} />;
    case "todos":
      return <TodosBlock key={block.type} block={block} />;
    case "markdown":
      return <MarkdownBlock key={block.type} block={block} ctx={ctx} />;
    case "code":
      return <CodeBlock key={block.type} block={block} ctx={ctx} />;
    case "action_card":
      return <ActionCardBlock key={block.type} block={block} />;
    case "confirmation":
      return <ConfirmationBlock key={block.id || block.type} block={block} ctx={ctx} />;
    case "streaming_approval":
      return <StreamingApprovalBlock key={block.type} block={block} ctx={ctx} />;
    case "task":
      return <TaskBlock key={block.task_id || block.type} block={block} />;
    case "sources":
      return <SourcesBlock key={block.type} block={block} />;
    case "usage_meter":
      return <UsageMeterBlock key={block.type} block={block} />;
    case "document":
      return <DocumentBlock key={block.id || block.name || block.type} block={block} />;
    case "image":
      return <ImageBlock key={block.id || block.url || block.type} block={block} />;
    case "streaming":
      return <StreamingBlock key={block.type} block={block} />;

    default: {
      /* SAFE FALLBACK — render any unknown/future block as text/markdown.
         Never crashes: if there's no text content at all, returns an empty fragment. */
      const fallbackText = block.text || block.content || block.title || block.summary || "";
      if (!fallbackText) return <React.Fragment key={block.type} />;
      return (
        <div key={block.type} className="reply-md">
          <Markdown text={fallbackText} people={ctx.people} />
        </div>
      );
    }
  }
}

/**
 * renderBlocks(blocks, ctx) — convenience: render an array of blocks into a stack.
 * Skips null/undefined entries and file blocks that are already handled by <Attachments>.
 */
export function renderBlocks(blocks: Block[] | undefined, ctx: BlockCtx): React.ReactElement[] {
  if (!blocks || !blocks.length) return [];
  return blocks
    .filter((b): b is Block => !!b)
    .map((b, i) => {
      const el = renderBlock(b, ctx);
      // always use index-based key so same-type blocks within one message never clash
      return React.cloneElement(el, { key: `block-${i}` });
    });
}
