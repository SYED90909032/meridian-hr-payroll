/** Pure functions for attendance and leave day counting. No database access, so they are cheap to test. */

export interface PunchLite { t: number; dir: 'in' | 'out' }
export interface ShiftLite { start: string; end: string; breakMin: number; graceMin: number; overnight: boolean }
export interface DayInput {
  date: string; punches: PunchLite[]; tz: string; shift?: ShiftLite | null;
  isHoliday: boolean; isWeekend: boolean; onLeave: boolean; today: string;
}
export interface DayResult {
  date: string; firstIn: number | null; lastOut: number | null; workedMinutes: number; lateMinutes: number; overtimeMinutes: number; overtimeSpecialMinutes: number;
  status: 'present' | 'absent' | 'incomplete' | 'leave' | 'holiday' | 'rest_day';
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); fmtCache.set(tz, f); }
  return f;
}
export function localParts(ms: number, tz: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
export const hhmmToMin = (s: string): number => { const [h, m] = s.split(':'); return Number(h) * 60 + Number(m); };

export function computeDay(i: DayInput): DayResult | null {
  const sorted = [...i.punches].sort((a, b) => a.t - b.t);
  // Collapse bounces: repeated 'in' keeps the first, repeated 'out' keeps the last.
  const seq: PunchLite[] = [];
  for (const p of sorted) {
    const last = seq[seq.length - 1];
    if (last && last.dir === p.dir) { if (p.dir === 'out') seq[seq.length - 1] = p; continue; }
    seq.push(p);
  }
  while (seq.length && seq[0]!.dir === 'out') seq.shift();
  let worked = 0;
  let open = false;
  for (let k = 0; k < seq.length; k++) {
    const p = seq[k]!;
    if (p.dir === 'in') { const nx = seq[k + 1]; if (nx && nx.dir === 'out') { worked += Math.floor((nx.t - p.t) / 60000); k++; } else open = true; }
  }
  const firstIn = seq.find((p) => p.dir === 'in')?.t ?? null;
  const lastOut = [...seq].reverse().find((p) => p.dir === 'out')?.t ?? null;
  const base = { date: i.date, firstIn, lastOut, lateMinutes: 0, overtimeMinutes: 0, overtimeSpecialMinutes: 0 };

  if (i.onLeave) return { ...base, workedMinutes: worked, status: 'leave' };
  if (!seq.length) {
    if (i.isHoliday) return { ...base, workedMinutes: 0, status: 'holiday' };
    if (i.isWeekend) return { ...base, workedMinutes: 0, status: 'rest_day' };
    if (i.date < i.today) return { ...base, workedMinutes: 0, status: 'absent' };
    return null;
  }
  const sh = i.shift;
  if (sh && worked >= 360) worked = Math.max(0, worked - sh.breakMin);
  let late = 0;
  if (sh && firstIn !== null && !i.isHoliday && !i.isWeekend) {
    const l = localParts(firstIn, i.tz);
    late = Math.max(0, l.minutes - hhmmToMin(sh.start) - sh.graceMin);
  }
  let ot = 0, special = 0;
  if (i.isHoliday || i.isWeekend) special = worked;
  else if (sh) {
    const len = (hhmmToMin(sh.end) - hhmmToMin(sh.start) + (sh.overnight || hhmmToMin(sh.end) <= hhmmToMin(sh.start) ? 1440 : 0)) - sh.breakMin;
    ot = Math.max(0, worked - len);
  }
  return { ...base, workedMinutes: worked, lateMinutes: late, overtimeMinutes: ot, overtimeSpecialMinutes: special, status: open && lastOut === null ? 'incomplete' : open ? 'incomplete' : 'present' };
}

export function* eachDate(from: string, to: string): Generator<string> {
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) { yield d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); }
}
export const dayOfWeek = (date: string): number => new Date(date + 'T00:00:00Z').getUTCDay();

/** Working days between two dates inclusive, in thousandths of a day. Weekend days and holidays do not count. */
export function leaveDaysX1000(start: string, end: string, weekend: number[], holidays: Set<string>, half = false): number {
  if (end < start) return 0;
  let n = 0;
  for (const d of eachDate(start, end)) if (!weekend.includes(dayOfWeek(d)) && !holidays.has(d)) n++;
  if (half) return start === end && n === 1 ? 500 : 0;
  return n * 1000;
}

export const addDays = (date: string, n: number): string => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const todayIn = (tz: string, now = Date.now()): string => localParts(now, tz).date;
export const DEFAULT_TZ = 'Asia/Dubai';
export const DEFAULT_WEEKEND = [6, 0];
