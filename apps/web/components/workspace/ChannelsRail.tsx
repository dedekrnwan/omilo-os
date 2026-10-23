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
  const [modal, setModal] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api<ChannelsResp>("/channels")); } catch { /* keep last */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const chief = staff.find((s) => s.is_chief);
  const others = staff.filter((s) => !s.is_chief);
  const goalThread = (gid: string) => threads.find((t) => t.scope === "goal" && (t as any).ref_id === gid);
  const staffThread = (sid: string) => threads.find((t) => t.staff_id === sid && t.scope !== "master");
  const channelThread = (cid: string) => threads.find((t) => t.scope === "channel" && (t as any).ref_id === cid);

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
            <button className="chrail-add" onClick={() => setModal(true)} title="New channel" aria-label="New channel">
              <i className="ri-add-line" />
            </button>
          </div>

          <button className="chrail-row" onClick={() => onOpen({ scope: "master" })}>
            <span className="chrail-hash">#</span>
            <span className="chrail-name">general</span>
          </button>

          {data.channels.map((ch) => {
            const cth = channelThread(ch.id);
            const con = cth && activeThreadId === cth.id;
            return (
              <div key={ch.id} className="chrail-channel">
                <button
                  className={`chrail-row chrail-chhead${con ? " on" : ""}`}
                  onClick={() => onOpen({ scope: "channel", ref_id: ch.id })}
                  title={ch.name}
                >
                  <span className="chrail-hash">{ch.emoji || "#"}</span>
                  <span className="chrail-name">{ch.name}</span>
                  {ch.members.length > 0 && <span className="chrail-count">{ch.members.length}</span>}
                </button>
                {ch.goals.map((g) => goalRow(g, true))}
              </div>
            );
          })}

          {/* goals not yet in a channel */}
          {data.unassigned.map((g) => goalRow(g, false))}

          {data.channels.length === 0 && data.unassigned.length === 0 && (
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

      {modal && (
        <NewChannelModal
          goals={data.unassigned}
          staff={staff}
          onClose={() => setModal(false)}
          onCreated={() => { setModal(false); load(); }}
        />
      )}
    </div>
  );
}

/* Step 5 · New channel = a home for goals. Name + emoji, the goals it holds, the staff in it. */
function NewChannelModal({
  goals,
  staff,
  onClose,
  onCreated,
}: {
  goals: GoalLite[];
  staff: Staff[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [goalIds, setGoalIds] = useState<Set<string>>(new Set());
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api("/channels", { body: { name: name.trim(), emoji, goal_ids: [...goalIds], member_ids: [...memberIds] } });
      onCreated();
    } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <div className="dlg-scrim" role="dialog" aria-modal="true" aria-labelledby="nc-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dlg nc-dlg">
        <h2 id="nc-title" className="nc-title">New channel</h2>
        <p className="dlg-body nc-sub">A home for goals and the sessions about them.</p>

        <div className="nc-namerow">
          <input className="nc-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value.slice(0, 2))} placeholder="#" aria-label="Emoji" />
          <input className="nc-name" autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") create(); }} placeholder="Channel name" aria-label="Channel name" />
        </div>

        {goals.length > 0 && (
          <div className="nc-sec">
            <div className="nc-sec-label">Goals in this channel</div>
            <div className="nc-list">
              {goals.map((g) => (
                <button key={g.id} className={`nc-opt${goalIds.has(g.id) ? " on" : ""}`} onClick={() => toggle(goalIds, setGoalIds, g.id)}>
                  <span className="nc-check"><i className="ri-check-line" /></span>
                  <span className="chrail-hash">#</span>
                  <span className="nc-opt-name">{g.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="nc-sec">
          <div className="nc-sec-label">Members</div>
          <div className="nc-list">
            {staff.map((s) => (
              <button key={s.id} className={`nc-opt${memberIds.has(s.id) ? " on" : ""}`} onClick={() => toggle(memberIds, setMemberIds, s.id)}>
                <span className="nc-check"><i className="ri-check-line" /></span>
                <Avatar who={s} size={20} />
                <span className="nc-opt-name">{s.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="dlg-acts">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={create} disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create channel"}
          </button>
        </div>
      </div>
    </div>
  );
}
