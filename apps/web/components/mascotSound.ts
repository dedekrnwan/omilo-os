/* Each mascot has its own little voice when you click it, made on the spot with Web Audio (no sound files):
   - the body shape picks the timbre: blob = round "boop", box = chippy "bleep", bean = bouncy "bwip"
   - the prop picks the tune: a crown plays a fanfare, a coin goes ka-ching, a headset rings, a gear clicks…
   - the colour picks the pitch, so two helpers with the same prop still sound different
   - a sleeping helper snores, a sad one sighs
   Quiet by design, and it can be switched off per browser (Settings → Notifications → Mascot sounds). */

export type Voice = { shape?: string; prop?: string; color?: string; mood?: string; sleeping?: boolean };

const KEY = "omilo.mascotSound";
export const mascotSoundOn = () => { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } };
export const setMascotSound = (on: boolean) => { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private window */ } };

let ctx: AudioContext | null = null;
let last = 0;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

const SCALE = [0, 2, 4, 7, 9]; // major pentatonic: anything sounds friendly
const hz = (semis: number) => 523.25 * Math.pow(2, semis / 12); // from C5
function hash(s: string) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

type Wave = OscillatorType;
const TIMBRE: Record<string, { wave: Wave; bend: number; cut: number }> = {
  blob: { wave: "sine", bend: 0, cut: 4000 },
  box: { wave: "square", bend: 0, cut: 2200 },
  bean: { wave: "triangle", bend: 3, cut: 5000 },
};

/** One note: frequency, start offset, length (s), with an optional glide (semitones) over its length. */
function note(a: AudioContext, out: AudioNode, f: number, at: number, len: number, wave: Wave, o: { glide?: number; vol?: number; vib?: number } = {}) {
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(f, t);
  if (o.glide) osc.frequency.exponentialRampToValueAtTime(f * Math.pow(2, o.glide / 12), t + len * 0.9);
  if (o.vib) { // a wobble (robots, megaphones)
    const lfo = a.createOscillator(), depth = a.createGain();
    lfo.frequency.value = o.vib; depth.gain.value = f * 0.06;
    lfo.connect(depth).connect(osc.frequency); lfo.start(t); lfo.stop(t + len + 0.05);
  }
  const v = o.vol ?? 1;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(g).connect(out);
  osc.start(t); osc.stop(t + len + 0.05);
}

function click(a: AudioContext, out: AudioNode, at: number, tone = 1800) {
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * 0.03), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf; bp.type = "bandpass"; bp.frequency.value = tone; bp.Q.value = 4; g.gain.value = 0.9;
  src.connect(bp).connect(g).connect(out); src.start(t);
}

export function playMascot(v: Voice) {
  if (!mascotSoundOn()) return;
  const now = Date.now();
  if (now - last < 90) return; // a burst of clicks makes one sound
  last = now;
  const a = audio();
  if (!a) return;

  const tim = TIMBRE[v.shape || "blob"] || TIMBRE.blob;
  const root = SCALE[hash(v.color || "x") % SCALE.length] + (hash(v.color || "x") % 2 ? 0 : -12) + 0; // pitch from the colour
  const n = (step: number) => hz(root + SCALE[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5));

  // shared output: a gentle low-pass and a low master volume
  const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = tim.cut;
  const master = a.createGain(); master.gain.value = 0.11;
  lp.connect(master).connect(a.destination);
  const w = tim.wave;

  if (v.sleeping) { // a slow snore
    note(a, lp, n(-5), 0, 0.5, "sine", { glide: -2, vol: 0.7 });
    note(a, lp, n(-6), 0.55, 0.45, "sine", { glide: 2, vol: 0.5 });
    return;
  }
  if (v.mood === "sad") { // a sigh: down, minor
    note(a, lp, n(2), 0, 0.22, w, { vol: 0.8 });
    note(a, lp, n(2) / Math.pow(2, 3 / 12), 0.2, 0.4, w, { glide: -2, vol: 0.7 });
    return;
  }

  switch (v.prop) {
    case "crown": // a little fanfare
      [0, 2, 3, 5].forEach((s, i) => note(a, lp, n(s), i * 0.08, i === 3 ? 0.32 : 0.11, w, { vol: i === 3 ? 1 : 0.8 }));
      break;
    case "coin": // ka-ching
      note(a, lp, hz(root + 11), 0, 0.07, "square", { vol: 0.7 });
      note(a, lp, hz(root + 16), 0.07, 0.35, "square", { vol: 0.8 });
      break;
    case "headset": // ring-ring
      [0, 0.16].forEach((at) => { note(a, lp, n(4), at, 0.12, w); note(a, lp, n(2), at + 0.06, 0.1, w, { vol: 0.6 }); });
      break;
    case "megaphone": // a short call, buzzy
      note(a, lp, n(3), 0, 0.26, "sawtooth", { glide: -3, vib: 22, vol: 0.7 });
      break;
    case "tie": // smooth glide up
      note(a, lp, n(0), 0, 0.3, w, { glide: 7, vol: 0.9 });
      break;
    case "gear": // click-clack and a low hum
      click(a, lp, 0, 2400); click(a, lp, 0.09, 1600);
      note(a, lp, n(-5), 0.12, 0.18, "square", { vol: 0.5 });
      break;
    case "glasses": // two quick blips
      note(a, lp, n(4), 0, 0.06, w); note(a, lp, n(6), 0.08, 0.07, w);
      break;
    case "antenna": // a robot warble
      note(a, lp, n(2), 0, 0.28, "square", { vib: 34, vol: 0.6 });
      break;
    case "sprout": // growing up
      [0, 1, 2].forEach((s, i) => note(a, lp, n(s), i * 0.07, 0.16, w, { vol: 0.6 + i * 0.15 }));
      break;
    case "beret": // a playful flourish down
      [5, 3, 2, 0].forEach((s, i) => note(a, lp, n(s), i * 0.06, 0.12, w, { vol: 0.75 }));
      break;
    case "magnifier": // a sonar ping with an echo
      note(a, lp, n(5), 0, 0.5, "sine");
      note(a, lp, n(5), 0.22, 0.4, "sine", { vol: 0.35 });
      break;
    case "spark": // sparkle
      [7, 9, 8, 10].forEach((s, i) => note(a, lp, n(s), i * 0.045, 0.1, "triangle", { vol: 0.55 }));
      break;
    default: // just their voice: one note, shaped by the body
      note(a, lp, n(2), 0, 0.18, w, { glide: tim.bend || 2 });
  }
}
