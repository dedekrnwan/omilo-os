/* Office sprites: each helper is drawn as its own Saga mascot (same body, face, colour and prop as everywhere else
   in Saga OS), as a small sprite sheet: 4 directions × (4 walk frames, 2 idle frames, 2 working frames). */

export const FW = 64, FH = 80;           // frame size on the canvas (drawn at 2×, shown at half size)
export const DIRS = ["down", "left", "right", "up"] as const;
export type Dir = (typeof DIRS)[number];
export const COLS = 8;                    // walk0..3, idle0..1, work0..1
const INK = "#1c1917";

export type SpriteLook = { color: string; shape: string; prop: string };

function shade(hex: string, k: number) {
  const n = parseInt(hex.replace("#", ""), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(k >= 1 ? v + (255 - v) * (k - 1) : v * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function bodyPath(shape: string): Path2D {
  if (shape === "box") { const p = new Path2D(); p.roundRect(13, 18, 38, 51, 13); return p; }
  if (shape === "bean") { const p = new Path2D(); p.ellipse(32, 44, 20, 26, 0, 0, Math.PI * 2); return p; }
  return new Path2D("M10 64 C10 34 19 16 32 16 C45 16 54 34 54 64 Q54 70 48 70 L16 70 Q10 70 10 64 Z");
}

function face(ctx: CanvasRenderingContext2D, dir: Dir, blink: boolean) {
  if (dir === "up") return;
  const dx = dir === "left" ? -6 : dir === "right" ? 6 : 0;
  const eyes = dir === "down" ? [25, 39] : dir === "left" ? [21 + 2, 33 + 1] : [31 - 1, 43 - 2];
  ctx.fillStyle = INK;
  for (const ex of eyes) {
    if (blink) { ctx.fillRect(ex - 3.5, 33.5, 7, 2); continue; }
    ctx.beginPath(); ctx.arc(ex, 34, 3.6, 0, Math.PI * 2); ctx.fill();
  }
  if (!blink) {
    ctx.fillStyle = "#fff";
    for (const ex of eyes) { ctx.beginPath(); ctx.arc(ex + 1.2, 32.8, 1.2, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.strokeStyle = INK; ctx.lineWidth = 2.2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(27.5 + dx, 42.5); ctx.quadraticCurveTo(32 + dx, 47, 36.5 + dx, 42.5); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.3)";
  for (const cx of dir === "down" ? [20.5, 43.5] : [32 + dx * 2.2]) { ctx.beginPath(); ctx.arc(cx, 41, 2.6, 0, Math.PI * 2); ctx.fill(); }
}

function prop(ctx: CanvasRenderingContext2D, p: string, dir: Dir) {
  const front = dir !== "up";
  ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = INK;
  const fillStroke = (d: string, fill: string, w = 1.5) => { const path = new Path2D(d); ctx.fillStyle = fill; ctx.fill(path); ctx.lineWidth = w; ctx.stroke(path); };
  switch (p) {
    case "crown": fillStroke("M21 19 L23.5 8.5 L28.5 14 L32 7 L35.5 14 L40.5 8.5 L43 19 Z", "#facc15", 1.6); break;
    case "spark": fillStroke("M32 0.5 C33 6 34.3 7.4 39.5 8.3 C34.3 9.2 33 10.6 32 16 C31 10.6 29.7 9.2 24.5 8.3 C29.7 7.4 31 6 32 0.5 Z", "#f59e0b", 1.4); break;
    case "antenna":
      ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(32, 16); ctx.lineTo(32, 8); ctx.stroke();
      ctx.fillStyle = "#f43f5e"; ctx.beginPath(); ctx.arc(32, 7, 3, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1.4; ctx.stroke(); break;
    case "sprout":
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(32, 17); ctx.lineTo(32, 10); ctx.stroke();
      fillStroke("M32 12 C26 12 23 8 23 5 C29 5 32 8 32 12 Z", "#4ade80"); fillStroke("M32 11 C37 11 40 7.5 40 5 C35 5 32 7.5 32 11 Z", "#22c55e"); break;
    case "beret": { ctx.fillStyle = INK; ctx.fill(new Path2D("M17 22 C17 13 47 11 49 20 C49 24 17 26 17 22 Z")); ctx.beginPath(); ctx.arc(33, 12.5, 2, 0, Math.PI * 2); ctx.fill(); break; }
    case "headset":
      ctx.lineWidth = 2.6; ctx.beginPath(); ctx.arc(32, 36, 18, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(10.5, 33, 6, 10, 3); ctx.fill(); ctx.beginPath(); ctx.roundRect(47.5, 33, 6, 10, 3); ctx.fill();
      if (front) { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(50, 42); ctx.quadraticCurveTo(48, 50, 38, 50); ctx.stroke(); } break;
    case "glasses":
      if (!front) break;
      { const dx = dir === "left" ? -4 : dir === "right" ? 4 : 0; ctx.lineWidth = 2; ctx.fillStyle = "rgba(255,255,255,.25)";
        for (const cx of dir === "down" ? [25, 39] : [32 + dx - 6, 32 + dx + 6]) { ctx.beginPath(); ctx.arc(cx, 34, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } }
      break;
    case "tie": if (front) fillStroke("M29.5 51 h5 l-1 3 l3 9 l-4.5 4 l-4.5 -4 l3 -9 Z", "#dc2626", 1.3); break;
    case "coin":
      if (!front) break;
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.arc(50, 52, 8, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = INK; ctx.font = "700 11px ui-sans-serif, system-ui"; ctx.textAlign = "center"; ctx.fillText("$", 50, 56); break;
    case "megaphone": if (front) { fillStroke("M45 47 L58 40 L58 56 L45 50 Z", "#fff", 1.6); } break;
    case "gear":
      ctx.save(); ctx.translate(50, 52);
      fillStroke("M-2 -9 h4 l1 3 l3 -1.5 l2.6 2.6 l-1.5 3 l3 1 v4 l-3 1 l1.5 3 l-2.6 2.6 l-3 -1.5 l-1 3 h-4 l-1 -3 l-3 1.5 l-2.6 -2.6 l1.5 -3 l-3 -1 v-4 l3 -1 l-1.5 -3 l2.6 -2.6 l3 1.5 Z", "#e7e5e4", 1.4);
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.restore(); break;
    case "magnifier":
      if (!front) break;
      ctx.lineWidth = 2.2; ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.beginPath(); ctx.arc(49, 49, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(53.5, 53.5); ctx.lineTo(59, 59); ctx.stroke(); break;
  }
}

/** Draws one frame at (x, y) on ctx. kind: walk (0..3), idle (0..1), work (0..1). */
function frame(ctx: CanvasRenderingContext2D, x: number, y: number, look: SpriteLook, dir: Dir, kind: "walk" | "idle" | "work", i: number) {
  ctx.save();
  ctx.translate(x, y);
  const sitting = kind === "work" || (kind === "idle" && dir === "up");
  const bob = kind === "walk" ? [0, -3, 0, -3][i] : kind === "work" ? [0, -2][i] : 0;
  const squash = kind === "idle" ? [1, 0.975][i] : 1;
  const step = kind === "walk" ? [4, 0, -4, 0][i] : 0;
  // shadow
  ctx.fillStyle = "rgba(20,18,40,.32)";
  ctx.beginPath(); ctx.ellipse(32, 74, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
  // feet (hidden when sitting at a desk)
  if (!sitting) {
    ctx.fillStyle = shade(look.color, 0.5); ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
    if (dir === "left" || dir === "right") {
      ctx.beginPath(); ctx.ellipse(32 + step, 71, 6, 3.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(32 - step, 71.5, 6, 3.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.ellipse(23, 71 - Math.max(0, step) * 0.6, 6, 3.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(41, 71 - Math.max(0, -step) * 0.6, 6, 3.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.translate(0, bob + (sitting ? 3 : 0));
  // body, squashed from the bottom when breathing
  ctx.translate(32, 70); ctx.scale(squash < 1 ? 1.015 : 1, squash); ctx.translate(-32, -70);
  const body = bodyPath(look.shape);
  const g = ctx.createLinearGradient(0, 16, 0, 70);
  g.addColorStop(0, shade(look.color, 1.12)); g.addColorStop(0.7, look.color); g.addColorStop(1, shade(look.color, 0.8));
  // a white rim and a dark outline keep every helper readable on any floor
  ctx.lineJoin = "round"; ctx.lineWidth = 7; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.stroke(body);
  ctx.fillStyle = g; ctx.fill(body);
  ctx.lineWidth = 2.6; ctx.strokeStyle = INK; ctx.stroke(body);
  ctx.save(); ctx.clip(body);
  ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.beginPath(); ctx.ellipse(dir === "right" ? 38 : 24, 26, 7, 5, -0.5, 0, Math.PI * 2); ctx.fill();
  if (dir === "up") { ctx.fillStyle = "rgba(0,0,0,.06)"; ctx.fillRect(10, 52, 44, 20); }
  ctx.restore();
  // hands on the keyboard while working (seen from behind)
  if (kind === "work") {
    ctx.fillStyle = shade(look.color, 0.85); ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(13, 42 + (i ? -3 : 1), 4.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(51, 42 + (i ? 1 : -3), 4.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  face(ctx, dir, kind === "idle" && i === 1 && dir === "down");
  prop(ctx, look.prop, dir);
  ctx.restore();
}

/** A full sheet: rows = DIRS, cols = walk0..3, idle0..1, work0..1. */
export function drawSheet(canvas: HTMLCanvasElement, look: SpriteLook) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  DIRS.forEach((dir, r) => {
    for (let c = 0; c < COLS; c++) {
      const kind = c < 4 ? "walk" : c < 6 ? "idle" : "work";
      frame(ctx, c * FW, r * FH, look, dir, kind, c < 4 ? c : c < 6 ? c - 4 : c - 6);
    }
  });
}

export const frameIndex = (dir: Dir, col: number) => DIRS.indexOf(dir) * COLS + col;
