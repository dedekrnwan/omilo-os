"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { BoardCard, api, ago } from "@/lib/api";

/* ------------------------------------------------------------------ helpers */

/** Derive chip class + label from the card's status and action flags. */
function cardChip(card: BoardCard): { label: string; cls: string } {
  if (card.status === "needs_you" && card.needs_proposal) return { label: "Review", cls: "chip warn" };
  if (card.status === "needs_you" && card.awaiting_reply) return { label: "Reply", cls: "chip warn" };
  if (card.status === "needs_you") return { label: "Needs you", cls: "chip warn" };
  if (card.status === "running") return { label: "Running", cls: "chip run" };
  if (card.status === "waiting") return { label: "Waiting", cls: "chip idle" };
  if (card.status === "done") return { label: "Done", cls: "chip up" };
  if (card.status === "failed") return { label: "Failed", cls: "chip down" };
  return { label: card.status, cls: "chip" };
}

/** Derive the primary action label. Matches task brief spec. */
function cardActionLabel(card: BoardCard): string {
  if (card.status === "needs_you" && card.needs_proposal) return "Review";
  if (card.status === "needs_you" && card.awaiting_reply) return "Reply";
  if (card.status === "needs_you") return "Review"; // chip says "Needs you" → action matches
  if (card.status === "running") return "Open";
  if (card.status === "waiting") return "Open";
  if (card.status === "failed") return "Open";
  return "Open";
}

/* ------------------------------------------------------------------ WorkCard */

interface WorkCardProps {
  card: BoardCard;
  /** Who owns this card — for the avatar. Pass at minimum { id, name } */
  helper: { id: string; name: string; role?: string; is_chief?: boolean } | null;
  /** When board is paused cards are greyed out */
  paused?: boolean;
}

export default function WorkCard({ card, helper, paused }: WorkCardProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const chip = cardChip(card);
  const showBar = card.progress.total > 0;
  const pct = showBar ? Math.round((card.progress.done / card.progress.total) * 100) : 0;

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

  const actionLabel = cardActionLabel(card);

  return (
    <div className={`work-card${paused ? " work-card-paused" : ""}`}>
      {/* Header: avatar + title */}
      <div className="wc-head">
        {helper && (
          <Avatar
            who={helper as { id: string; name: string; role?: string; is_chief?: boolean }}
            size={24}
            state={card.status === "running" ? "working" : null}
          />
        )}
        <span className="wc-title">{card.title}</span>
        <span className={chip.cls}>{chip.label}</span>
      </div>

      {/* Goal tag */}
      {card.goal && (
        <div className="wc-goal">
          <i className="ri-flag-line" />
          <span>{card.goal.title}</span>
        </div>
      )}

      {/* Progress bar */}
      {showBar && (
        <div className="wc-progress">
          <div className="wc-progress-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <span className="wc-progress-label">{card.progress.done}/{card.progress.total}</span>
        </div>
      )}

      {/* Footer: updated_at + action button */}
      <div className="wc-foot">
        {card.updated_at && (
          <span className="wc-time">{ago(card.updated_at)}</span>
        )}
        <span className="sp" />
        {hasId ? (
          <button
            className="btn sm wc-action"
            onClick={openThread}
            disabled={busy || !!paused}
            aria-label={`${actionLabel} ${card.title}`}
          >
            {busy ? <span className="spin" /> : actionLabel}
          </button>
        ) : (
          /* No resolvable task — non-actionable */
          <span className="wc-no-action" aria-label="No task link available" />
        )}
      </div>
    </div>
  );
}
