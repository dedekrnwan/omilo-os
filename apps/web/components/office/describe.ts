import type { OfficeEvent } from "@/lib/office";

/** One line for a verified office event, for the activity ticker and the inspector. */
export function describe(e: OfficeEvent, nameOf: (id: string) => string): { icon: string; text: string; tone: "info" | "good" | "warn" | "bad" | "quiet" } {
  const d = e.data || {};
  const who = nameOf(e.staff_id);
  const b = (s?: string) => (s ? `: ${s}` : "");
  switch (e.kind) {
    case "job.queued": return { icon: "ri-inbox-archive-line", text: `${who} has a new job${d.from_staff ? ` from ${nameOf(d.from_staff)}` : ""}${b(d.brief)}`, tone: "quiet" };
    case "job.started": return { icon: "ri-play-circle-line", text: `${who} started${b(d.brief)}`, tone: "info" };
    case "job.done": return { icon: "ri-checkbox-circle-line", text: `${who} finished${b(d.brief)}`, tone: "good" };
    case "job.failed": return { icon: "ri-close-circle-line", text: `${who}'s job failed${b(d.error || d.brief)}`, tone: "bad" };
    case "job.cancelled": return { icon: "ri-forbid-line", text: `${who}'s job was cancelled`, tone: "quiet" };
    case "tool":
      if (d.phase === "start") return { icon: "ri-tools-line", text: `${who} is using ${d.name}`, tone: "quiet" };
      return { icon: d.ok === false ? "ri-error-warning-line" : "ri-tools-line", text: `${who} used ${d.name}${d.ok === false ? " (failed)" : d.decision && d.decision !== "allowed" ? ` (${d.decision})` : ""}`, tone: d.ok === false ? "bad" : "quiet" };
    case "handoff": return { icon: "ri-share-forward-line", text: `${who} handed a job to ${nameOf(d.to_staff)}${b(d.brief)}`, tone: "info" };
    case "approval.requested": return { icon: "ri-checkbox-circle-line", text: `${who} asks your approval${b(d.title)}`, tone: "warn" };
    case "approval.decided": return { icon: d.decision === "approved" ? "ri-thumb-up-line" : "ri-thumb-down-line", text: `You ${d.decision === "approved" ? "approved" : d.decision === "rejected" ? "rejected" : "asked changes to"} ${who}'s proposal${b(d.title)}`, tone: d.decision === "approved" ? "good" : "warn" };
    case "question.asked": return { icon: "ri-question-line", text: `${who} asks you${b(d.title)}`, tone: "warn" };
    case "question.answered": return { icon: "ri-chat-check-line", text: `You answered ${who}`, tone: "good" };
    case "chat.started": return { icon: "ri-chat-3-line", text: `${who} is replying in chat`, tone: "info" };
    case "chat.replied": return { icon: "ri-chat-check-line", text: `${who} replied in chat`, tone: "good" };
    case "engine": return { icon: "ri-restart-line", text: `${who}: ${d.state === "retrying" ? "retrying after a network error" : "switching Claude account"}${b(d.reason)}`, tone: "warn" };
    case "agent.paused": return { icon: "ri-pause-line", text: `${who} was paused`, tone: "quiet" };
    case "agent.resumed": return { icon: "ri-play-line", text: `${who} was resumed`, tone: "good" };
    default: return { icon: "ri-pulse-line", text: `${who}: ${e.kind}`, tone: "quiet" };
  }
}
