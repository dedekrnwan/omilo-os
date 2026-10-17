"use client";
import { api } from "@/lib/api";
import type { MenuItem } from "@/lib/menu";
import { copy, sep } from "@/lib/menu";
import { openTask, openThread } from "@/lib/open";
import { kick } from "@/lib/poll";
import { alertDialog, confirmDialog } from "@/lib/dialog";

/* The same actions for the same things, wherever they are right-clicked. */

type H = { id: string; name?: string; is_chief?: boolean; status?: string };
type T = { id: string; staff_id: string; brief: string; status: string };

export async function chatWith(h: H) {
  const th = await api<{ id: string }>("/threads", { body: h.is_chief ? { scope: "master" } : { scope: "staff", staff_id: h.id } });
  openThread(th.id);
}

/** Let a helper go (asks first, with the helper looking sad). Its past work stays; you can hire it back. */
export async function letGo(h: H, after?: () => void): Promise<boolean> {
  const name = h.name || h.id;
  if (h.is_chief) return false;
  const ok = await confirmDialog({
    title: `Let ${name} go?`, who: h, danger: true,
    confirm: name.length <= 12 ? `Let ${name} go` : "Let go", cancel: name.length <= 12 ? `Keep ${name}` : "Keep",
    body: <>
      {name} leaves your team:
      <ul>
        <li>Its queued and running jobs are cancelled, and its regular jobs stop.</li>
        <li>Its open drafts and questions in your Inbox are closed.</li>
        <li>Its past jobs, reports and docs stay in your history.</li>
      </ul>
      You can hire {name} back later from the Team page.
    </>,
  });
  if (!ok) return false;
  try { await api(`/staff/${h.id}`, { method: "DELETE" }); }
  catch (e: any) { await alertDialog({ title: `Couldn't let ${name} go`, body: e.message, who: h, mood: "worried" }); return false; }
  after?.();
  return true;
}

/** Hire back a helper you let go. */
export async function hireBack(h: H, after?: () => void): Promise<boolean> {
  const name = h.name || h.id;
  if (!(await confirmDialog({ title: `Hire ${name} back?`, body: `${name} rejoins with the same job, look and history. Its regular jobs need setting up again.`, confirm: name.length <= 12 ? `Hire ${name} back` : "Hire back", who: h, mood: "happy" }))) return false;
  await api(`/staff/${h.id}/rehire`, { body: {} });
  after?.();
  return true;
}

export function helperItems(h: H, after?: () => void): MenuItem[] {
  const name = h.name || h.id;
  return [
    { label: `Chat with ${name}`, icon: "ri-chat-3-line", onSelect: () => chatWith(h) },
    { label: `Open ${name}'s page`, icon: "ri-user-3-line", href: `/staff/?id=${h.id}` },
    { label: "Budget", icon: "ri-wallet-3-line", href: `/staff/?id=${h.id}#budget` },
    { label: "Change look", icon: "ri-palette-line", href: `/staff/?id=${h.id}#look` },
    h.status && (h.status === "active"
      ? { label: `Pause ${name}`, icon: "ri-pause-circle-line", onSelect: async () => { await api(`/staff/${h.id}`, { method: "PATCH", body: { status: "paused" } }); after?.(); } }
      : h.status === "paused" ? { label: `Resume ${name}`, icon: "ri-play-circle-line", onSelect: async () => { await api(`/staff/${h.id}`, { method: "PATCH", body: { status: "active" } }); after?.(); } } : null),
    !h.is_chief && h.status !== "retired" && sep,
    !h.is_chief && h.status !== "retired" && { label: `Let ${name} go…`, icon: "ri-user-unfollow-line", danger: true, onSelect: () => letGo(h, after) },
  ].filter(Boolean) as MenuItem[];
}

export function taskItems(t: T, staffName?: string, after?: () => void, open?: () => void): MenuItem[] {
  const live = ["queued", "running"].includes(t.status);
  return [
    { heading: t.brief.split("\n")[0].slice(0, 60) },
    { label: "Open", icon: "ri-file-list-3-line", onSelect: () => (open ? open() : openTask(t.id)) },
    { label: "Chat about this job", icon: "ri-chat-3-line", onSelect: () => openTask(t.id, "chat") },
    { label: "What needs me", icon: "ri-checkbox-multiple-line", onSelect: () => openTask(t.id, "approvals") },
    { label: "Full view", icon: "ri-external-link-line", href: `/chat/?view=work&task=${t.id}&full=1` },
    sep,
    live
      ? { label: "Stop the job", icon: "ri-stop-circle-line", danger: true, onSelect: async () => { if (!(await confirmDialog({ title: "Stop this job?", body: "The helper stops after its current step. What it already did stays.", confirm: "Stop the job", cancel: "Let it finish", danger: true, who: { id: t.staff_id, name: staffName } }))) return; await api(`/tasks/${t.id}/cancel`, { body: {} }); after?.(); } }
      : { label: "Run it again", icon: "ri-restart-line", onSelect: async () => { const n = await api<{ id: string }>("/tasks", { body: { staff_id: t.staff_id, brief: t.brief } }); kick(n.id); openTask(n.id); after?.(); } },
    { label: "Copy the brief", icon: "ri-file-copy-line", onSelect: () => copy(t.brief) },
    sep,
    { heading: staffName || t.staff_id },
    ...helperItems({ id: t.staff_id, name: staffName }),
  ];
}

/** A job we only know by id and brief (links in Monitor, notifications, reports). */
export function jobLinkItems(id: string, brief: string): MenuItem[] {
  return [
    { heading: brief.split("\n")[0].slice(0, 60) },
    { label: "Open", icon: "ri-file-list-3-line", onSelect: () => openTask(id) },
    { label: "Chat about this job", icon: "ri-chat-3-line", onSelect: () => openTask(id, "chat") },
    { label: "Full view", icon: "ri-external-link-line", href: `/chat/?view=work&task=${id}&full=1` },
    sep,
    { label: "Copy the brief", icon: "ri-file-copy-line", onSelect: () => copy(brief) },
  ];
}
