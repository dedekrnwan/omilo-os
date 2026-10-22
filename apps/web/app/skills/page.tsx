"use client";
import { usePageActions } from "@/components/PageActions";
import { useCallback, useEffect, useState } from "react";
import Drawer from "@/components/Drawer";
import { Markdown } from "@/components/Markdown";
import { Err } from "@/components/ui";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/poll";
import { copy, menu, sep } from "@/lib/menu";
import { confirmDialog } from "@/lib/dialog";

/* Skills: reusable instructions (SKILL.md) a helper follows when you switch them on for a chat or job.
   Writing, editing and importing happen in a drawer on the right. */

type Skill = { slug: string; name: string; description: string; default_on: boolean; chars: number; owner?: string | null; made_by?: string | null };
type Form = { slug: string; name: string; description: string; body: string; default_on: boolean; editing: boolean };
type Talent = { slug: string; name: string; description?: string; division: string; emoji?: string };

const blank: Form = { slug: "", name: "", description: "", body: "", default_on: false, editing: false };
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const STARTER = "## When to use\n- \n\n## Steps\n1. \n2. \n3. \n\n## Rules\n- \n\n## Example\n";

export default function Skills() {
  const [list, setList] = useState<Skill[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Talent[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await api<Skill[]>("/skills")); } catch (e: any) { setErr(e.message); } }, []);
  usePoll(load, 60000, [load]);
  useEffect(() => {
    if (!importing) return;
    const t = setTimeout(async () => {
      try { setFound((await api<{ agents: Talent[] }>(`/talent?q=${encodeURIComponent(q)}`)).agents.slice(0, 30)); } catch (e: any) { setErr(e.message); }
    }, 200);
    return () => clearTimeout(t);
  }, [q, importing]);

  const closeForm = useCallback(() => { setForm(null); setErr(null); }, []);
  const closeImport = useCallback(() => { setImporting(false); setQ(""); setFound(null); }, []);
  const open = async (slug: string) => {
    setErr(null);
    try { const full = await api<Skill & { body: string }>(`/skills/${slug}`); setTab("write"); setForm({ ...full, editing: true }); } catch (e: any) { setErr(e.message); }
  };
  const save = async () => {
    if (!form) return;
    setErr(null); setBusy("save");
    try {
      await api("/skills", { body: { slug: form.slug || slugify(form.name), name: form.name, description: form.description, body: form.body, default_on: form.default_on } });
      setForm(null); load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!form || !(await confirmDialog({ title: `Delete the skill “${form.name}”?`, body: "Helpers stop using it. This can’t be undone.", confirm: "Delete skill", danger: true }))) return;
    await api(`/skills/${form.slug}`, { method: "DELETE" }); setForm(null); load();
  };
  const importTalent = async (t: Talent) => {
    setBusy(t.slug); setErr(null);
    try { const sk = await api<Skill>(`/skills/from-talent/${t.slug}`, { body: {} }); closeImport(); await load(); open(sk.slug); }
    catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { api<{ id: string; name: string }[]>("/staff").then((l) => setNames(Object.fromEntries(l.map((x) => [x.id, x.name])))).catch(() => {}); }, []);
  const who = (id?: string | null) => (id ? names[id] || id : "");
  const share = async (s: Skill) => {
    if (!(await confirmDialog({ title: `Share “${s.name}” with the whole team?`, body: `${who(s.owner)} wrote it for itself. Shared, every helper uses it.`, confirm: "Share with the team" }))) return;
    await api(`/skills/${s.slug}/share`, { body: {} }); load();
  };
  const toggleDefault = async (s: Skill) => {
    const full = await api<Skill & { body: string }>(`/skills/${s.slug}`);
    await api("/skills", { body: { ...full, default_on: !s.default_on } });
    load();
  };
  const items = (s: Skill) => [
    { heading: s.name },
    { label: "Open and edit", icon: "ri-edit-line", onSelect: () => open(s.slug) },
    ...(s.owner ? [{ label: "Share with the team", icon: "ri-team-line", onSelect: () => share(s) }]
      : [{ label: "Standard for everyone", icon: "ri-star-line", checked: s.default_on, onSelect: () => toggleDefault(s) }]),
    { label: "Use it in a chat", icon: "ri-chat-3-line", href: "/chat/", hint: `type /${s.slug}` },
    sep,
    { label: "Copy the command", icon: "ri-slash-commands-2", hint: `/${s.slug}`, onSelect: () => copy(`/${s.slug}`) },
    { label: "Copy as Markdown", icon: "ri-markdown-line", onSelect: async () => { const f = await api<Skill & { body: string }>(`/skills/${s.slug}`); copy(`# ${f.name}\n\n${f.description}\n\n${f.body}`); } },
    { label: "Duplicate", icon: "ri-file-copy-2-line", onSelect: async () => { const f = await api<Skill & { body: string }>(`/skills/${s.slug}`); setTab("write"); setForm({ ...f, slug: "", name: `${f.name} copy`, editing: false }); } },
    sep,
    { label: "Delete", icon: "ri-delete-bin-line", danger: true, onSelect: async () => { if (!(await confirmDialog({ title: `Delete the skill “${s.name}”?`, body: "Helpers stop using it. This can’t be undone.", confirm: "Delete skill", danger: true }))) return; await api(`/skills/${s.slug}`, { method: "DELETE" }); load(); } },
  ];
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const addStarter = (name: string, description: string, body: string) => {
    setErr(null); setTab("write"); setForm({ slug: slugify(name), name, description, body, default_on: false, editing: false });
  };

  usePageActions({
    primary: { label: "New skill", icon: "ri-add-line", onSelect: () => { setErr(null); setTab("write"); setForm({ ...blank, body: STARTER }); } },
    more: [{ label: "Get one from The Agency", icon: "ri-download-2-line", onSelect: () => { setImporting(true); setFound(null); } }],
  }, []);
  return (
    <div>
      {/* Page Header v2 */}
      <div className="ph2">
        <div className="ph2-text">
          <h1 className="ph2-title">Skills</h1>
          <p className="ph2-sub">Know-how your helpers follow: a checklist, a house style, a process. Switch skills on per chat with + or by typing /, or make one standard for everyone.</p>
        </div>
        <div className="ph2-actions">
          <button className="btn primary" onClick={() => { setErr(null); setTab("write"); setForm({ ...blank, body: STARTER }); }}><i className="ri-add-line" />New skill</button>
        </div>
      </div>

      <div className="sec" style={{ marginTop: 0 }}>
        {list === null ? <p className="small">Loading…</p> : list.length === 0 ? (
          <>
            {/* Empty state — "Teach your helpers how you like things done" */}
            <div className="sk2-empty">
              <div className="sk2-empty-icon"><i className="ri-magic-line" /></div>
              <div className="sk2-empty-body">
                <b>Teach your helpers how you like things done</b>
                <span>Write a skill once. Switch it on in any chat with + or by typing /, or make it standard for every helper, every time.</span>
                <div className="sk2-empty-actions">
                  <button className="btn primary" onClick={() => { setErr(null); setTab("write"); setForm({ ...blank, body: STARTER }); }}><i className="ri-add-line" />Write a skill</button>
                  <button className="btn" onClick={() => { setImporting(true); setFound(null); }}><i className="ri-download-2-line" />Start from a specialist&apos;s playbook</button>
                </div>
              </div>
            </div>

            {/* How it works */}
            <div className="sk2-hiw">
              <div className="sk2-hiw-step">
                <div className="sk2-hiw-num">1</div>
                <div className="sk2-hiw-text">
                  <b>Write it</b>
                  <span>Plain words, like a note to a new teammate.</span>
                </div>
              </div>
              <div className="sk2-hiw-step">
                <div className="sk2-hiw-num">2</div>
                <div className="sk2-hiw-text">
                  <b>Use it in a chat</b>
                  <span>Type / and pick the skill for that one job.</span>
                </div>
              </div>
              <div className="sk2-hiw-step">
                <div className="sk2-hiw-num">3</div>
                <div className="sk2-hiw-text">
                  <b>Make it standard</b>
                  <span>Every helper follows it, every time.</span>
                </div>
              </div>
            </div>

            {/* Starter skills section */}
            <p className="sk2-sec-label">Starter skills for Sahabat Warga</p>
            <div className="sk2-starters">
              <div className="sk2-starter">
                <div className="sk2-starter-text">
                  <b>House voice</b>
                  <span>Bahasa first, warm and short. No jargon with customers.</span>
                </div>
                <button className="btn sm" onClick={() => addStarter("House voice", "Bahasa first, warm and short. No jargon with customers.", "## When to use\n- Writing anything customer-facing\n\n## Rules\n- Bahasa Indonesia first\n- Warm and short — no more than 3 sentences per point\n- No technical jargon\n- Use ‘kamu’ not ‘Anda’ for casual, ‘Anda’ for formal\n")}><i className="ri-add-line" />Add</button>
              </div>
              <div className="sk2-starter">
                <div className="sk2-starter-text">
                  <b>Before you reply to a customer</b>
                  <span>A 5-point check: name, order, promise, tone, next step.</span>
                </div>
                <button className="btn sm" onClick={() => addStarter("Before you reply to a customer", "A 5-point check: name, order, promise, tone, next step.", "## Checklist before every customer reply\n1. **Name** — use their name in the opening\n2. **Order** — reference their order or issue number\n3. **Promise** — state what you will do and by when\n4. **Tone** — warm, calm, never defensive\n5. **Next step** — end with a clear action for them\n")}><i className="ri-add-line" />Add</button>
              </div>
              <div className="sk2-starter">
                <div className="sk2-starter-text">
                  <b>Weekly report format</b>
                  <span>One page: what moved, what is stuck, what you need to decide.</span>
                </div>
                <button className="btn sm" onClick={() => addStarter("Weekly report format", "One page: what moved, what is stuck, what you need to decide.", "## Weekly Report\n\n### What moved\n- \n\n### What is stuck\n- \n\n### What we need to decide\n- \n")}><i className="ri-add-line" />Add</button>
              </div>
            </div>
          </>
        ) : (
          <div className="sk2-list">
            {list.map((s) => (
              <div key={s.slug} className="sk2-row" role="button" tabIndex={0} onClick={() => open(s.slug)} onKeyDown={(e) => { if (e.key === "Enter") open(s.slug); }} onContextMenu={menu(() => items(s))}>
                <div className="sk2-row-tile"><i className="ri-magic-line" /></div>
                <div className="sk2-row-text">
                  <div className="sk2-row-name">
                    <b>{s.name}</b>
                    {s.owner ? <span className="chip idle" title="Only this helper uses it"><i className="ri-user-line" /> {who(s.owner)}&apos;s own</span>
                      : s.default_on ? <span className="chip up">Standard</span> : <span className="chip idle">Per chat</span>}
                  </div>
                  <span className="sk2-row-desc">{s.description || "No description"}</span>
                  <span className="sk2-row-slug mono">/{s.slug}{s.made_by && !s.owner ? ` · made by ${who(s.made_by)}` : ""}</span>
                </div>
                <div className="sk2-row-action" onClick={(e) => e.stopPropagation()}>
                  {s.owner ? <button className="btn sm" onClick={() => share(s)}><i className="ri-team-line" />Share with the team</button>
                    : <button className="btn sm" onClick={() => toggleDefault(s)}>{s.default_on ? "Make per chat" : "Make standard"}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {!form && !importing && <Err error={err} />}

      <Drawer open={!!form} onClose={closeForm} wide icon={<i className="ri-magic-line" />}
        title={form?.editing ? form.name : "New skill"} sub={form?.editing ? <span className="mono">/{form.slug}</span> : "Instructions a helper follows, in plain words."}
        footer={form && (
          <>
            {form.editing && <button className="btn quiet" onClick={remove}><i className="ri-delete-bin-line" />Delete</button>}
            <span className="sp" />
            <button className="btn" onClick={closeForm}>Cancel</button>
            <button className="btn primary" disabled={!form.name.trim() || !form.body.trim() || busy === "save"} onClick={save}>{busy === "save" ? "Saving…" : form.editing ? "Save changes" : "Create skill"}</button>
          </>
        )}>
        {form && (
          <>
            <div className="dw-sec">
              <label style={{ marginTop: 0 }}>Name</label>
              <input value={form.name} onChange={(e) => set({ name: e.target.value, ...(form.editing ? {} : { slug: slugify(e.target.value) }) })} placeholder="e.g. Weekly newsletter" />
              {!form.editing && form.slug && <p className="dw-help">Use it in chat with <span className="mono">/{form.slug}</span></p>}
              <label>When to use it</label>
              <input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Writing the Friday newsletter for customers" />
              <p className="dw-help">Helpers read this to decide when the skill fits.</p>
            </div>
            <div className="dw-sec">
              <div className="acts" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>Instructions</h3>
                <div className="seg">
                  <button type="button" className={tab === "write" ? "on" : ""} onClick={() => setTab("write")}>Write</button>
                  <button type="button" className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>Preview</button>
                </div>
              </div>
              {tab === "write" ? (
                <textarea className="skill-body" value={form.body} onChange={(e) => set({ body: e.target.value })}
                  placeholder={"Steps, rules and examples, in plain words."} />
              ) : <div className="skill-preview">{form.body.trim() ? <Markdown text={form.body} /> : <p className="small">Nothing written yet.</p>}</div>}
              <p className="dw-help">Markdown works: headings, lists, **bold**, code blocks.</p>
            </div>
            <div className="dw-sec">
              <div className="togrow" onClick={() => set({ default_on: !form.default_on })}>
                <span className="t"><b>Standard for everyone</b><span>Every helper follows it in every chat and job. Otherwise switch it on when you need it.</span></span>
                <span className={`switch ${form.default_on ? "on" : ""}`} role="switch" aria-checked={form.default_on}><i /></span>
              </div>
            </div>
            <Err error={err} />
          </>
        )}
      </Drawer>

      <Drawer open={importing} onClose={closeImport} icon={<i className="ri-download-2-line" />} title="Skill from The Agency"
        sub="Turn a specialist's playbook into a skill any helper can use."
        footer={<><span className="small">About 280 specialists, MIT license</span><span className="sp" /><button className="btn" onClick={closeImport}>Close</button></>}>
        <div className="dw-sec">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: SEO, code review, pitch deck…" aria-label="Search specialists" />
          <div style={{ marginTop: 10 }}>
            {found === null ? <p className="small">Loading…</p> : found.length === 0 ? <p className="small">Nothing found.</p> : found.map((t) => (
              <div key={t.slug} className="togrow" style={{ cursor: "default" }}>
                <span className="emoji">{t.emoji || "✦"}</span>
                <span className="t"><b>{t.name}</b><span className="clamp">{t.description}</span></span>
                <button className="btn sm" disabled={!!busy} onClick={() => importTalent(t)}>{busy === t.slug ? "Adding…" : "Add"}</button>
              </div>
            ))}
          </div>
          <Err error={err} />
        </div>
      </Drawer>
    </div>
  );
}
