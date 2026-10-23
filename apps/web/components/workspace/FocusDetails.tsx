"use client";
import { useEffect, useState } from "react";
import { GoalFocus, api } from "@/lib/api";

/* Shape returned by GET /api/threads/{id}/focus */
interface FocusStep {
  label: string;
  status: "done" | "active" | "pending";
}

interface FocusFile {
  title: string;
  kind?: string; /* "pr" | "file" | "chart" | etc. */
  ref?: string;
  url?: string;
}

interface FocusCost {
  usd: number;
  tokens: number;
  minutes: number;
}

interface FocusData {
  progress?: FocusStep[];
  files?: FocusFile[];
  cost?: FocusCost;
  /** Present when the thread is a goal thread (scope=="goal") */
  goal?: GoalFocus;
}

/* Initials for a staff avatar fallback (we only have id/name here) */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fileIcon(kind?: string): string {
  if (kind === "pr") return "ri-git-branch-line";
  if (kind === "chart") return "ri-bar-chart-line";
  if (kind === "image") return "ri-image-line";
  if (kind === "notes" || kind === "doc") return "ri-file-text-line";
  return "ri-file-text-line";
}

function stepIcon(status: FocusStep["status"]): string {
  if (status === "done") return "ri-checkbox-circle-fill";
  if (status === "active") return "ri-record-circle-line";
  return "ri-circle-line";
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export default function FocusDetails({
  threadId,
  onClose,
}: {
  threadId: string;
  onClose?: () => void;
}) {
  const [data, setData] = useState<FocusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!threadId) return;
    setLoading(true);
    api<FocusData>(`/threads/${threadId}/focus`)
      .then(setData)
      .catch(() => setData({}))
      .finally(() => setLoading(false));
  }, [threadId]);

  const goal = data?.goal;

  const hasProgress = (data?.progress?.length ?? 0) > 0;
  const hasFiles = (data?.files?.length ?? 0) > 0;
  const hasCost =
    data?.cost &&
    (data.cost.usd > 0 || data.cost.tokens > 0 || data.cost.minutes > 0);

  const isEmpty = !hasProgress && !hasFiles && !hasCost;

  return (
    <div className="focus-details">
      <div className="focus-details-head">
        <b>Details</b>
        <span className="sp" />
        {onClose && (
          <button
            className="iconbtn"
            aria-label="Close details"
            onClick={onClose}
          >
            <i className="ri-close-line" />
          </button>
        )}
      </div>

      <div className="focus-details-body">
        {loading && (
          <p className="small" style={{ color: "var(--muted)" }}>
            Loading…
          </p>
        )}

        {/* GOAL THREAD VIEW */}
        {!loading && goal && (
          <>
            {/* PROGRESS */}
            <div className="focus-section">
              <div className="focus-section-label">Progress</div>
              <div className="goal-side-progress">
                {goal.progress.percent !== null ? (
                  <>
                    <div className="goal-side-big">{goal.progress.percent}%</div>
                    {goal.progress.target_label && (
                      <div className="goal-side-of">of {goal.progress.target_label} target</div>
                    )}
                    <div className="goal-side-track" aria-hidden>
                      <div
                        className="goal-side-fill"
                        style={{ width: `${Math.max(0, Math.min(100, goal.progress.percent))}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="goal-side-of">No measured progress yet</div>
                )}
                {goal.progress.note && (
                  <div className="goal-side-note">{goal.progress.note}</div>
                )}
              </div>
            </div>

            {/* WORK FOR THIS GOAL */}
            {goal.work.length > 0 && (
              <div className="focus-section">
                <div className="focus-section-label">Work for this goal</div>
                <div className="goal-side-work">
                  {goal.work.map((w) => (
                    <div key={w.id} className="goal-side-work-row">
                      <span className="goal-side-av" title={w.staff.name}>
                        {initials(w.staff.name)}
                      </span>
                      <div className="goal-side-work-text">
                        <span className="goal-side-work-title">{w.title}</span>
                        <span className="goal-side-work-sub">{w.status_label}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {goal.done_this_week > 0 && (
                  <div className="goal-side-done">
                    <i className="ri-check-line" /> {goal.done_this_week} done this week
                  </div>
                )}
              </div>
            )}

            {/* ABOUT THIS GOAL */}
            <div className="focus-section">
              <div className="focus-section-label">About this goal</div>
              <div className="goal-side-about">
                {goal.about.owner && (
                  <div className="goal-side-row">
                    <span className="goal-side-k">Owner</span>
                    <span className="goal-side-v">{goal.about.owner}</span>
                  </div>
                )}
                {goal.about.measured && (
                  <div className="goal-side-row">
                    <span className="goal-side-k">Measured</span>
                    <span className="goal-side-v">{goal.about.measured}</span>
                  </div>
                )}
                {goal.about.check_in && (
                  <div className="goal-side-row">
                    <span className="goal-side-k">Check-in</span>
                    <span className="goal-side-v">{goal.about.check_in}</span>
                  </div>
                )}
                {goal.about.since && (
                  <div className="goal-side-row">
                    <span className="goal-side-k">Since</span>
                    <span className="goal-side-v">{goal.about.since}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="goal-side-spacer" />
            <div className="goal-side-actions">
              <button className="goal-side-btn" disabled>
                <i className="ri-pencil-line" /> Edit goal
              </button>
              <button className="goal-side-btn" disabled>
                <i className="ri-pause-line" /> Pause
              </button>
            </div>
          </>
        )}

        {!loading && !goal && isEmpty && (
          <div className="focus-empty">
            <i className="ri-node-tree focus-empty-icon" />
            <b className="focus-empty-title">No details yet</b>
            <span className="focus-empty-sub">
              Progress and files appear as the work happens.
            </span>
          </div>
        )}

        {/* PROGRESS */}
        {!goal && hasProgress && (
          <div className="focus-section">
            <div className="focus-section-label">Progress</div>
            <div className="focus-progress">
              {data!.progress!.map((s, i) => (
                <div
                  key={i}
                  className={`focus-step focus-step--${s.status}`}
                >
                  <i className={stepIcon(s.status)} />
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MADE IN THIS THREAD */}
        {!goal && hasFiles && (
          <div className="focus-section">
            <div className="focus-section-label">Made in this thread</div>
            <div className="focus-files">
              {data!.files!.map((f, i) =>
                f.url ? (
                  <a
                    key={i}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-file"
                  >
                    <i className={fileIcon(f.kind)} />
                    <span className="focus-file-label">{f.title}</span>
                    <i className="ri-external-link-line focus-file-ext" />
                  </a>
                ) : (
                  <div key={i} className="focus-file">
                    <i className={fileIcon(f.kind)} />
                    <span className="focus-file-label">{f.title}</span>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* COST SO FAR */}
        {!goal && hasCost && (
          <div className="focus-section">
            <div className="focus-section-label">Cost so far</div>
            <div className="focus-cost-block">
              <div className="focus-cost-big">
                ${data!.cost!.usd < 0.01
                  ? data!.cost!.usd.toFixed(4)
                  : data!.cost!.usd.toFixed(2)}
              </div>
              <div className="focus-cost-sub">
                {fmtTokens(data!.cost!.tokens)} tokens
                {data!.cost!.minutes > 0
                  ? ` · ${data!.cost!.minutes} min of work`
                  : ""}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
