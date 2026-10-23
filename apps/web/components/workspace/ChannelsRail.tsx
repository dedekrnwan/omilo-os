"use client";
import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { Staff, Thread, api } from "@/lib/api";

/* Chat-mode left rail: the same sessions as Work mode, grouped the chat way —
   by channel (a home for goals) and by staff (one-on-one DMs). "Channels hold goals." */

type GoalLite = { id: string; title: string };
type ChannelLite = { id: string; name: string; emoji: string; members: { id: string; name: string }[]; goals: GoalLite[] };
type ChannelsResp = { channels: ChannelLite[]; unassigned: GoalLite[] };

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
  const [data, setData] = useState<ChannelsResp>({ channels: [], unassigned: [] });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<ChannelsResp>("/channels")); } catch { /* keep last */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try { await api("/channels", { body: { name } }); setNewName(""); setCreating(false); await load(); }
    catch { /* ignore */ } finally { setBusy(false); }
  };

  const chief = staff.find((s) => s.is_chief);
  const others = staff.filter((s) => !s.is_chief);
  const goalThread = (gid: string) => threads.find((t) => t.scope === "goal" && (t as any).ref_id === gid);
  const staffThread = (sid: string) => threads.find((t) => t.staff_id === sid && t.scope !== "master");

  const goalRow = (g: GoalLite, nested: boolean) => {
    const th = goalThread(g.id);
    const on = th && activeThreadId === th.id;
    return (
      <button
        key={g.id}
        className={`chrail-row${nested ? " chrail-nested" : ""}${on ? " on" : ""}`}
        onClick={() => onOpen({ scope: "goal", ref_id: g.id })}
        title={g.title}
      >
        <span className="chrail-hash">#</span>
        <span className="chrail-name">{g.title}</span>
      </button>
    );
  };

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
          <div className="chrail-label">
            Channels
            <button className="chrail-add" onClick={() => setCreating((c) => !c)} title="New channel" aria-label="New channel">
              <i className="ri-add-line" />
            </button>
          </div>

          <button className="chrail-row" onClick={() => onOpen({ scope: "master" })}>
            <span className="chrail-hash">#</span>
            <span className="chrail-name">general</span>
          </button>

          {data.channels.map((ch) => (
            <div key={ch.id} className="chrail-channel">
              <div className="chrail-row chrail-chhead">
                <span className="chrail-hash">{ch.emoji || "#"}</span>
                <span className="chrail-name">{ch.name}</span>
                {ch.members.length > 0 && <span className="chrail-count">{ch.members.length}</span>}
              </div>
              {ch.goals.map((g) => goalRow(g, true))}
            </div>
          ))}

          {/* goals not yet in a channel */}
          {data.unassigned.map((g) => goalRow(g, false))}

          {creating && (
            <div className="chrail-new">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") { setCreating(false); setNewName(""); } }}
                placeholder="Channel name…"
                aria-label="New channel name"
              />
              <button className="btn sm primary" disabled={!newName.trim() || busy} onClick={create}>Add</button>
            </div>
          )}

          {data.channels.length === 0 && data.unassigned.length === 0 && !creating && (
            <div className="chrail-empty">Goals you create become channels. Add one with +.</div>
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
