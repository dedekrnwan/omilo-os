"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

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
}

function fileIcon(kind?: string): string {
  if (kind === "pr") return "ri-git-pull-request-line";
  if (kind === "chart") return "ri-bar-chart-line";
  if (kind === "image") return "ri-image-line";
  return "ri-file-text-line";
}

function stepIcon(status: FocusStep["status"]): string {
  if (status === "done") return "ri-checkbox-circle-fill";
  if (status === "active") return "ri-record-circle-line";
  return "ri-circle-line";
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

        {!loading && isEmpty && (
          <div
            className="empty"
            style={{ textAlign: "center", padding: "24px 8px" }}
          >
            <i
              className="ri-node-tree"
              style={{
                fontSize: 28,
                color: "var(--faint)",
                display: "block",
                marginBottom: 8,
              }}
            />
            <b style={{ color: "var(--muted)", fontWeight: 500, fontSize: 13 }}>
              No details yet
            </b>
            <span
              style={{
                display: "block",
                fontSize: 12,
                color: "var(--faint)",
                marginTop: 4,
              }}
            >
              Progress and files appear as the work happens.
            </span>
          </div>
        )}

        {/* PROGRESS */}
        {hasProgress && (
          <div className="focus-section">
            <div className="focus-section-label">Progress</div>
            <div className="focus-progress">
              {data!.progress!.map((s, i) => (
                <div
                  key={i}
                  className={`focus-step${s.status === "done" ? " done" : s.status === "active" ? " active" : ""}`}
                >
                  <i className={stepIcon(s.status)} />
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MADE IN THIS THREAD */}
        {hasFiles && (
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
                    <span>{f.title}</span>
                    <i className="ri-external-link-line" style={{ fontSize: 12, color: "var(--faint)" }} />
                  </a>
                ) : (
                  <div key={i} className="focus-file">
                    <i className={fileIcon(f.kind)} />
                    <span>{f.title}</span>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* COST SO FAR */}
        {hasCost && (
          <div className="focus-section">
            <div className="focus-section-label">Cost so far</div>
            <div className="focus-cost">
              <div className="focus-cost-item">
                <b>
                  ${data!.cost!.usd < 0.01
                    ? data!.cost!.usd.toFixed(4)
                    : data!.cost!.usd.toFixed(2)}
                </b>
                <span>cost</span>
              </div>
              <div className="focus-cost-sep" />
              <div className="focus-cost-item">
                <b>
                  {data!.cost!.tokens > 999
                    ? `${Math.round(data!.cost!.tokens / 1000)}k`
                    : String(data!.cost!.tokens)}
                </b>
                <span>tokens</span>
              </div>
              <div className="focus-cost-sep" />
              <div className="focus-cost-item">
                <b>{data!.cost!.minutes}</b>
                <span>min</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
