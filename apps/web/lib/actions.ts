"use client";
import { api } from "@/lib/api";
import type { MenuItem } from "@/lib/menu";
import { copy, sep } from "@/lib/menu";
import { openTask, openThread } from "@/lib/open";
import { kick } from "@/lib/poll";

/* The same actions for the same things, wherever they are right-clicked. */

type H = { id: string; name?: string; is_chief?: boolean; status?: string };
type T = { id: string; staff_id: string; brief: string; status: string };

export async function chatWith(h: H) {
  const th = await api<{ id: string }>("/threads", { body: h.is_chief ? { scope: "master" } : { scope: "staff", staff_id: h.id } });
  openThread(th.id);
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
      : { label: `Resume ${name}`, icon: "ri-play-circle-line", onSelect: async () => { await api(`/staff/${h.id}`, { method: "PATCH", body: { status: "active" } }); after?.(); } }),
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
      ? { label: "Stop the job", icon: "ri-stop-circle-line", danger: true, onSelect: async () => { if (!confirm("Stop this job?")) return; await api(`/tasks/${t.id}/cancel`, { body: {} }); after?.(); } }
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
