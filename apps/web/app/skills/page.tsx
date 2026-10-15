"use client";
import { useCallback, useEffect, useState } from "react";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";

/* Skills: reusable instructions (SKILL.md) a helper follows when you switch them on for a chat or job. */

type Skill = { slug: string; name: string; description: string; default_on: boolean; chars: number };
type Form = { slug: string; name: string; description: string; body: string; default_on: boolean; editing: boolean };
type Talent = { slug: string; name: string; description?: string; division: string };

const blank: Form = { slug: "", name: "", description: "", body: "", default_on: false, editing: false };
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export default function Skills() {
  const [list, setList] = useState<Skill[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Talent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await api<Skill[]>("/skills")); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (found === null) return;
    const t = setTimeout(async () => {
      try { setFound((await api<{ agents: Talent[] }>(`/talent?q=${encodeURIComponent(q)}`)).agents.slice(0, 12)); } catch (e: any) { setErr(e.message); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, found === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (s: Skill) => {
    try { const full = await api<Skill & { body: string }>(`/skills/${s.slug}`); setForm({ ...full, editing: true }); } catch (e: any) { setErr(e.message); }
  };
  const save = async () => {
    if (!form) return;
    setErr(null);
    try {
      await api("/skills", { body: { slug: form.slug || slugify(form.name), name: form.name, description: form.description, body: form.body, default_on: form.default_on } });
      setForm(null); load();
    } catch (e: any) { setErr(e.message); }
  };
  const remove = async (s: Skill) => { if (!confirm(`Delete the skill ${s.name}?`)) return; await api(`/skills/${s.slug}`, { method: "DELETE" }); load(); };
  const importTalent = async (t: Talent) => {
    try { await api(`/skills/from-talent/${t.slug}`, { body: {} }); setFound(null); setQ(""); load(); } catch (e: any) { setErr(e.message); }
  };
  const toggleDefault = async (s: Skill) => {
    const full = await api<Skill & { body: string }>(`/skills/${s.slug}`);
    await api("/skills", { body: { ...full, default_on: !s.default_on } });
    load();
  };
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div>
      <h1>Skills</h1>
      <p className="sub">Know-how your helpers can follow: a checklist, a house style, a process. Switch skills on per chat with the + button in the Workspace, or make one standard for everyone.</p>

      <div className="sec">
        <div className="sechead"><h2>Your skills</h2><span className="sp" />
          <button className="btn" onClick={() => setFound(found === null ? [] : null)}><i className="ri-download-2-line" />From The Agency</button>
          {!form && <button className="btn primary" onClick={() => setForm({ ...blank })}><i className="ri-add-line" />New skill</button>}</div>

        {found !== null && (
          <div className="paper" style={{ marginBottom: 16 }}>
            <label style={{ marginTop: 0 }}>Turn a specialist's playbook into a skill any helper can use</label>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: SEO, code review, pitch deck…" />
            <div className="fsbox" style={{ marginTop: 8 }}>
              {found.length === 0 ? <div className="fsrow small">{q ? "Nothing found." : "Type to search about 280 specialists."}</div> : found.map((t) => (
                <div key={t.slug} className="fsrow">
                  <span style={{ flex: 1, minWidth: 0 }}><b style={{ fontWeight: 500 }}>{t.name}</b><div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div></span>
                  <button className="btn sm" onClick={() => importTalent(t)}>Add</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {list === null ? <p className="small">Loading…</p> : list.length === 0 && !form ? (
          <div className="empty"><b>No skills yet</b><span>Write one, or start from an Agency specialist.</span></div>
        ) : (
          <div className="grid2">
            {list.map((s) => (
              <div key={s.slug} className="card">
                <div className="acts" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                  <b style={{ fontWeight: 500 }}><i className="ri-magic-line" /> {s.name}</b>
                  {s.default_on && <span className="chip up">Standard</span>}
                </div>
                <div className="small">{s.description || "No description"}</div>
                <div className="acts" style={{ marginTop: 4 }}>
                  <button className="btn sm" onClick={() => open(s)}>Edit</button>
                  <button className="btn sm" onClick={() => toggleDefault(s)}>{s.default_on ? "Make optional" : "Make standard"}</button>
                  <span className="sp" />
                  <button className="iconbtn" aria-label={`Delete ${s.name}`} onClick={() => remove(s)}><i className="ri-delete-bin-line" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {form && (
        <div className="paper" style={{ marginTop: 20 }}>
          <h2 style={{ marginTop: 0 }}>{form.editing ? `Edit ${form.name}` : "New skill"}</h2>
          <div className="grid2">
            <div><label>Name</label><input value={form.name} onChange={(e) => set({ name: e.target.value, ...(form.editing ? {} : { slug: slugify(e.target.value) }) })} placeholder="e.g. Weekly newsletter" /></div>
            <div><label>When to use it</label><input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Writing the Friday newsletter for customers" /></div>
          </div>
          <label>Instructions</label>
          <textarea style={{ minHeight: 260, fontFamily: "var(--font-mono)", fontSize: 13 }} value={form.body} onChange={(e) => set({ body: e.target.value })}
            placeholder={"Steps, rules and examples, in plain words.\n\n1. Start with the one number that moved this week.\n2. Keep it under 200 words.\n3. End with one question for the reader."} />
          <label className="check"><input type="checkbox" checked={form.default_on} onChange={(e) => set({ default_on: e.target.checked })} />Standard: every helper follows it in every chat and job</label>
          <div className="acts" style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={!form.name.trim() || !form.body.trim()} onClick={save}>Save skill</button>
            <button className="btn quiet" onClick={() => { setForm(null); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}
      <Err error={err} />
    </div>
  );
}
