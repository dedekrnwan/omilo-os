"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { BoardCard, api } from "@/lib/api";

/* ------------------------------------------------------------------ helpers */

/** Status label + dot color + border modifier for a card. */
function cardStatus(card: BoardCard): { label: string; dotCls: string; cardMod: string } {
  if (card.status === "needs_you") return { label: "NEEDS YOU", dotCls: "wc-dot-warn",  cardMod: "work-card-needs-you" };
  if (card.status === "running")   return { label: "RUNNING",   dotCls: "wc-dot-run",   cardMod: "" };
  if (card.status === "waiting")   return { label: "WAITING",   dotCls: "wc-dot-idle",  cardMod: "" };
  if (card.status === "done")      return { label: "DONE",      dotCls: "wc-dot-done",  cardMod: "" };
  if (card.status === "failed")    return { label: "FAILED",    dotCls: "wc-dot-bad",   cardMod: "" };
  return { label: (card.status as string).toUpperCase(), dotCls: "wc-dot-idle", cardMod: "" };
}

/** Primary action button label. */
function primaryLabel(card: BoardCard): string {
  if (card.needs_proposal) return "Review PR";
  if (card.awaiting_reply) return "Reply";
  return "Approve";
}

/* ------------------------------------------------------------------ WorkCard */

interface WorkCardProps {
  card: BoardCard;
  /** Who owns this card — for the avatar. Pass at minimum { id, name } */
  helper: { id: string; name: string; role?: string; is_chief?: boolean } | null;
  /** Collaborator avatars (other helpers involved). Optional. */
  collaborators?: { id: string; name: string; role?: string; is_chief?: boolean }[];
  /** When board is paused cards are greyed out */
  paused?: boolean;
  /** Subtitle / description line (one line, grey) */
  subtitle?: string | null;
}

export default function WorkCard({ card, helper, collaborators, paused, subtitle }: WorkCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { label, dotCls, cardMod } = cardStatus(card);
  const showBar = card.progress.total > 0;
  const pct = showBar ? Math.round((card.progress.done / card.progress.total) * 100) : 0;
  const isNeedsYou = card.status === "needs_you";

  /* If the card has no id we cannot resolve a thread — render non-actionable */
  const hasId = !!card.id;

  const openThread = async () => {
    if (!hasId || busy || paused) return;
    setBusy(true);
    try {
      const th = await api<{ id: string }>("/threads", {
        body: { scope: "task", ref_id: card.id },
      });
      router.push(`/chat/?thread=${th.id}`);
    } catch {
      /* silently ignore — card stays rendered */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`work-card${cardMod ? " " + cardMod : ""}${paused ? " work-card-paused" : ""}`}
      onClick={!isNeedsYou && hasId ? openThread : undefined}
      style={!isNeedsYou && hasId ? { cursor: "pointer" } : undefined}
      role={!isNeedsYou && hasId ? "button" : undefined}
      tabIndex={!isNeedsYou && hasId ? 0 : undefined}
      onKeyDown={!isNeedsYou && hasId ? (e) => e.key === "Enter" && openThread() : undefined}
    >
      {/* Top row: status dot + label + collaborator avatar(s) */}
      <div className="wc-status-row">
        <span className={`wc-status-dot ${dotCls}`} />
        <span className="wc-status-label">{label}</span>
        <span className="sp" />
        {collaborators && collaborators.length > 0 && (
          <div className="wc-collabs">
            {collaborators.slice(0, 3).map((c) => (
              <Avatar key={c.id} who={c} size={18} state={null} />
            ))}
          </div>
        )}
      </div>

      {/* Bold title */}
      <div className="wc-title">{card.title}</div>

      {/* Subtitle / description */}
      {subtitle && <div className="wc-subtitle">{subtitle}</div>}

      {/* Goal tag */}
      {card.goal && (
        <div className="wc-goal">
          <i className="ri-flag-line" />
          <span>{card.goal.title}</span>
        </div>
      )}

      {/* Progress bar + N/M */}
      {showBar && (
        <div className="wc-progress">
          <div className="wc-progress-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="wc-progress-label">{card.progress.done}/{card.progress.total}</span>
        </div>
      )}

      {/* Action buttons (NEEDS YOU only) */}
      {isNeedsYou && hasId && (
        <div className="wc-actions">
          <button
            className="btn primary sm wc-action-primary"
            onClick={(e) => { e.stopPropagation(); openThread(); }}
            disabled={busy || !!paused}
            aria-label={`${primaryLabel(card)} ${card.title}`}
          >
            {busy ? <span className="spin" /> : primaryLabel(card)}
          </button>
          <button
            className="btn sm wc-action-open"
            onClick={(e) => { e.stopPropagation(); openThread(); }}
            disabled={busy || !!paused}
          >
            Open
          </button>
        </div>
      )}
    </div>
  );
}
