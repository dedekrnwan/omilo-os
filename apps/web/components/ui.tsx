"use client";

const STATUS: Record<string, [string, string]> = {
  done: ["up", "✓ Done"], running: ["run", "● Running"], queued: ["idle", "○ Queued"], failed: ["down", "✕ Failed"],
  cancelled: ["idle", "– Cancelled"], pending: ["warn", "! Pending"], approved: ["run", "✓ Approved"], executing: ["run", "● Executing"],
  rejected: ["down", "✕ Rejected"], changes_requested: ["warn", "↺ Changes asked"], active: ["up", "✓ Active"], paused: ["warn", "❚❚ Paused"],
  draft: ["idle", "Draft"], waiting: ["warn", "◷ Waiting"], skipped: ["idle", "Skipped"],
};

export function StatusChip({ status }: { status: string }) {
  const [k, l] = STATUS[status] || ["idle", status];
  return <span className={`chip ${k}`}>{l}</span>;
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><b>{title}</b><span>{text}</span></div>;
}

export function Err({ error }: { error: string | null }) {
  return error ? <div className="error">{error}</div> : null;
}
