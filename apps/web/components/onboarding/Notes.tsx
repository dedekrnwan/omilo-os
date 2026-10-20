/* 7-note grid: Company · Customers · Goals · Offer · Rules · Systems · Voice.
   Used in the Welcome rail (all empty), the live interview rail (filled/next/empty),
   and the Check screen (editable). */

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

/** Map from topic id (interview) to note key(s) it fills */
export const TOPIC_TO_NOTE: Record<string, NoteKey> = {
  business: "company",
  customers: "customers",
  goals: "goals",
  offer: "offer",
  rules: "rules",
  work: "systems",
  voice: "voice",
};

type NoteStatus = "filled" | "next" | "empty";

interface NoteItem {
  key: NoteKey;
  status: NoteStatus;
  body?: string;
}

/** Static rail shown on welcome screen: all notes empty. */
export function WelcomeNotes() {
  return (
    <div className="ob2-notes">
      {NOTE_DEFS.map((d, i) => (
        <div key={d.key} className={`ob2-note${i === NOTE_DEFS.length - 1 ? " span2" : ""}`}>
          <i className={`ob2-note-icon ${d.icon}`} />
          <span className="ob2-note-label">{d.label}</span>
          <span className="ob2-note-body">{d.blurb}</span>
        </div>
      ))}
    </div>
  );
}

/** Live panel in the interview screen (filled / writing / next / empty). */
export function LiveNotes({ notes }: { notes: NoteItem[] }) {
  return (
    <div className="ob2-notes">
      {notes.map((n, i) => {
        const def = NOTE_DEFS.find((d) => d.key === n.key)!;
        return (
          <div key={n.key} className={`ob2-note ${n.status}${i === notes.length - 1 ? " span2" : ""}`}>
            <i className={`ob2-note-icon ${def.icon}`} />
            <span className="ob2-note-label">{def.label}</span>
            <span className="ob2-note-body">{n.body || def.blurb}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Editable grid on the Check screen. */
export function EditableNotes({
  values,
  onChange,
}: {
  values: Record<NoteKey, string>;
  onChange: (key: NoteKey, val: string) => void;
}) {
  return (
    <div className="ob2-notes" style={{ gap: 10 }}>
      {NOTE_DEFS.map((d, i) => (
        <div key={d.key} className={`ob2-note filled${i === NOTE_DEFS.length - 1 ? " span2" : ""}`} style={{ cursor: "default" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <i className={`ob2-note-icon ${d.icon}`} />
            <span className="ob2-note-label" style={{ flex: 1 }}>{d.label}</span>
            <i className="ri-pencil-line" style={{ fontSize: 13, color: "var(--muted)" }} />
          </div>
          <textarea
            rows={3}
            value={values[d.key] || ""}
            onChange={(e) => onChange(d.key, e.target.value)}
            placeholder={d.blurb}
            style={{
              width: "100%", resize: "vertical", fontSize: 12, lineHeight: 1.5,
              border: "1px solid var(--line-strong)", borderRadius: "var(--r-sm)",
              padding: "6px 8px", background: "var(--surface)", color: "var(--ink)",
              fontFamily: "inherit",
            }}
          />
        </div>
      ))}
    </div>
  );
}
