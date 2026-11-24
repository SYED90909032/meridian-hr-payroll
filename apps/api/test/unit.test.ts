import { describe, expect, it } from 'vitest';
import { computeDay, leaveDaysX1000, addDays } from '../src/modules/time/lib.js';
import { checkWebhookUrl, isBlockedIp, resolveSafeTarget } from '../src/modules/platform/ssrf.js';

const TZ = 'Asia/Dubai'; // UTC+4, no DST
const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+04:00`);
const shift = { start: '09:00', end: '18:00', breakMin: 60, graceMin: 10, overnight: false };
const base = { date: '2026-03-02', tz: TZ, isHoliday: false, isWeekend: false, onLeave: false, today: '2026-03-10' };

describe('computeDay', () => {
  it('counts worked time, deducts the break after six hours, and flags lateness beyond grace', () => {
    const r = computeDay({ ...base, shift, punches: [{ t: at(base.date, '09:25'), dir: 'in' }, { t: at(base.date, '18:25'), dir: 'out' }] })!;
    expect(r.status).toBe('present');
    expect(r.workedMinutes).toBe(480);
    expect(r.lateMinutes).toBe(15);
    expect(r.overtimeMinutes).toBe(0);
  });
  it('grace period is respected', () => {
    const r = computeDay({ ...base, shift, punches: [{ t: at(base.date, '09:08'), dir: 'in' }, { t: at(base.date, '18:00'), dir: 'out' }] })!;
    expect(r.lateMinutes).toBe(0);
  });
  it('overtime is time beyond the scheduled length', () => {
    const r = computeDay({ ...base, shift, punches: [{ t: at(base.date, '09:00'), dir: 'in' }, { t: at(base.date, '20:00'), dir: 'out' }] })!;
    expect(r.overtimeMinutes).toBe(120);
  });
  it('bouncing duplicate punches collapse (first in, last out)', () => {
    const r = computeDay({ ...base, shift, punches: [
      { t: at(base.date, '09:00'), dir: 'in' }, { t: at(base.date, '09:01'), dir: 'in' },
      { t: at(base.date, '17:59'), dir: 'out' }, { t: at(base.date, '18:00'), dir: 'out' }] })!;
    expect(r.workedMinutes).toBe(480);
  });
  it('an unmatched in is incomplete, never silently paid', () => {
    const r = computeDay({ ...base, shift, punches: [{ t: at(base.date, '09:00'), dir: 'in' }] })!;
    expect(r.status).toBe('incomplete');
    expect(r.workedMinutes).toBe(0);
  });
  it('a leading out is ignored', () => {
    const r = computeDay({ ...base, shift, punches: [{ t: at(base.date, '08:00'), dir: 'out' }, { t: at(base.date, '09:00'), dir: 'in' }, { t: at(base.date, '13:00'), dir: 'out' }] })!;
    expect(r.workedMinutes).toBe(240);
  });
  it('no punches: absent on a past working day, nothing yet for today or the future, rest day and holiday labelled', () => {
    expect(computeDay({ ...base, punches: [] })!.status).toBe('absent');
    expect(computeDay({ ...base, date: '2026-03-10', punches: [] })).toBeNull();
    expect(computeDay({ ...base, isWeekend: true, punches: [] })!.status).toBe('rest_day');
    expect(computeDay({ ...base, isHoliday: true, punches: [] })!.status).toBe('holiday');
    expect(computeDay({ ...base, onLeave: true, punches: [] })!.status).toBe('leave');
  });
  it('work on a holiday or rest day is special overtime', () => {
    const r = computeDay({ ...base, isHoliday: true, shift, punches: [{ t: at(base.date, '10:00'), dir: 'in' }, { t: at(base.date, '14:00'), dir: 'out' }] })!;
    expect(r.overtimeSpecialMinutes).toBe(240);
    expect(r.overtimeMinutes).toBe(0);
    expect(r.lateMinutes).toBe(0);
  });
});

describe('leaveDaysX1000', () => {
  const weekend = [6, 0]; // Saturday and Sunday
  it('skips weekends and holidays', () => {
    // Mon 2 Mar to Mon 9 Mar 2026: 6 working days
    expect(leaveDaysX1000('2026-03-02', '2026-03-09', weekend, new Set())).toBe(6000);
    expect(leaveDaysX1000('2026-03-02', '2026-03-09', weekend, new Set(['2026-03-04']))).toBe(5000);
  });
  it('a half day is 0.5 only for a single working day', () => {
    expect(leaveDaysX1000('2026-03-02', '2026-03-02', weekend, new Set(), true)).toBe(500);
    expect(leaveDaysX1000('2026-03-07', '2026-03-07', weekend, new Set(), true)).toBe(0);
  });
  it('end before start is zero; a pure weekend is zero', () => {
    expect(leaveDaysX1000('2026-03-05', '2026-03-02', weekend, new Set())).toBe(0);
    expect(leaveDaysX1000('2026-03-07', '2026-03-08', weekend, new Set())).toBe(0);
  });
  it('addDays crosses month and leap-year boundaries', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('SSRF guard', () => {
  it('blocks private, loopback, link-local, metadata, CGNAT and mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:a9fe:a9fe']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });
  it('allows ordinary public addresses', () => {
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:2800:220:1:248:1893:25c8:1946']) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it('rejects non-https, credentials, odd ports, IP literals in private space, and localhost names', () => {
    for (const u of ['http://example.com/hook', 'https://user:pw@example.com/hook', 'https://example.com:8443/hook', 'https://127.0.0.1/hook', 'https://[::1]/hook', 'https://localhost/hook', 'https://10.0.0.1/hook', 'ftp://example.com/x', 'not a url', 'https://169.254.169.254/latest/meta-data']) {
      expect(() => checkWebhookUrl(u), u).toThrow();
    }
    expect(checkWebhookUrl('https://hooks.example.com/in').host).toBe('hooks.example.com');
  });
  it('DNS rebinding: a hostname that resolves to a private address is refused, even if another record is public', async () => {
    await expect(resolveSafeTarget('https://evil.example.com/x', async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }])).rejects.toThrow();
    await expect(resolveSafeTarget('https://evil.example.com/x', async () => [{ address: '127.0.0.1', family: 4 }])).rejects.toThrow();
    await expect(resolveSafeTarget('https://evil.example.com/x', async () => [])).rejects.toThrow();
    const ok = await resolveSafeTarget('https://good.example.com/x', async () => [{ address: '93.184.216.34', family: 4 }]);
    expect(ok.address).toBe('93.184.216.34');
  });
});
