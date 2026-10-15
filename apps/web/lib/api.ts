export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method || (opts.body !== undefined ? "POST" : "GET");
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(method !== "GET" ? { "X-Saga": "1" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j);
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export type Staff = {
  id: string; name: string; role: string; is_chief: boolean; job: string; engine: Record<string, any>;
  permissions: Record<string, any>; status: string; has_mcp_token: boolean; max_task_minutes: number; budget_usd_month: number;
  shifts: Shift[]; effective_permissions?: Record<string, string>; recent_tasks?: Task[]; mcp?: { url: string };
};
export type Shift = { id: string; staff_id: string; name: string; cron: string; when?: string; brief: string; enabled: boolean; next_at: string | null; last_at: string | null };
export type Report = { headline: string; body_md: string; kpis: Record<string, number>; at: string };
export type Task = {
  id: string; staff_id: string; origin: string; brief: string; founder_note: string; status: string; parent_task_id: string | null;
  proposal_id: string | null; created_at: string; started_at: string | null; ended_at: string | null; cost_usd: number;
  error: string; attempts: number; engine_type: string; report?: Report;
  checkpoints?: { plan: string[]; done: string; next: string; notes: string; at: string }[];
  proposals?: Proposal[]; children?: Task[]; tool_calls?: { at: string; tool: string; decision: string; ms: number }[];
};
export type Proposal = {
  id: string; task_id: string | null; staff_id: string; type: string; risk: string; title: string; status: string;
  current_revision: number; decision_note: string; body_md: string; execution_task_id: string | null; result: string;
  created_at: string; revisions?: { n: number; body_md: string; author: string; summary: string; at: string }[];
};
export type InboxItem = {
  id: string; kind: "proposal" | "question" | "alert"; ref_id: string | null; staff_id: string | null; task_id: string | null;
  title: string; body: string; level: string; blocking: boolean; status: string; created_at: string; proposal?: Proposal;
};
export type Message = { id: string; role: string; author: string; text: string; at: string };
export type Thread = { id: string; scope: string; ref_id: string | null; staff_id: string; title: string; awaiting_reply: boolean; messages?: Message[] };
export type Overview = {
  company_name: string; paused: boolean; strict_mode: boolean; max_concurrent_tasks: number;
  inbox: { open: number; critical: number; blocking: number };
  tasks: { running: number; queued: number; done_24h: number; failed_24h: number };
  staff: { id: string; name: string; status: string; is_chief: boolean; running: number }[];
  kpis: Record<string, { value: number; period: string; source: string; at: string }>;
  cost_7d_usd: number;
};

export function ago(iso?: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) { const f = -s; return f < 3600 ? `in ${Math.round(f / 60)}m` : f < 86400 ? `in ${Math.round(f / 3600)}h` : `in ${Math.round(f / 86400)}d`; }
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
}

export function when(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}
