/* 7-note grid: Company · Customers · Goals · Offer · Rules · Systems · Voice.
   Used in the Welcome rail (all empty rows), the live interview rail (filled/next/empty rows),
   and the Check screen (editable 4-column grid). */

export type NoteKey = "company" | "customers" | "goals" | "offer" | "rules" | "systems" | "voice";

export const NOTE_DEFS: { key: NoteKey; label: string; icon: string; blurb: string }[] = [
  { key: "company",   label: "Company",   icon: "ri-building-line",       blurb: "who you are and what you do" },
  { key: "customers", label: "Customers", icon: "ri-group-line",           blurb: "who you serve" },
  { key: "goals",     label: "Goals",     icon: "ri-flag-2-line",          blurb: "what you want this quarter" },
  { key: "offer",     label: "Offer",     icon: "ri-price-tag-3-line",     blurb: "what you sell, for how much" },
  { key: "rules",     label: "Rules",     icon: "ri-shield-check-line",    blurb: "what helpers must never do" },
  { key: "systems",   label: "Systems",   icon: "ri-tools-line",           blurb: "tools and where things live" },
  { key: "voice",     label: "Voice",     icon: "ri-chat-voice-line",      blurb: "how you sound" },
];

/** Map from topic id (interview) to note key */
export const TOPIC_TO_NOTE: Record<string, NoteKey> = {
  business:  "company",
  customers: "customers",
  goals:     "goals",
  offer:     "offer",
  rules:     "rules",
  work:      "systems",
  voice:     "voice",
};

type NoteStatus = "filled" | "next" | "empty";

interface NoteItem {
  key: NoteKey;
  status: NoteStatus;
  body?: string;
}

/** Static rail shown on welcome screen — icon · bold label · muted blurb · hollow circle */
export function WelcomeNotes() {
  return (
    <div className="ob2-welcome-notes">
      {NOTE_DEFS.map((d) => (
        <div key={d.key} className="ob2-welcome-note">
          <i className={d.icon} />
          <span className="ob2-welcome-note-label">{d.label}</span>
          <span className="ob2-welcome-note-blurb">{d.blurb}</span>
          <span className="ob2-welcome-note-dot" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

/** Live panel in the interview screen (filled / writing / next / empty). */
export function LiveNotes({ notes, doneCount, totalTopics }: { notes: NoteItem[]; doneCount?: number; totalTopics?: number }) {
  return (
    <div className="ob2-livenotes">
      {notes.map((n) => {
        const def = NOTE_DEFS.find((d) => d.key === n.key)!;
        const isFilled = n.status === "filled";
        const isCurrent = n.status === "next";
        return (
          <div
            key={n.key}
            className={`ob2-livenote${isFilled ? " filled" : isCurrent ? " current" : ""}`}
          >
            <i className={def.icon} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="ob2-livenote-label">{def.label}</span>
                {isFilled && (
                  <span className="ob2-livenote-actions">
                    <i className="ri-check-line" style={{ fontSize: 13, color: "var(--ok)" }} />
                    <i className="ri-pencil-line" style={{ fontSize: 13 }} />
                  </span>
                )}
                {isCurrent && (
                  <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic" }}>writing…</span>
                )}
              </div>
              {n.body && (
                <div className="ob2-livenote-body">{n.body}</div>
              )}
              {!n.body && !isFilled && isCurrent && (
                <div className="ob2-livenote-body" style={{ color: "var(--faint)" }}>{def.blurb}</div>
              )}
              {!n.body && !isFilled && !isCurrent && (
                <div className="ob2-livenote-body">
                  {n.status === "empty"
                    ? <span style={{ color: "var(--faint)" }}>{def.blurb}</span>
                    : null}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Editable grid on the Check screen — 4 columns × 2 rows + dashed "Add" tile. */
export function EditableNotes({
  values,
  onChange,
}: {
  values: Record<NoteKey, string>;
  onChange: (key: NoteKey, val: string) => void;
}) {
  return (
    <div className="ob2-check-grid">
      {NOTE_DEFS.map((d) => (
        <div key={d.key} className="ob2-check-note">
          <div className="ob2-check-note-head">
            <i className={d.icon} />
            <b>{d.label}</b>
            <button type="button" className="ob2-check-note-edit" title={`Edit ${d.label}`}>
              <i className="ri-pencil-line" style={{ fontSize: 13 }} />
            </button>
          </div>
          <textarea
            rows={4}
            value={values[d.key] || ""}
            onChange={(e) => onChange(d.key, e.target.value)}
            placeholder={d.blurb}
          />
        </div>
      ))}
      {/* 8th tile: Add something I missed */}
      <button type="button" className="ob2-check-add">
        <i className="ri-add-line" style={{ fontSize: 18 }} />
        Add something I missed
      </button>
    </div>
  );
}
