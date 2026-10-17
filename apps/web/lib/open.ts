"use client";
import { BASE } from "@/lib/api";

/* Open a job or a chat in a drawer, from anywhere, instead of navigating away. */

export const openTask = (id: string, tab?: "progress" | "chat" | "approvals") => window.dispatchEvent(new CustomEvent("omilo:task", { detail: { id, tab } }));
export const openThread = (id: string, title?: string) => window.dispatchEvent(new CustomEvent("omilo:thread", { detail: { id, title } }));

const TASK_URL = /^\/chat\/\?(?:.*&)?view=work&(?:.*&)?task=(tsk_[0-9a-f]+)|^\/chat\/\?(?:.*&)?task=(tsk_[0-9a-f]+)(?:&.*)?$/;
const THREAD_URL = /^\/chat\/\?thread=(thr_[0-9a-f]+)$/;

/** If the URL is a job or a chat, open it in a drawer and return true; otherwise false (navigate normally). */
export function openInDrawer(url: string): boolean {
  if (typeof window !== "undefined" && window.location.pathname.startsWith(`${BASE}/chat/`)) return false; // the Workspace shows them itself
  let u = url.replace(/^https?:\/\/[^/]+/, "");
  if (BASE && u.startsWith(BASE)) u = u.slice(BASE.length);
  if (/[?&]full=1/.test(u)) return false; // explicitly asked for the full page
  const t = TASK_URL.exec(u);
  if (t) { openTask(t[1] || t[2]); return true; }
  const th = THREAD_URL.exec(u);
  if (th) { openThread(th[1]); return true; }
  return false;
}

/** Chats on screen right now (drawers register theirs), so a reply there does not also pop up as a notice. */
export const visibleThreads = new Set<string>();
