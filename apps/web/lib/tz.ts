/* Dates on the company's clock (not the browser's): the calendar shows when helpers work where the company is. */

export type Wall = { y: number; m: number; d: number; h: number; mi: number; dow: number }; // m 1-12, dow 0 = Monday

const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmts.set(tz, f);
  }
  return f;
}
const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** The wall-clock time in `tz` of an instant. */
export function wall(t: Date | string | number, tz: string): Wall {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(t))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, dow: DOW[p.weekday] ?? 0 };
}

/** The instant at which the clock in `tz` shows this wall time. */
export function instant(y: number, m: number, d: number, h = 0, mi = 0, tz = "UTC"): Date {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) { // adjust by the zone's offset at that moment (twice covers DST edges)
    const w = wall(t, tz);
    const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
    t += want - shown;
  }
  return new Date(t);
}

/** A plain calendar date (no time, no zone) — the grid's unit. */
export type Day = { y: number; m: number; d: number };
export const dayKey = (x: Day) => `${x.y}-${String(x.m).padStart(2, "0")}-${String(x.d).padStart(2, "0")}`;
export const addDays = (x: Day, n: number): Day => {
  const t = new Date(Date.UTC(x.y, x.m - 1, x.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
export const dow = (x: Day) => (new Date(Date.UTC(x.y, x.m - 1, x.d)).getUTCDay() + 6) % 7; // 0 = Monday
export const sameDay = (a: Day, b: Day) => a.y === b.y && a.m === b.m && a.d === b.d;
export const today = (tz: string): Day => { const w = wall(Date.now(), tz); return { y: w.y, m: w.m, d: w.d }; };
export const dayOf = (t: string | Date, tz: string): Day => { const w = wall(t, tz); return { y: w.y, m: w.m, d: w.d }; };

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const hhmm = (t: string | Date, tz: string) => { const w = wall(t, tz); return `${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`; };
export const dayLabel = (x: Day, tz: string) => {
  const t = today(tz);
  if (sameDay(x, t)) return "Today";
  if (sameDay(x, addDays(t, 1))) return "Tomorrow";
  return `${DAYS[dow(x)]} ${x.d} ${MONTHS[x.m - 1].slice(0, 3)}${x.y !== t.y ? ` ${x.y}` : ""}`;
};
