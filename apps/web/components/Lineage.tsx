"use client";
import { useRouter } from "next/navigation";
import { openTask } from "@/lib/open";
import { menu } from "@/lib/menu";

/* Where a job comes from, as one short line on top of its card: the goal it serves › the job above it.
   Click the goal to open the Plan, the job to open it. Deeper chains show "+N" (hover lists them). */

export type LineageT = { goal: { id: string; title: string } | null; parents: { id: string; title: string; staff?: string; status?: string }[] } | null | undefined;

export default function Lineage({ l, self, plain }: { l: LineageT; self?: string; plain?: boolean }) {
  const router = useRouter();
  if (!l || (!l.goal && !l.parents.length)) return null;
  const parents = l.parents.filter((p) => p.id !== self);
  if (plain) {  // inside something clickable already: just the text
    const near0 = parents[parents.length - 1];
    return (
      <span className="lin plain">
        {l.goal && <span className="lin-goal"><i className="ri-flag-2-line" />{l.goal.title}</span>}
        {near0 && <span className="lin-job"><i className="ri-corner-left-up-line" />{near0.title}</span>}
      </span>
    );
  }
  const near = parents[parents.length - 1];
  const hidden = parents.slice(0, -1);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="lin" onClick={stop} onKeyDown={stop}>
      {l.goal && (
        <button type="button" className="lin-goal" title={`Goal: ${l.goal.title}`} onClick={() => router.push("/plan/")}
          onContextMenu={menu(() => [{ heading: "Goal" }, { label: "Open the Plan", icon: "ri-node-tree", href: "/plan/" }])}>
          <i className="ri-flag-2-line" /><span>{l.goal.title}</span>
        </button>
      )}
      {hidden.length > 0 && <span className="lin-more" title={hidden.map((p) => p.title).join(" › ")}>› +{hidden.length}</span>}
      {near && (
        <>
          {(l.goal || hidden.length > 0) && <span className="lin-sep">›</span>}
          <button type="button" className="lin-job" title={`From: ${near.title}${near.staff ? ` (${near.staff})` : ""}`} onClick={() => openTask(near.id)}
            onContextMenu={menu(() => [{ heading: near.title.slice(0, 60) }, { label: "Open the job above", icon: "ri-arrow-up-line", onSelect: () => openTask(near.id) },
              ...hidden.reverse().map((p) => ({ label: p.title.slice(0, 50), icon: "ri-corner-left-up-line", onSelect: () => openTask(p.id) }))])}>
            <i className="ri-corner-left-up-line" /><span>{near.title}</span>
          </button>
        </>
      )}
    </div>
  );
}
