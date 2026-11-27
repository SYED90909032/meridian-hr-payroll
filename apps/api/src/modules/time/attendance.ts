import type { Db } from '../../db/tx.js';
import { DEFAULT_TZ, DEFAULT_WEEKEND, addDays, computeDay, dayOfWeek, localParts, todayIn, type PunchLite, type ShiftLite } from './lib.js';

export interface TenantTime { tz: string; weekend: number[]; overnightBucket: 'start' | 'end' }

export async function tenantTime(db: Db, tenantId: string): Promise<TenantTime> {
  const r = await db.query<{ settings: { timezone?: string; weekend?: number[]; overnight_bucket?: 'start' | 'end' } }>('select settings from kernel.tenant where id = $1', [tenantId]);
  const s = r.rows[0]?.settings ?? {};
  return { tz: s.timezone ?? DEFAULT_TZ, weekend: Array.isArray(s.weekend) && s.weekend.length ? s.weekend : DEFAULT_WEEKEND,
    overnightBucket: s.overnight_bucket === 'end' ? 'end' : 'start' };
}

export const validTimezone = (tz: string): boolean => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

/**
 * Recomputes attendance rows for the given local dates of one employee. Runs under the `time` system actor.
 * Overnight shifts that end after midnight are staged: an out punch after midnight belongs to the next local date.
 */
export async function recomputeDays(db: Db, tenantId: string, employeeId: string, dates: string[], tt: TenantTime): Promise<number> {
  if (!dates.length) return 0;
  const sorted = [...new Set(dates)].sort();
  const first = sorted[0]!, last = sorted[sorted.length - 1]!;
  const lo = addDays(first, -1), hi = addDays(last, 2);
  const pr = await db.query<{ event_time: Date; direction: 'in' | 'out' }>(
    `select event_time, direction from tm.punch where tenant_id = $1 and employee_id = $2 and event_time >= $3::date and event_time < $4::date`, [tenantId, employeeId, lo, hi]);
  const byDate = new Map<string, PunchLite[]>();
  for (const row of pr.rows) {
    const t = new Date(row.event_time).getTime();
    const d = localParts(t, tt.tz).date;
    const arr = byDate.get(d) ?? [];
    arr.push({ t, dir: row.direction });
    byDate.set(d, arr);
  }
  const hol = await db.query<{ holiday_date: string }>('select holiday_date::text from tm.public_holiday where tenant_id = $1 and holiday_date between $2 and $3', [tenantId, first, last]);
  const holidays = new Set(hol.rows.map((h) => h.holiday_date));
  const lv = await db.query<{ start_date: string; end_date: string }>(
    `select start_date::text, end_date::text from tm.leave_request where tenant_id = $1 and employee_id = $2 and status = 'approved' and start_date <= $4 and end_date >= $3`, [tenantId, employeeId, first, last]);
  const sa = await db.query<{ lower: string; upper: string | null; start_time: string; end_time: string; break_minutes: number; grace_minutes: number; overnight: boolean }>(
    `select lower(a.valid_during)::text as lower, upper(a.valid_during)::text as upper, s.start_time::text, s.end_time::text, s.break_minutes, s.grace_minutes, s.overnight
       from tm.shift_assignment a join tm.shift s on s.id = a.shift_id
      where a.tenant_id = $1 and a.employee_id = $2 and a.valid_during && daterange($3::date, ($4::date + 1))`, [tenantId, employeeId, first, last]);
  const today = todayIn(tt.tz);
  let n = 0;
  for (const date of sorted) {
    const assignmentDate = tt.overnightBucket === 'end' ? addDays(date, -1) : date;
    const row = sa.rows.find((a) => a.lower <= assignmentDate && (!a.upper || assignmentDate < a.upper));
    const shift: ShiftLite | null = row ? { start: row.start_time, end: row.end_time, breakMin: row.break_minutes, graceMin: row.grace_minutes, overnight: row.overnight } : null;
    const punchDates = shift?.overnight
      ? (tt.overnightBucket === 'end' ? [addDays(date, -1), date] : [date, addDays(date, 1)])
      : [date];
    const punches = punchDates.flatMap((d) => byDate.get(d) ?? []);
    const res = computeDay({
      date, punches, tz: tt.tz, shift, isHoliday: holidays.has(date), isWeekend: tt.weekend.includes(dayOfWeek(date)),
      onLeave: lv.rows.some((l) => l.start_date <= date && l.end_date >= date), today,
    });
    if (!res) continue;
    await db.query(
      `insert into tm.attendance_day (tenant_id, employee_id, work_date, first_in, last_out, worked_minutes, late_minutes, overtime_minutes, overtime_special_minutes, status, computed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       on conflict (tenant_id, employee_id, work_date) do update set first_in = excluded.first_in, last_out = excluded.last_out, worked_minutes = excluded.worked_minutes,
         late_minutes = excluded.late_minutes, overtime_minutes = excluded.overtime_minutes, overtime_special_minutes = excluded.overtime_special_minutes, status = excluded.status, computed_at = now()`,
      [tenantId, employeeId, date, res.firstIn ? new Date(res.firstIn) : null, res.lastOut ? new Date(res.lastOut) : null, res.workedMinutes, res.lateMinutes, res.overtimeMinutes, res.overtimeSpecialMinutes, res.status]);
    n++;
  }
  return n;
}
