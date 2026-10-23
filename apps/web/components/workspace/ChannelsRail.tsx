"use client";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { Staff, Thread, api } from "@/lib/api";

/* Chat-mode left rail: the same sessions as Work mode, grouped the chat way —
   by channel (a home for goals) and by staff (one-on-one DMs). "Channels hold goals." */

type GoalLite = { id: string; title: string };

export default function ChannelsRail({
  threads,
  staff,
  activeThreadId,
  onOpen,
  onSwitchMode,
}: {
  threads: Thread[];
  staff: Staff[];
  activeThreadId?: string | null;
  /** Open (or create) a session by scope — mirrors the chat page's openThread. */
  onOpen: (body: Record<string, string>) => void;
  /** Flip back to Work mode (the board). */
  onSwitchMode: () => void;
}) {
  const [goals, setGoals] = useState<GoalLite[]>([]);
  useEffect(() => { api<GoalLite[]>("/goals").then(setGoals).catch(() => {}); }, []);

  const chief = staff.find((s) => s.is_chief);
  const others = staff.filter((s) => !s.is_chief);

  const goalThread = (gid: string) => threads.find((t) => t.scope === "goal" && (t as any).ref_id === gid);
  const staffThread = (sid: string) => threads.find((t) => t.staff_id === sid && t.scope !== "master");

  return (
    <div className="channels-rail">
      <div className="channels-rail-head">
        <div className="seg" role="tablist" aria-label="Workspace mode">
          <button role="tab" aria-selected={false} onClick={onSwitchMode}>
            <i className="ri-layout-grid-line" /> Work
          </button>
          <button role="tab" aria-selected className="on">
            <i className="ri-chat-3-line" /> Chat
          </button>
        </div>
      </div>

      <div className="channels-rail-body">
        {/* CHANNELS — a home for goals */}
        <div className="chrail-group">
          <div className="chrail-label">Channels</div>
          <button className="chrail-row" onClick={() => onOpen({ scope: "master" })}>
            <span className="chrail-hash">#</span>
            <span className="chrail-name">general</span>
          </button>
          {goals.map((g) => {
            const th = goalThread(g.id);
            const on = th && activeThreadId === th.id;
            return (
              <button
                key={g.id}
                className={`chrail-row${on ? " on" : ""}`}
                onClick={() => onOpen({ scope: "goal", ref_id: g.id })}
                title={g.title}
              >
                <span className="chrail-hash">#</span>
                <span className="chrail-name">{g.title}</span>
              </button>
            );
          })}
          {goals.length === 0 && (
            <div className="chrail-empty">Goals you create become channels.</div>
          )}
        </div>

        {/* STAFF — one-on-one DMs */}
        <div className="chrail-group">
          <div className="chrail-label">Staff</div>
          {[chief, ...others].filter(Boolean).map((s) => {
            const st = s as Staff;
            const th = staffThread(st.id);
            const on = th && activeThreadId === th.id;
            return (
              <button
                key={st.id}
                className={`chrail-row chrail-dm${on ? " on" : ""}`}
                onClick={() => onOpen({ scope: "staff", staff_id: st.id })}
                title={st.name}
              >
                <Avatar who={st} size={20} />
                <span className="chrail-name">{st.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
