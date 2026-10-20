"use client";
import Link from "next/link";
import { usePageActions } from "@/components/PageActions";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Err } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { api } from "@/lib/api";
import { copy, menu, sep } from "@/lib/menu";

/* The talent library: specialists from The Agency (github.com/msitarzewski/agency-agents, MIT).
   Browse, read a specialist's playbook, hire them as a helper in one click. */

type Agent = { slug: string; division: string; name: string; description: string; emoji: string; color: string; vibe: string; words: number; hired_as?: string | null };
type Division = { key: string; label: string; color: string; count: number };
type Library = { source: { repo: string; license: string; synced_at: number | null; count: number; sync: { state: string; message: string } };
  divisions: Division[]; agents: Agent[] };

export default function Talent() {
  const router = useRouter();
  const [lib, setLib] = useState<Library | null>(null);
  const [q, setQ] = useState("");
  const [div, setDiv] = useState("");
  const [open, setOpen] = useState<(Agent & { body?: string }) | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams(); if (q) p.set("q", q); if (div) p.set("division", div);
      setLib(await api<Library>(`/talent?${p}`));
    } catch (e: any) { setErr(e.message); }
  }, [q, div]);
  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => {  // first visit: the roster downloads in the background
    if (lib?.source.sync.state !== "running") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [lib?.source.sync.state, load]);

  const show = async (a: Agent) => {
    setOpen(a); setName(a.name); setErr(null);
    try { const full = await api<Agent & { body: string }>(`/talent/${a.slug}`); setOpen(full); } catch (e: any) { setErr(e.message); }
  };
  const hire = async () => {
    if (!open) return;
    setBusy(true); setErr(null);
    try {
      const st = await api<{ id: string }>(`/talent/${open.slug}/hire`, { body: { name: name.trim() || undefined } });
      router.push(`/staff/?id=${st.id}&hired=1`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const items = (a: Agent) => [
    { heading: a.name },
    { label: "Read the profile", icon: "ri-file-user-line", onSelect: () => show(a) },
    a.hired_as ? { label: "Open the helper", icon: "ri-user-3-line", href: `/staff/?id=${a.hired_as}` }
      : { label: `Hire ${a.name}`, icon: "ri-user-add-line", onSelect: async () => { try { const st = await api<{ id: string }>(`/talent/${a.slug}/hire`, { body: {} }); router.push(`/staff/?id=${st.id}&hired=1`); } catch (e: any) { setErr(e.message); } } },
    { label: "Make it a skill", icon: "ri-magic-line", hint: "a playbook any helper can follow", onSelect: async () => { try { await api(`/skills/from-talent/${a.slug}`, { body: {} }); router.push("/skills/"); } catch (e: any) { setErr(e.message); } } },
    sep,
    { label: `More in ${divLabel(a.division)}`, icon: "ri-filter-3-line", onSelect: () => setDiv(a.division) },
    { label: "Copy the description", icon: "ri-file-copy-line", onSelect: () => copy(`${a.name}: ${a.description || ""}`) },
  ];
  const update = async () => { await api("/talent/sync", { body: {} }); load(); };

  const divLabel = (k: string) => lib?.divisions.find((d) => d.key === k)?.label || k;
  const divColor = (k: string) => lib?.divisions.find((d) => d.key === k)?.color || "var(--faint)";
  const syncing = lib?.source.sync.state === "running";
  usePageActions({ more: [{ label: syncing ? "Updating the roster…" : "Update the roster", icon: "ri-refresh-line", disabled: syncing, hint: "from GitHub", onSelect: update }] }, [syncing]);

  return (
    <div>
      {/* Page Header v2 */}
      <div className="ph2">
        <div className="ph2-text">
          <h1 className="ph2-title">Hire a specialist</h1>
          <p className="ph2-sub">
            {lib?.source.count ? `${lib.source.count} specialists` : "Specialists"} from The Agency — each with its own personality, process and deliverables.
            Hired specialists sleep until they get work, so they cost nothing while idle.
          </p>
        </div>
      </div>

      {/* Tab strip — mirrors Team's tabs; Hire specialists is the active tab */}
      <div className="team2-tabs">
        <Link href="/staff/" className="team2-tab">
          <i className="ri-group-line" />Helpers
        </Link>
        <span className="team2-tab on">
          <i className="ri-store-2-line" />Hire specialists
        </span>
      </div>

      <Err error={err && !open ? err : null} />

      {/* Two-column layout: categories sidebar + main content */}
      <div className="hire2-body">
        {/* Left: category filter */}
        {lib && lib.divisions.length > 0 && (
          <nav className="hire2-cats" aria-label="Division filter">
            <button className={`hire2-cat${div === "" ? " on" : ""}`} onClick={() => setDiv("")}>
              <span className="dot" style={{ background: "var(--faint)" }} />
              <span className="hire2-cat-label">All</span>
              <span className="hire2-cat-count mono">{lib.source.count}</span>
            </button>
            {lib.divisions.map((d) => (
              <button key={d.key} className={`hire2-cat${div === d.key ? " on" : ""}`} onClick={() => setDiv(div === d.key ? "" : d.key)}>
                <span className="dot" style={{ background: d.color }} />
                <span className="hire2-cat-label">{d.label}</span>
                <span className="hire2-cat-count mono">{d.count}</span>
              </button>
            ))}
          </nav>
        )}

        {/* Right: search + agent grid */}
        <div className="hire2-main">
          {/* Search bar */}
          <div className="hire2-search">
            <i className="ri-search-line hire2-search-icon" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search: content, SEO, sales, React, finance…"
              className="hire2-search-input"
              autoFocus
            />
          </div>

          {!lib ? (
            <p className="small">Loading…</p>
          ) : lib.source.count === 0 ? (
            <div className="empty">
              <b>{syncing ? "Getting the roster from GitHub…" : lib.source.sync.state === "failed" ? "Could not download the roster" : "The roster is not loaded yet"}</b>
              <span>{syncing ? "This takes a few seconds the first time." : lib.source.sync.message}</span>
              {!syncing && <div style={{ marginTop: 12 }}><button className="btn primary" onClick={update}>Download the roster</button></div>}
            </div>
          ) : lib.agents.length === 0 ? (
            <div className="empty"><b>No specialist matches</b><span>Try another word or division.</span></div>
          ) : (
            <>
              {/* All specialists */}
              <div className="hire2-section-head">
                <span className="hire2-section-title">{div ? divLabel(div) : "All specialists"}</span>
                <span className="hire2-section-count mono">{lib.agents.length}</span>
              </div>
              <div className="hire2-grid">
                {lib.agents.map((a) => (
                  <button
                    key={a.slug}
                    className="hire2-card"
                    onClick={() => show(a)}
                    onContextMenu={menu(() => items(a))}
                  >
                    <div className="hire2-card-top">
                      <span className="emoji">{a.emoji || "✦"}</span>
                      <span className="hire2-card-text">
                        <b className="hire2-card-name">{a.name}</b>
                        <span className="hire2-card-cat small">
                          <span className="dot" style={{ background: divColor(a.division) }} />
                          {divLabel(a.division)}
                        </span>
                      </span>
                      {a.hired_as && <span className="chip up" style={{ marginLeft: "auto", flexShrink: 0 }}>Hired</span>}
                    </div>
                    <p className="hire2-card-desc small">{a.description}</p>
                    <div className="hire2-card-foot">
                      <span className="sp" />
                      <span className="btn sm primary hire2-hire-btn"><i className="ri-user-add-line" />Hire</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="small" style={{ marginTop: 24, color: "var(--muted)" }}>
            Specialists from <a href={lib?.source.repo || "https://github.com/msitarzewski/agency-agents"} target="_blank" rel="noopener noreferrer">The Agency</a> by msitarzewski and contributors, MIT License.
          </p>
        </div>
      </div>

      {/* Agent drawer */}
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(null)} />
          <aside className="drawer" aria-label={open.name}>
            <div className="topbar">
              <span className="emoji">{open.emoji || "✦"}</span>
              <span className="crumb">{open.name}</span>
              <span className="sp" />
              <button className="iconbtn" aria-label="Close" onClick={() => setOpen(null)}><i className="ri-close-line" /></button>
            </div>
            <div className="scroll" style={{ padding: "16px 20px" }}>
              <p className="small" style={{ marginTop: 0 }}><span className="dot" style={{ background: divColor(open.division) }} />{divLabel(open.division)}</p>
              <p style={{ margin: "0 0 6px" }}>{open.description}</p>
              {open.vibe && <p className="small" style={{ fontStyle: "italic" }}>&ldquo;{open.vibe}&rdquo;</p>}
              <div className="soft" style={{ margin: "14px 0" }}>
                <div className="small"><i className="ri-shield-check-line" /> Hired specialists follow your Omilo rules: anything that leaves the company waits for your approval.</div>
              </div>
              {open.body ? <Markdown text={open.body} /> : <p className="small">Loading the playbook…</p>}
            </div>
            <div style={{ borderTop: "1px solid var(--line)", padding: 12 }}>
              {open.hired_as && <p className="small" style={{ margin: "0 0 8px" }}>Already on your team as <a href={`/staff/?id=${open.hired_as}`}>{open.hired_as}</a>. Hiring again adds another one.</p>}
              <div className="acts" style={{ flexWrap: "nowrap" }}>
                <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name on your team" placeholder="Name on your team" />
                <button className="btn primary" onClick={hire} disabled={busy}><i className="ri-user-add-line" />{busy ? "Hiring…" : "Hire"}</button>
              </div>
              <div className="acts" style={{ marginTop: 8 }}>
                <button
                  className="btn quiet"
                  onClick={async () => {
                    if (!open) return;
                    try { await api(`/skills/from-talent/${open.slug}`, { body: {} }); router.push("/skills/"); }
                    catch (e: any) { setErr(e.message); }
                  }}
                >
                  <i className="ri-magic-line" />Turn into a skill
                </button>
              </div>
              <Err error={err} />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
