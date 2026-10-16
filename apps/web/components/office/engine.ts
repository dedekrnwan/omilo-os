/* The Office renderer (Phaser 3). Loaded only in the browser (dynamic import), never during the static build.

   It draws the Tiled map, one animated mascot per helper at its own desk, and animates only verified events from the
   shared office store: a job starting (sits down, types), a tool call (bubble + monitor flash), a handoff (walks to the
   other helper's desk), an approval request (walks to the approvals desk), done / failed bursts. The steady look of
   each helper (working, waiting on you, failed, up next, idle, paused) always follows the authoritative state. */
import * as Phaser from "phaser";
import { Agent, AgentStatus, OfficeEvent, STATUS_META, officeSnapshot, onOfficeEvents, subscribeOffice } from "@/lib/office";
import { COLS, DIRS, Dir, FH, FW, SpriteLook, drawSheet, frameIndex } from "./sprites";

const T = 32;
const SPEED = 120; // px per second
const SCALE = 0.5; // sprite frames are drawn at 2×

export type Hover = { kind: "agent"; id: string; x: number; y: number } | { kind: "object"; label: string; hint: string; x: number; y: number } | null;
export type Bridge = {
  base: string;
  lookOf: (a: Agent) => SpriteLook;
  onSelect: (id: string | null) => void;
  onOpen: (action: string) => void;
  onHover: (h: Hover) => void;
  onReady: (api: OfficeApi) => void;
  onZoom?: (z: number) => void;
};
export type OfficeApi = { focusZone: (id: string) => void; focusAgent: (id: string) => void; zoomBy: (f: number) => void; fit: () => void; select: (id: string | null) => void };

type Seat = { name: string; dept: string; x: number; y: number; mx: number; my: number };
type Zone = { id: string; title: string; x: number; y: number; w: number; h: number };
const prop = (o: Phaser.Types.Tilemaps.TiledObject, k: string) => (o.properties as any[] | undefined)?.find((p) => p.name === k)?.value;
const hex = (c: string) => parseInt(c.replace("#", ""), 16);

/* ------------------------------------------------------------------ one helper on the floor */
class AgentView {
  c: Phaser.GameObjects.Container;
  spr: Phaser.GameObjects.Sprite;
  ring: Phaser.GameObjects.Graphics;
  tag: Phaser.GameObjects.Container;
  tagBg: Phaser.GameObjects.Graphics;
  tagText: Phaser.GameObjects.Text;
  badge: Phaser.GameObjects.Container;
  bubble: Phaser.GameObjects.Container | null = null;
  bubbleTimer: Phaser.Time.TimerEvent | null = null;
  glow: Phaser.GameObjects.Rectangle;
  queue: (() => Promise<void>)[] = [];
  running = false;
  away = false;
  dir: Dir = "up";
  status: AgentStatus = "idle";
  agent: Agent;
  selected = false;
  hover = false;
  key: string;

  constructor(public s: OfficeScene, a: Agent, public seat: Seat, look: SpriteLook) {
    this.agent = a;
    this.key = `ag-${a.id}-${look.color}-${look.shape}-${look.prop}`;
    if (!s.textures.exists(this.key)) {
      const tex = s.textures.createCanvas(this.key, FW * COLS, FH * DIRS.length)!;
      drawSheet(tex.getSourceImage() as HTMLCanvasElement, look);
      tex.refresh();
      for (let i = 0; i < COLS * DIRS.length; i++) tex.add(i, 0, (i % COLS) * FW, Math.floor(i / COLS) * FH, FW, FH);
      for (const d of DIRS) {
        s.anims.create({ key: `${this.key}-walk-${d}`, frames: [0, 1, 2, 3].map((c) => ({ key: this.key, frame: frameIndex(d, c) })), frameRate: 8, repeat: -1 });
        s.anims.create({ key: `${this.key}-idle-${d}`, frames: [4, 5].map((c) => ({ key: this.key, frame: frameIndex(d, c) })), frameRate: 1.2, repeat: -1 });
        s.anims.create({ key: `${this.key}-work-${d}`, frames: [6, 7].map((c) => ({ key: this.key, frame: frameIndex(d, c) })), frameRate: 6, repeat: -1 });
      }
    }
    // the monitor on this helper's desk lights up while it works
    this.glow = s.add.rectangle(seat.mx, seat.my, 19, 8, 0x5b8def, 0).setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    this.ring = s.add.graphics();
    this.spr = s.add.sprite(0, -FH * SCALE / 2 + 6, this.key, frameIndex("up", 4)).setScale(SCALE);
    this.tagBg = s.add.graphics();
    this.tagText = s.add.text(0, 0, a.name, { fontFamily: "Inter, system-ui, sans-serif", fontSize: "11px", color: "#1c1917", fontStyle: "600" }).setResolution(3).setOrigin(0.5);
    this.tag = s.add.container(0, -FH * SCALE - 2, [this.tagBg, this.tagText]);
    this.badge = s.add.container(15, -24);
    this.c = s.add.container(seat.x, seat.y + 4, [this.ring, this.spr, this.badge, this.tag]);
    this.c.setSize(28, 40).setInteractive(new Phaser.Geom.Rectangle(-14, -36, 28, 42), Phaser.Geom.Rectangle.Contains);
    this.c.on("pointerover", () => { this.hover = true; this.drawRing(); s.input.setDefaultCursor("pointer"); s.emitHover(this); });
    this.c.on("pointerout", () => { this.hover = false; this.drawRing(); s.input.setDefaultCursor("default"); s.bridge.onHover(null); });
    this.c.on("pointerup", (p: Phaser.Input.Pointer) => { if (!s.dragged(p)) s.select(a.id); });
    this.apply(a, true);
  }

  get x() { return this.c.x; }
  get y() { return this.c.y; }

  drawTag() {
    const m = STATUS_META[this.status];
    const label = this.agent.name;
    this.tagText.setText(label);
    const w = Math.ceil(this.tagText.width) + 22, h = 17;
    this.tagText.setX(5);
    this.tagBg.clear();
    this.tagBg.fillStyle(0xffffff, 0.94).fillRoundedRect(-w / 2, -h / 2, w, h, 8);
    this.tagBg.lineStyle(1, this.selected ? 0x6366f1 : 0x1c1917, this.selected ? 1 : 0.12).strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    this.tagBg.fillStyle(hex(m.color), 1).fillCircle(-w / 2 + 9, 0, 3.5);
  }

  drawRing() {
    const m = STATUS_META[this.status];
    this.ring.clear();
    const strong = this.selected || this.hover;
    if (this.status !== "idle" || strong) {
      this.ring.fillStyle(hex(m.color), strong ? 0.28 : 0.18).fillEllipse(0, 0, strong ? 40 : 34, strong ? 14 : 11);
      this.ring.lineStyle(this.selected ? 2 : 1.25, this.selected ? 0x6366f1 : hex(m.color), 0.9).strokeEllipse(0, 0, strong ? 40 : 34, strong ? 14 : 11);
    }
  }

  drawBadge() {
    this.badge.removeAll(true);
    const s = this.s;
    const add = (fill: number, glyph: string, pulse = false) => {
      const g = s.add.graphics().fillStyle(fill, 1).fillCircle(0, 0, 7).lineStyle(1.5, 0xffffff, 1).strokeCircle(0, 0, 7);
      const t = s.add.text(0, 0.5, glyph, { fontFamily: "Inter, system-ui, sans-serif", fontSize: "10px", color: "#fff", fontStyle: "800" }).setOrigin(0.5).setResolution(3);
      this.badge.add([g, t]);
      if (pulse) s.tweens.add({ targets: this.badge, y: this.badge.y - 3, yoyo: true, repeat: -1, duration: 520, ease: "Sine.easeInOut" });
    };
    s.tweens.killTweensOf(this.badge); this.badge.setY(-24);
    if (this.status === "blocked") add(0xd97706, String(Math.min(9, this.agent.waiting_count || 1)), true);
    else if (this.status === "failed") add(0xd03b3b, "!");
    else if (this.status === "queued") add(0x7c3aed, String(Math.min(9, this.agent.queued || 1)));
    else if (this.status === "paused") add(0x78716c, "II");
    else if (this.status === "working" && this.agent.waiting_count) add(0xd97706, String(Math.min(9, this.agent.waiting_count)));
  }

  /** Follow the authoritative state: posture, ring, badge, monitor. */
  apply(a: Agent, first = false) {
    const changed = first || a.status !== this.status || a.waiting_count !== this.agent.waiting_count || a.queued !== this.agent.queued || a.name !== this.agent.name;
    this.agent = a;
    this.status = a.status;
    if (changed) { this.drawTag(); this.drawRing(); this.drawBadge(); }
    this.c.setAlpha(a.status === "paused" ? 0.55 : 1);
    if (!this.away && !this.running) this.settle();
    this.s.tweens.killTweensOf(this.glow);
    if (a.status === "working" && a.current?.kind === "job") {
      this.glow.setFillStyle(0x5b8def, 0.55);
      this.s.tweens.add({ targets: this.glow, alpha: { from: 0.55, to: 0.25 }, yoyo: true, repeat: -1, duration: 900 });
    } else {
      this.glow.setFillStyle(a.status === "failed" ? 0xd03b3b : 0x5b8def, a.status === "failed" ? 0.35 : 0);
      this.glow.setAlpha(1);
    }
  }

  /** At the desk: typing while working, otherwise sitting still (breathing). */
  settle() {
    this.dir = "up";
    const working = this.status === "working";
    this.spr.play(`${this.key}-${working ? "work" : "idle"}-up`, true);
    if (this.status === "paused") this.spr.anims.pause(); else this.spr.anims.resume();
  }

  say(text: string, color = "#1c1917", ms = 3200) {
    const s = this.s;
    this.bubble?.destroy(); this.bubbleTimer?.remove();
    const t = s.add.text(0, 0, text.length > 46 ? text.slice(0, 45) + "…" : text, { fontFamily: "Inter, system-ui, sans-serif", fontSize: "11px", color, wordWrap: { width: 180 } })
      .setResolution(3).setOrigin(0.5);
    const w = Math.ceil(t.width) + 14, h = Math.ceil(t.height) + 8;
    const g = s.add.graphics();
    g.fillStyle(0xffffff, 0.98).fillRoundedRect(-w / 2, -h / 2, w, h, 7).lineStyle(1, 0x1c1917, 0.14).strokeRoundedRect(-w / 2, -h / 2, w, h, 7);
    g.fillStyle(0xffffff, 0.98).fillTriangle(-5, h / 2 - 1, 5, h / 2 - 1, 0, h / 2 + 5);
    const b = s.add.container(this.x, this.y - FH * SCALE - 16 - h / 2, [g, t]).setDepth(5000).setAlpha(0);
    this.bubble = b;
    s.tweens.add({ targets: b, alpha: 1, y: b.y - 4, duration: 160 });
    this.bubbleTimer = s.time.delayedCall(ms, () => { s.tweens.add({ targets: b, alpha: 0, duration: 250, onComplete: () => b.destroy() }); if (this.bubble === b) this.bubble = null; });
  }

  burst(color: number) {
    const s = this.s;
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10;
      const d = s.add.circle(this.x, this.y - 18, 2.5, color).setDepth(4000);
      s.tweens.add({ targets: d, x: this.x + Math.cos(a) * 22, y: this.y - 18 + Math.sin(a) * 22, alpha: 0, duration: 650, ease: "Cubic.easeOut", onComplete: () => d.destroy() });
    }
  }

  shake() { this.s.tweens.add({ targets: this.spr, x: { from: -2, to: 2 }, yoyo: true, repeat: 4, duration: 50, onComplete: () => this.spr.setX(0) }); }

  flashMonitor(color = 0xffffff) {
    const f = this.s.add.rectangle(this.seat.mx, this.seat.my, 19, 8, color, 0.9).setDepth(7);
    this.s.tweens.add({ targets: f, alpha: 0, duration: 450, onComplete: () => f.destroy() });
  }

  enqueue(step: () => Promise<void>, walking = false) {
    if (walking && this.queue.length > 2) return; // don't build a backlog of trips; bubbles still show
    this.queue.push(step);
    if (!this.running) this.drain();
  }

  async drain() {
    this.running = true;
    while (this.queue.length) {
      const step = this.queue.shift()!;
      try { await step(); } catch { /* scene gone */ }
    }
    this.running = false;
    if (!this.away) this.settle();
  }

  walkTo(tx: number, ty: number): Promise<void> {
    const s = this.s;
    const path = s.path(this.x, this.y - 4, tx, ty);
    if (!path.length) { this.c.setPosition(tx, ty + 4); return Promise.resolve(); }
    return new Promise((resolve) => {
      const pts = [...path, { x: tx, y: ty }];
      const next = () => {
        const p = pts.shift();
        if (!p) { resolve(); return; }
        const dx = p.x - this.x, dy = p.y + 4 - this.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) { next(); return; }
        const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        if (dir !== this.dir || !this.spr.anims.isPlaying || !this.spr.anims.currentAnim?.key.includes("walk")) this.spr.play(`${this.key}-walk-${dir}`, true);
        this.dir = dir;
        s.tweens.add({ targets: this.c, x: p.x, y: p.y + 4, duration: (dist / SPEED) * 1000, ease: "Linear", onComplete: next });
      };
      next();
    });
  }

  async goHome() { if (this.away || Math.hypot(this.x - this.seat.x, this.y - this.seat.y - 4) > 2) { await this.walkTo(this.seat.x, this.seat.y); this.away = false; } this.settle(); }

  wait(ms: number) { return new Promise<void>((r) => this.s.time.delayedCall(ms, () => r())); }

  update() {
    this.c.setDepth(100 + this.y);
    if (this.bubble) this.bubble.setX(this.x);
  }

  destroy() { this.c.destroy(); this.glow.destroy(); this.bubble?.destroy(); }
}

/* ------------------------------------------------------------------ the scene */
class OfficeScene extends Phaser.Scene {
  bridge: Bridge;
  map!: Phaser.Tilemaps.Tilemap;
  grid: boolean[][] = [];
  seats: Seat[] = [];
  spots: Record<string, { x: number; y: number }[]> = {};
  zones: Zone[] = [];
  zoneLabels: Record<string, Phaser.GameObjects.Text> = {};
  views = new Map<string, AgentView>();
  seatOf = new Map<string, Seat>();
  links!: Phaser.GameObjects.Graphics;
  dash = 0;
  selectedId: string | null = null;
  unsubs: (() => void)[] = [];
  downAt: { x: number; y: number } | null = null;
  pinch: number | null = null;
  homed = false;

  constructor(bridge: Bridge) { super("office"); this.bridge = bridge; }

  preload() {
    this.load.tilemapTiledJSON("hq", `${this.bridge.base}/office/hq.json`);
    this.load.image("tiles", `${this.bridge.base}/office/tiles.png`);
  }

  create() {
    this.textures.get("tiles").setFilter(Phaser.Textures.FilterMode.NEAREST);
    const map = (this.map = this.make.tilemap({ key: "hq" }));
    const tsd = (this.cache.tilemap.get("hq")?.data?.tilesets || [])[0] || {};
    const ts = map.addTilesetImage("saga-office", "tiles", T, T, tsd.margin || 0, tsd.spacing || 0)!;
    ["floor", "rugs", "shadow", "walls", "decor", "furniture"].forEach((n, i) => map.createLayer(n, ts, 0, 0)?.setDepth(i));
    // walkable grid: anything with a solid tile in walls or furniture blocks
    const solid = (l: string, x: number, y: number) => !!map.getTileAt(x, y, false, l)?.properties?.collides;
    this.grid = Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => !solid("walls", x, y) && !solid("furniture", x, y)));
    const objs = (n: string) => map.getObjectLayer(n)?.objects || [];
    this.seats = objs("seats").map((o) => ({ name: o.name, dept: prop(o, "dept"), x: o.x!, y: o.y!, mx: prop(o, "monitor_x"), my: prop(o, "monitor_y") }));
    for (const o of objs("spots")) (this.spots[prop(o, "kind")] ||= []).push({ x: o.x!, y: o.y! });
    this.zones = objs("zones").map((o) => ({ id: o.name, title: prop(o, "title") || o.name, x: o.x!, y: o.y!, w: o.width!, h: o.height! }));
    for (const z of this.zones) {
      const t = this.add.text(z.x + 10, z.y + 8, z.title, { fontFamily: "Inter, system-ui, sans-serif", fontSize: "12px", color: "#3f3d56", fontStyle: "700",
        backgroundColor: "rgba(255,255,255,0.78)", padding: { x: 7, y: 3 } }).setResolution(3).setDepth(50);
      this.zoneLabels[z.id] = t;
    }
    for (const o of objs("interactive")) this.addInteractive(o);
    this.links = this.add.graphics().setDepth(90);

    // camera: drag to pan, wheel / pinch to zoom, keys
    const cam = this.cameras.main;
    cam.setBounds(-T * 4, -T * 4, map.widthInPixels + T * 8, map.heightInPixels + T * 8);
    cam.setBackgroundColor("#ebe8f3");
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => { this.downAt = { x: p.x, y: p.y }; });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const ps = this.input.manager.pointers.filter((q) => q.isDown);
      if (ps.length >= 2) {
        const d = Phaser.Math.Distance.Between(ps[0].x, ps[0].y, ps[1].x, ps[1].y);
        if (this.pinch) this.zoomAt(cam.zoom * (d / this.pinch), (ps[0].x + ps[1].x) / 2, (ps[0].y + ps[1].y) / 2);
        this.pinch = d;
        return;
      }
      if (!p.isDown) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      this.bridge.onHover(null);
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.pinch = null;
      if (!over.length && !this.dragged(p)) this.select(null);
      this.downAt = null;
    });
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.zoomAt(cam.zoom * (dy > 0 ? 0.9 : 1.1), p.x, p.y));
    const keys = this.input.keyboard?.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,PLUS,MINUS") as Record<string, Phaser.Input.Keyboard.Key> | undefined;
    this.events.on("update", (_t: number, dt: number) => {
      if (!keys) return;
      const v = (dt / 1000) * 420 / cam.zoom;
      if (keys.A.isDown || keys.LEFT.isDown) cam.scrollX -= v;
      if (keys.D.isDown || keys.RIGHT.isDown) cam.scrollX += v;
      if (keys.W.isDown || keys.UP.isDown) cam.scrollY -= v;
      if (keys.S.isDown || keys.DOWN.isDown) cam.scrollY += v;
    });
    this.input.keyboard?.on("keydown-PLUS", () => this.zoomBy(1.15));
    this.input.keyboard?.on("keydown-MINUS", () => this.zoomBy(1 / 1.15));
    this.input.keyboard?.on("keydown-ESC", () => this.select(null));
    if (this.input.keyboard) this.input.keyboard.enabled = true;
    this.scale.on("resize", () => this.clampZoom());
    this.fit(false);

    this.sync();
    this.unsubs.push(subscribeOffice(() => this.sync()));
    this.unsubs.push(onOfficeEvents((evs, replay) => { if (!replay) evs.forEach((e) => this.handle(e)); }));
    this.events.once("shutdown", () => this.unsubs.forEach((u) => u()));
    this.events.once("destroy", () => this.unsubs.forEach((u) => u()));
    this.bridge.onReady({ focusZone: (id) => this.focusZone(id), focusAgent: (id) => this.focusAgent(id), zoomBy: (f) => this.zoomBy(f), fit: () => this.fit(true), select: (id) => this.select(id, false) });
  }

  addInteractive(o: Phaser.Types.Tilemaps.TiledObject) {
    const x = o.x!, y = o.y!, w = o.width!, h = o.height!;
    const hl = this.add.graphics().setDepth(80);
    const z = this.add.zone(x + w / 2, y + h / 2, w, h).setInteractive({ useHandCursor: true });
    const label = prop(o, "label") || o.name, hint = prop(o, "hint") || "", action = prop(o, "action");
    z.on("pointerover", () => {
      hl.clear().lineStyle(2, 0x6366f1, 0.95).strokeRoundedRect(x - 2, y - 2, w + 4, h + 4, 6).fillStyle(0x6366f1, 0.08).fillRoundedRect(x - 2, y - 2, w + 4, h + 4, 6);
      const p = this.cameras.main.getWorldPoint(0, 0);
      const cam = this.cameras.main;
      this.bridge.onHover({ kind: "object", label, hint, x: (x + w / 2 - p.x) * cam.zoom, y: (y - p.y) * cam.zoom });
    });
    z.on("pointerout", () => { hl.clear(); this.bridge.onHover(null); });
    z.on("pointerup", (p: Phaser.Input.Pointer) => { if (!this.dragged(p) && action) this.bridge.onOpen(action); });
  }

  dragged(p: Phaser.Input.Pointer) { return !!this.downAt && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 6; }

  emitHover(v: AgentView) {
    const cam = this.cameras.main;
    const p = cam.getWorldPoint(0, 0);
    this.bridge.onHover({ kind: "agent", id: v.agent.id, x: (v.x - p.x) * cam.zoom, y: (v.y - 44 - p.y) * cam.zoom });
  }

  /* -------------------------------------------------- camera */
  minZoom() {
    const cam = this.cameras.main;
    return Math.max(0.35, Math.min(cam.width / (this.map.widthInPixels + T * 2), cam.height / (this.map.heightInPixels + T * 2)) * 0.95);
  }
  clampZoom() { const cam = this.cameras.main; cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom(), 3)); }
  zoomAt(z: number, sx: number, sy: number) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(z, this.minZoom(), 3));
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x; cam.scrollY += before.y - after.y;
    this.bridge.onZoom?.(cam.zoom);
  }
  zoomBy(f: number) { const cam = this.cameras.main; this.zoomAt(cam.zoom * f, cam.width / 2, cam.height / 2); }
  fit(animate = true) {
    const cam = this.cameras.main;
    const z = Math.min(cam.width / (this.map.widthInPixels + T), cam.height / (this.map.heightInPixels + T));
    this.panTo(this.map.widthInPixels / 2, this.map.heightInPixels / 2, Phaser.Math.Clamp(z, this.minZoom(), 3), animate);
  }
  /** First view: crisp 1:1 pixels centred on the team (or the whole office when it fits the screen). */
  home() {
    const cam = this.cameras.main;
    if (cam.width >= this.map.widthInPixels && cam.height >= this.map.heightInPixels) return this.fit(false);
    const vs = [...this.views.values()];
    const cx = vs.length ? vs.reduce((a, v) => a + v.x, 0) / vs.length : this.map.widthInPixels / 2;
    const cy = vs.length ? vs.reduce((a, v) => a + v.y, 0) / vs.length : this.map.heightInPixels / 2;
    this.panTo(cx, cy, 1, false);
  }
  panTo(x: number, y: number, zoom: number | null, animate = true) {
    const cam = this.cameras.main;
    const z = zoom == null ? cam.zoom : Phaser.Math.Clamp(zoom, this.minZoom(), 3);
    if (!animate) { cam.setZoom(z); cam.centerOn(x, y); this.bridge.onZoom?.(z); return; }
    cam.pan(x, y, 450, "Sine.easeInOut", true);
    cam.zoomTo(z, 450, "Sine.easeInOut", true, (_c: unknown, prog: number) => { if (prog === 1) this.bridge.onZoom?.(z); });
  }
  focusZone(id: string) {
    const z = this.zones.find((q) => q.id === id);
    if (!z) return;
    const cam = this.cameras.main;
    this.panTo(z.x + z.w / 2, z.y + z.h / 2, Math.min(cam.width / (z.w + T * 3), cam.height / (z.h + T * 3)));
  }
  focusAgent(id: string) {
    const v = this.views.get(id);
    if (v) this.panTo(v.x, v.y - 16, Math.max(this.cameras.main.zoom, 1.25));
  }
  select(id: string | null, notify = true) {
    this.selectedId = id;
    for (const v of this.views.values()) { const on = v.agent.id === id; if (on !== v.selected) { v.selected = on; v.drawTag(); v.drawRing(); } }
    if (id) this.focusAgent(id);
    if (notify) this.bridge.onSelect(id);
  }

  /* -------------------------------------------------- paths */
  path(fx: number, fy: number, tx: number, ty: number): { x: number; y: number }[] {
    const W = this.map.width, H = this.map.height;
    const sx = Phaser.Math.Clamp(Math.floor(fx / T), 0, W - 1), sy = Phaser.Math.Clamp(Math.floor(fy / T), 0, H - 1);
    const ex = Phaser.Math.Clamp(Math.floor(tx / T), 0, W - 1), ey = Phaser.Math.Clamp(Math.floor(ty / T), 0, H - 1);
    const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (this.grid[y][x] || (x === ex && y === ey) || (x === sx && y === sy));
    const prev = new Int32Array(W * H).fill(-1);
    const q = [sy * W + sx]; prev[sy * W + sx] = sy * W + sx;
    while (q.length) {
      const cur = q.shift()!;
      if (cur === ey * W + ex) break;
      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, ni = ny * W + nx;
        if (ok(nx, ny) && prev[ni] < 0) { prev[ni] = cur; q.push(ni); }
      }
    }
    if (prev[ey * W + ex] < 0) return [];
    const cells: number[] = [];
    for (let c = ey * W + ex; c !== sy * W + sx; c = prev[c]) cells.push(c);
    cells.reverse();
    // keep only the corners
    const pts = cells.map((c) => ({ x: (c % W) * T + T / 2, y: ((c / W) | 0) * T + T / 2 }));
    return pts.filter((p, i) => i === pts.length - 1 || i === 0 || !((pts[i - 1].x === p.x && pts[i + 1].x === p.x) || (pts[i - 1].y === p.y && pts[i + 1].y === p.y)));
  }
  near(seat: Seat, from: { x: number; y: number }): { x: number; y: number } {
    const gx = Math.floor(seat.x / T), gy = Math.floor(seat.y / T);
    const cands = [[0, 1], [-1, 1], [1, 1], [-1, 0], [1, 0]].map(([dx, dy]) => ({ gx: gx + dx, gy: gy + dy }))
      .filter((c) => this.grid[c.gy]?.[c.gx] && ![...this.seatOf.values()].some((s) => Math.floor(s.x / T) === c.gx && Math.floor(s.y / T) === c.gy));
    const best = cands.sort((a, b) => Math.hypot(a.gx * T - from.x, a.gy * T - from.y) - Math.hypot(b.gx * T - from.x, b.gy * T - from.y))[0];
    return best ? { x: best.gx * T + T / 2, y: best.gy * T + T / 2 } : { x: seat.x, y: seat.y + T };
  }

  /* -------------------------------------------------- state → views */
  assignSeat(a: Agent): Seat | null {
    const taken = new Set([...this.seatOf.values()].map((s) => s.name));
    // one helper per desk first (even seats), then the second chair of each desk
    const order = [...this.seats.filter((_, i) => i % 2 === 0), ...this.seats.filter((_, i) => i % 2 === 1)];
    const free = (d?: string) => order.find((s) => !taken.has(s.name) && (!d || s.dept === d));
    return free(a.department) || free("studio") || free() || null;
  }

  sync() {
    const st = officeSnapshot().state;
    if (!st || !this.map) return;
    const seen = new Set<string>();
    for (const a of st.agents) {
      seen.add(a.id);
      let v = this.views.get(a.id);
      if (!v) {
        const seat = this.seatOf.get(a.id) || this.assignSeat(a);
        if (!seat) continue;
        this.seatOf.set(a.id, seat);
        v = new AgentView(this, a, seat, this.bridge.lookOf(a));
        v.selected = a.id === this.selectedId;
        this.views.set(a.id, v);
      } else v.apply(a);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { v.destroy(); this.views.delete(id); this.seatOf.delete(id); }
    if (!this.homed && this.views.size) { this.homed = true; this.home(); }
    // room labels with live counts
    for (const z of this.zones) {
      const inRoom = st.agents.filter((a) => this.seatOf.get(a.id)?.dept === z.id);
      const working = inRoom.filter((a) => a.status === "working").length, waiting = inRoom.filter((a) => a.status === "blocked").length;
      const bits = [z.title, working ? `${working} working` : "", waiting ? `${waiting} waiting on you` : ""].filter(Boolean);
      this.zoneLabels[z.id]?.setText(bits.join("  ·  "));
    }
  }

  /* -------------------------------------------------- verified events → animation */
  handle(e: OfficeEvent) {
    const v = this.views.get(e.staff_id);
    if (!v) return;
    const d = e.data || {};
    const brief = (s?: string) => (s ? `: ${s}` : "");
    switch (e.kind) {
      case "job.started":
        v.enqueue(() => v.goHome());
        v.say(`Started${brief(d.brief)}`, "#1d4ed8"); v.flashMonitor(0x9ec5f4); break;
      case "job.queued":
        if (!d.from_staff) v.say(d.origin === "shift" ? "Regular job queued" : "New job queued", "#6d28d9", 2200); break;
      case "tool":
        if (d.phase === "start") { v.say(`⚙ ${d.name}`, "#334155", 1800); v.flashMonitor(); }
        else if (d.ok === false) v.say(`${d.name} failed`, "#b91c1c", 2600);
        else if (!d.decision || d.decision === "allowed") v.flashMonitor(0xc7f9cc);
        else v.say(`${d.name}: ${d.decision}`, "#b45309", 2600);
        break;
      case "handoff": {
        const to = this.views.get(d.to_staff);
        if (!to) { v.say(`Handed a job to ${d.to_staff}`); break; }
        v.enqueue(async () => {
          v.away = true;
          const n = this.near(to.seat, v);
          await v.walkTo(n.x, n.y);
          v.spr.play(`${v.key}-idle-${to.x < v.x ? "left" : "right"}`, true);
          v.say(`Over to ${to.agent.name}${brief(d.brief)}`, "#4338ca", 2600);
          this.paper(v, to);
          to.say(`Got a job from ${v.agent.name}`, "#4338ca", 2400);
          await v.wait(1400);
          await v.goHome();
        }, true);
        break;
      }
      case "approval.requested": {
        const spot = this.spots.approvals?.[0];
        v.say(`Needs your approval${brief(d.title)}`, "#b45309", 3400);
        if (spot) v.enqueue(async () => { v.away = true; await v.walkTo(spot.x + (Math.random() * 20 - 10), spot.y); v.spr.play(`${v.key}-idle-up`, true); await v.wait(1500); await v.goHome(); }, true);
        break;
      }
      case "approval.decided": {
        const ok = d.decision === "approved";
        v.say(ok ? "Approved by you ✓" : d.decision === "rejected" ? "Rejected by you" : "You asked for changes", ok ? "#15803d" : "#b45309", 3000);
        v.burst(ok ? 0x22c55e : 0xf59e0b); break;
      }
      case "question.asked": v.say(`Asks you${brief(d.title)}`, "#b45309", 3400); break;
      case "question.answered": v.say("Got your answer", "#15803d"); break;
      case "job.done": v.say("Done ✓", "#15803d", 2400); v.burst(0x22c55e); break;
      case "job.failed": v.say(`Failed${brief(d.error)}`, "#b91c1c", 4200); v.burst(0xef4444); v.shake(); break;
      case "job.cancelled": v.say("Job cancelled", "#57534e"); break;
      case "chat.started": v.say("Replying to you in chat", "#1d4ed8", 2400); break;
      case "chat.replied": v.say("Replied in chat", "#15803d", 2200); break;
      case "engine": v.say(d.state === "retrying" ? "Retrying…" : "Switching account…", "#b45309", 2600); break;
      case "agent.paused": v.say("Paused", "#57534e"); break;
      case "agent.resumed": v.say("Back to work", "#15803d"); break;
    }
  }

  paper(from: AgentView, to: AgentView) {
    const p = this.add.rectangle(from.x, from.y - 22, 9, 11, 0xffffff).setStrokeStyle(1, 0x6366f1).setDepth(4500);
    this.tweens.add({ targets: p, x: to.x, y: to.y - 22, duration: 700, ease: "Sine.easeInOut", onComplete: () => { this.tweens.add({ targets: p, alpha: 0, duration: 200, onComplete: () => p.destroy() }); } });
  }

  update(_t: number, dt: number) {
    for (const v of this.views.values()) v.update();
    // collaboration: a moving dashed line between helpers working on linked jobs
    this.dash = (this.dash + dt * 0.03) % 12;
    const g = this.links; g.clear();
    const st = officeSnapshot().state;
    if (!st) return;
    const drawn = new Set<string>();
    for (const a of st.agents) {
      for (const c of a.collaborators) {
        if (!c.live) continue;
        const k = [a.id, c.staff_id].sort().join("|");
        if (drawn.has(k)) continue;
        drawn.add(k);
        const A = this.views.get(a.id), B = this.views.get(c.staff_id);
        if (!A || !B) continue;
        const x1 = A.x, y1 = A.y - 14, x2 = B.x, y2 = B.y - 14;
        const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        g.lineStyle(2, 0x6366f1, 0.7);
        for (let s = this.dash; s < len; s += 12) {
          const e2 = Math.min(len, s + 6);
          g.lineBetween(x1 + ux * s, y1 + uy * s, x1 + ux * e2, y1 + uy * e2);
        }
      }
    }
  }
}

export function startOffice(parent: HTMLElement, bridge: Bridge): () => void {
  const scene = new OfficeScene(bridge);
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent, transparent: false, backgroundColor: "#ebe8f3", antialias: true, roundPixels: false,
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 800, height: parent.clientHeight || 600 },
    scene, banner: false, audio: { noAudio: true }, disableContextMenu: false,
    input: { mouse: { preventDefaultWheel: true }, touch: { capture: true } },
    fps: { target: 60, smoothStep: true },
  });
  return () => game.destroy(true);
}
