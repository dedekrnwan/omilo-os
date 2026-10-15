"use client";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Marked, type Tokens } from "marked";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BASE } from "@/lib/api";

/* Rich rendering for helper replies: highlighted code with copy, pretty JSON, tables, image and file previews, downloads. */

for (const [n, l] of Object.entries({ bash, css, dart, diff, dockerfile, go, ini, javascript, json, markdown, python, sql, typescript, xml, yaml })) hljs.registerLanguage(n, l);
const ALIAS: Record<string, string> = { sh: "bash", shell: "bash", zsh: "bash", console: "bash", js: "javascript", jsx: "javascript", mjs: "javascript",
  ts: "typescript", tsx: "typescript", py: "python", yml: "yaml", html: "xml", htm: "xml", svg: "xml", toml: "ini", env: "ini", md: "markdown",
  golang: "go", patch: "diff", docker: "dockerfile", jsonl: "json", text: "plaintext", txt: "plaintext", log: "plaintext", csv: "plaintext" };
const LABEL: Record<string, string> = { bash: "Terminal", javascript: "JavaScript", typescript: "TypeScript", python: "Python", json: "JSON", go: "Go",
  dart: "Dart", sql: "SQL", yaml: "YAML", xml: "HTML", css: "CSS", diff: "Diff", markdown: "Markdown", ini: "Config", dockerfile: "Dockerfile" };

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const langOf = (l: string) => { const k = (l || "").trim().split(/\s/)[0].toLowerCase(); return ALIAS[k] || k; };

export function prettyJson(src: string): string | null {
  const t = src.trim();
  if (!/^[[{]/.test(t)) return null;
  try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* maybe JSON lines */ }
  const lines = t.split("\n").filter(Boolean);
  try { return lines.map((l) => JSON.stringify(JSON.parse(l))).join("\n"); } catch { return null; }
}

export function highlight(src: string, lang: string): { html: string; lang: string } {
  let l = langOf(lang);
  if (l === "json" || (!l && /^\s*[[{]/.test(src))) { const p = prettyJson(src); if (p) { src = p; l = "json"; } }
  if (l && l !== "plaintext" && hljs.getLanguage(l)) return { html: hljs.highlight(src, { language: l, ignoreIllegals: true }).value, lang: l };
  if (!l && src.length < 20000) {
    const a = hljs.highlightAuto(src, ["bash", "python", "javascript", "typescript", "json", "go", "sql", "yaml", "dart", "xml", "css"]);
    if (a.relevance >= 6 && a.language) return { html: a.value, lang: a.language };
  }
  return { html: esc(src), lang: l || "" };
}

/* ------------------------------------------------------------------ file links */
export type FileRef = { url: string; name: string; mime?: string; size?: number };
const FILE_PATH = /^(~|\/)[^\s`"'<>]*[^\s`"'<>/]\.[A-Za-z0-9]{1,8}$/;
export const fsUrl = (path: string) => `${BASE}/api/fs/file?path=${encodeURIComponent(path)}`;
export const fileUrl = (id: string) => `${BASE}/api/files/${id}`;
export const dlUrl = (url: string) => url + (url.includes("?") ? "&" : "?") + "download=1";
const shortPath = (p: string) => { const parts = p.split("/").filter(Boolean); return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p; };
const baseName = (p: string) => decodeURIComponent(p.split(/[\\/]/).pop() || p);

function fileHref(href: string): FileRef | null {
  if (/^\/api\/files\/fil_[0-9a-f]{16}$/.test(href)) return { url: BASE + href, name: "" };
  if (href.startsWith("file://")) { const p = decodeURI(href.slice(7)); return { url: fsUrl(p), name: baseName(p) }; }
  if (FILE_PATH.test(href) && !href.startsWith("/api/")) return { url: fsUrl(href), name: baseName(href) };
  return null;
}

export function fileIcon(name: string, mime = ""): string {
  const e = name.split(".").pop()?.toLowerCase() || "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(e)) return "ri-image-line";
  if (e === "pdf") return "ri-file-pdf-2-line";
  if (["csv", "tsv", "xlsx", "xls"].includes(e)) return "ri-file-excel-2-line";
  if (["doc", "docx"].includes(e)) return "ri-file-word-2-line";
  if (["ppt", "pptx", "key"].includes(e)) return "ri-file-ppt-2-line";
  if (["zip", "tgz", "gz", "tar", "rar", "7z"].includes(e)) return "ri-file-zip-line";
  if (["mp4", "mov", "webm"].includes(e)) return "ri-film-line";
  if (["mp3", "wav", "m4a", "ogg"].includes(e)) return "ri-music-2-line";
  if (["json", "py", "js", "ts", "tsx", "go", "dart", "sh", "sql", "yaml", "yml", "html", "css", "rs", "java", "kt", "swift"].includes(e)) return "ri-file-code-line";
  if (["md", "txt", "log"].includes(e)) return "ri-file-text-line";
  return "ri-file-3-line";
}
export const fmtSize = (n?: number) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const cardHtml = (f: FileRef, label?: string) =>
  `<span class="fcard" role="button" tabindex="0" data-act="preview" data-url="${esc(f.url)}" data-name="${esc(f.name || label || "file")}">` +
  `<i class="${fileIcon(f.name || label || "")}"></i><span class="fn-t"><b>${esc(label || f.name || "file")}</b><small>${esc((f.name.split(".").pop() || "").toUpperCase())}</small></span>` +
  `<a class="fdl" href="${esc(dlUrl(f.url))}" download data-act="dl" aria-label="Download ${esc(f.name)}"><i class="ri-download-2-line"></i></a></span>`;

/* ------------------------------------------------------------------ markdown */
const safeUrl = (h: string) => /^(https?:|mailto:)/i.test(h) || (h.startsWith("/") && !h.startsWith("//"));

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    // agents never inject raw HTML: show it as text instead of dropping it (keeps things like List<String> readable)
    html({ text }: Tokens.HTML | Tokens.Tag) { return esc(text); },
    code({ text, lang }: Tokens.Code) {
      const h = highlight(text, lang || "");
      const n = text.split("\n").length;
      const label = LABEL[h.lang] || (h.lang ? h.lang.toUpperCase() : "Text");
      return `<div class="codeblock${n > 22 ? " long" : ""}"><div class="cb-head"><span>${esc(label)}</span><span class="sp"></span>` +
        (n > 22 ? `<button type="button" data-act="expand">Show all ${n} lines</button>` : "") +
        `<button type="button" data-act="copy"><i class="ri-file-copy-line"></i>Copy</button></div><pre><code class="hljs">${h.html}</code></pre></div>`;
    },
    codespan({ text }: Tokens.Codespan) {
      // marked hands codespan text already escaped
      const raw = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (FILE_PATH.test(raw)) return `<code class="fpath" role="button" tabindex="0" data-act="preview" data-url="${esc(fsUrl(raw))}" data-name="${esc(baseName(raw))}" title="${esc(raw)}"><i class="ri-file-3-line"></i>${esc(shortPath(raw))}</code>`;
      return `<code>${text}</code>`;
    },
    link(this: any, { href, title, tokens }: Tokens.Link) {
      const inner = this.parser.parseInline(tokens);
      const f = fileHref(href);
      if (f) return cardHtml(f, inner.replace(/<[^>]+>/g, "") || f.name);
      if (!safeUrl(href)) return inner;
      return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""} target="_blank" rel="noopener noreferrer">${inner}</a>`;
    },
    image({ href, text }: Tokens.Image) {
      const f = fileHref(href);
      const url = f ? f.url : safeUrl(href) ? href : null;
      if (!url) return esc(text || "");
      return `<span class="mdimg" role="button" tabindex="0" data-act="preview" data-url="${esc(url)}" data-name="${esc(text || baseName(href))}" data-kind="image"><img src="${esc(url)}" alt="${esc(text || "")}" loading="lazy"></span>`;
    },
  },
});

export function renderMarkdown(text: string): string {
  let src = text || "";
  // a whole reply that is JSON (no fence) still renders as a pretty block
  if (prettyJson(src) && !src.includes("```")) src = "```json\n" + src.trim() + "\n```";
  const out = md.parse(src, { async: false }) as string;
  return out.replace(/<table>/g, '<div class="mdtable"><table>').replace(/<\/table>/g, "</table></div>");
}

/* ------------------------------------------------------------------ previews (one host for the whole app) */
export function openPreview(f: FileRef & { kind?: string }) {
  window.dispatchEvent(new CustomEvent("saga:preview", { detail: f }));
}

function onRichClick(e: React.MouseEvent | React.KeyboardEvent) {
  if ("key" in e && e.key !== "Enter" && e.key !== " ") return;
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "dl") { e.stopPropagation(); return; } // let the browser download
  e.preventDefault();
  if (act === "copy") {
    const code = el.closest(".codeblock")?.querySelector("code")?.textContent || "";
    navigator.clipboard?.writeText(code).then(() => {
      const old = el.innerHTML; el.innerHTML = '<i class="ri-check-line"></i>Copied'; setTimeout(() => { el.innerHTML = old; }, 1400);
    }).catch(() => {});
  } else if (act === "expand") {
    const b = el.closest(".codeblock"); b?.classList.toggle("open");
    el.textContent = b?.classList.contains("open") ? "Show less" : el.textContent!.replace("Show less", "Show all");
  } else if (act === "preview") {
    openPreview({ url: el.dataset.url!, name: el.dataset.name || "file", kind: el.dataset.kind });
  }
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="md" onClick={onRichClick} onKeyDown={onRichClick} dangerouslySetInnerHTML={{ __html: html }} />;
}

/* files attached to a message (uploads, or shared by a helper) */
type Block = { type: string; id?: string; name?: string; mime?: string; size?: number };
export function Attachments({ blocks }: { blocks?: Block[] }) {
  const files = (blocks || []).filter((b) => b.type === "file" && b.id);
  if (!files.length) return null;
  const imgs = files.filter((f) => f.mime?.startsWith("image/") && !f.mime.includes("svg"));
  const rest = files.filter((f) => !imgs.includes(f));
  return (
    <div className="atts">
      {imgs.length > 0 && <div className="atts-img">{imgs.map((f) => (
        <button key={f.id} type="button" className="mdimg" onClick={() => openPreview({ url: fileUrl(f.id!), name: f.name!, mime: f.mime, size: f.size, kind: "image" })}>
          <img src={fileUrl(f.id!)} alt={f.name} loading="lazy" /></button>
      ))}</div>}
      {rest.map((f) => <FileCard key={f.id} f={{ url: fileUrl(f.id!), name: f.name || "file", mime: f.mime, size: f.size }} />)}
    </div>
  );
}

export function FileCard({ f }: { f: FileRef }) {
  return (
    <span className="fcard" role="button" tabIndex={0} onClick={(e) => { if (!(e.target as HTMLElement).closest(".fdl")) openPreview(f); }}
      onKeyDown={(e) => { if (e.key === "Enter") openPreview(f); }}>
      <i className={fileIcon(f.name, f.mime)} />
      <span className="fn-t"><b>{f.name}</b><small>{[(f.name.split(".").pop() || "").toUpperCase(), fmtSize(f.size)].filter(Boolean).join(" · ")}</small></span>
      <a className="fdl" href={dlUrl(f.url)} download aria-label={`Download ${f.name}`}><i className="ri-download-2-line" /></a>
    </span>
  );
}

const IMG = ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"];
const VIDEO = ["mp4", "webm", "mov", "m4v"];
const AUDIO = ["mp3", "wav", "m4a", "ogg", "oga", "flac"];
const TEXT = ["txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "log", "yaml", "yml", "toml", "ini", "py", "js", "mjs", "ts", "tsx", "jsx", "go", "dart",
  "rs", "java", "kt", "swift", "rb", "php", "sh", "sql", "html", "htm", "css", "scss", "xml", "svg", "diff", "patch", "c", "h", "cpp", "cs", "vue", "env", "gradle"];

function kindOf(f: FileRef & { kind?: string }): string {
  if (f.kind) return f.kind;
  const e = f.name.split(".").pop()?.toLowerCase() || "";
  if (f.mime?.startsWith("image/") && !f.mime.includes("svg")) return "image";
  if (IMG.includes(e)) return "image";
  if (e === "pdf" || f.mime === "application/pdf") return "pdf";
  if (VIDEO.includes(e)) return "video";
  if (AUDIO.includes(e)) return "audio";
  if (TEXT.includes(e) || f.mime?.startsWith("text/") || f.mime === "application/json" || !e.length) return "text";
  return "other";
}

function csvTable(src: string, sep: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < src.length && rows.length < 501; i++) {
    const c = src[i];
    if (q) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function TextPreview({ f }: { f: FileRef }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let off = false;
    fetch(f.url, { credentials: "same-origin" }).then(async (r) => {
      if (!r.ok) throw new Error(r.status === 404 ? "This file is not in a shared folder or a helper's workspace, or it was moved." : `Could not open it (${r.status}).`);
      const t = await r.text();
      if (!off) setSrc(t.length > 600_000 ? t.slice(0, 600_000) + "\n\n… (cut: download for the full file)" : t);
    }).catch((e) => !off && setErr(e.message));
    return () => { off = true; };
  }, [f.url]);
  if (err) return <div className="pv-msg">{err}</div>;
  if (src === null) return <div className="pv-msg"><span className="spin" /> Loading…</div>;
  const e = f.name.split(".").pop()?.toLowerCase() || "";
  if (e === "md" || e === "markdown") return <div className="pv-doc"><Markdown text={src} /></div>;
  if (e === "csv" || e === "tsv") {
    const rows = csvTable(src, e === "tsv" ? "\t" : ",");
    return (
      <div className="pv-doc"><div className="mdtable"><table>
        <thead><tr>{(rows[0] || []).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{rows.slice(1, 500).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table></div>{rows.length > 500 && <p className="small">First 500 rows. Download for the rest.</p>}</div>
    );
  }
  const h = highlight(src, e === "json" || e === "jsonl" ? "json" : e);
  return <div className="codeblock open pv-code"><pre><code className="hljs" dangerouslySetInnerHTML={{ __html: h.html }} /></pre></div>;
}

export function PreviewHost() {
  const [f, setF] = useState<(FileRef & { kind?: string }) | null>(null);
  const close = useCallback(() => setF(null), []);
  useEffect(() => {
    const on = (e: Event) => setF((e as CustomEvent).detail);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setF(null); };
    window.addEventListener("saga:preview", on); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("saga:preview", on); window.removeEventListener("keydown", key); };
  }, []);
  if (!f) return null;
  const kind = kindOf(f);
  return (
    <div className="pv-back" onClick={close}>
      <div className="pv" role="dialog" aria-label={`Preview of ${f.name}`} onClick={(e) => e.stopPropagation()}>
        <div className="pv-head">
          <i className={fileIcon(f.name, f.mime)} /><b>{f.name}</b>{f.size != null && <span className="small">{fmtSize(f.size)}</span>}
          <span className="sp" />
          <a className="btn sm" href={f.url} target="_blank" rel="noreferrer"><i className="ri-external-link-line" />Open</a>
          <a className="btn sm primary" href={dlUrl(f.url)} download><i className="ri-download-2-line" />Download</a>
          <button className="iconbtn" aria-label="Close preview" onClick={close}><i className="ri-close-line" /></button>
        </div>
        <div className="pv-body">
          {kind === "image" && <img className="pv-img" src={f.url} alt={f.name} />}
          {kind === "pdf" && <iframe className="pv-frame" src={f.url} title={f.name} />}
          {kind === "video" && <video className="pv-img" src={f.url} controls />}
          {kind === "audio" && <div className="pv-msg"><audio src={f.url} controls /></div>}
          {kind === "text" && <TextPreview f={f} />}
          {kind === "other" && <div className="pv-msg"><i className={fileIcon(f.name)} style={{ fontSize: 32 }} /><span>No preview for this kind of file.</span>
            <a className="btn primary" href={dlUrl(f.url)} download><i className="ri-download-2-line" />Download {f.name}</a></div>}
        </div>
      </div>
    </div>
  );
}
