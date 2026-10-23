"use client";
/* Remembers the last workspace grouping so By-helper / By-goal sticks across navigation and
   reloads instead of silently resetting to By-helper every time. */

const GROUP = "omilo.ws.group";

export function saveWsGroup(g: "helper" | "goal"): void {
  try { localStorage.setItem(GROUP, g); } catch { /* private mode */ }
}

export function wsGroup(): "helper" | "goal" {
  try { return localStorage.getItem(GROUP) === "goal" ? "goal" : "helper"; } catch { return "helper"; }
}

/** The team-board URL honoring the last-used grouping. */
export function boardHref(): string {
  return `/chat/?view=board&group=${wsGroup()}`;
}
