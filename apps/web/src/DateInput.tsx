/**
 * DateInput: a Spike-styled replacement for <input type="date" | "month" | "datetime-local">.
 *
 * Why: native browser pickers can't be themed. They ignore dark mode, fonts and brand colours
 * and look different in every browser. This component draws its own calendar in an MUI Popover
 * (styled after Spike's date-picker cards: rounded paper, primary-filled selected day,
 * outlined "today") and works the same everywhere.
 *
 * Drop-in contract (pages did not change their logic):
 *   - `value` / `min` / `max` use the native string formats: "YYYY-MM-DD", "YYYY-MM",
 *     "YYYY-MM-DDTHH:mm".
 *   - `onChange` receives an event-shaped object, so existing handlers that read
 *     `e.target.value` keep working.
 *   - `required` is enforced by a visually hidden native input, so form submission and the
 *     browser's "Please fill in this field" bubble behave as before.
 *   - `id` goes on the trigger button, so <Field label> still focuses it.
 *
 * Dates are handled as plain Y/M/D numbers (no Date objects for selected values), so there
 * are no time-zone off-by-one bugs. Weeks start on Monday (ISO 8601).
 *
 * Keyboard: arrows move by day or week, PageUp/PageDown by month, Home/End to the week edges,
 * Enter selects, Esc closes.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Box, ButtonBase, IconButton, Popover, Typography, type Theme } from '@mui/material';
import { SolarIcon } from './icons/SolarIcon';

type Kind = 'date' | 'month' | 'datetime-local';
type View = 'day' | 'month' | 'year';

export interface DateInputProps {
  type?: Kind;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  placeholder?: string;
  'aria-label'?: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const ym = (y: number, m: number) => `${y}-${pad(m)}`;
/** Days in month m (1-12) of year y; Date.UTC(y, m, 0) is the last day of month m. */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 = Monday … 6 = Sunday, for the 1st of the month. */
const firstWeekday = (y: number, m: number) => (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
function today() { const t = new Date(); return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }; }
function parse(v: string | undefined) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T(\d{2}):(\d{2}))?/.exec(v ?? '');
  return m ? { y: +m[1]!, m: +m[2]!, d: m[3] ? +m[3] : 1, hh: m[4] ? +m[4] : 9, mm: m[5] ? +m[5] : 0 } : null;
}
/** Add `n` days to a Y-M-D (UTC arithmetic, so DST never interferes). */
function addDays(y: number, m: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function display(kind: Kind, v: string) {
  const p = parse(v);
  if (!p) return '';
  if (kind === 'month') return `${MONTHS[p.m - 1]} ${p.y}`;
  const date = `${pad(p.d)} ${MONTHS[p.m - 1]!.slice(0, 3)} ${p.y}`;
  return kind === 'datetime-local' ? `${date}, ${pad(p.hh)}:${pad(p.mm)}` : date;
}
const fakeEvent = (value: string) => ({ target: { value }, currentTarget: { value } }) as unknown as ChangeEvent<HTMLInputElement>;

/** Shared look for every clickable cell (day, month, year). */
const cellSx = (selected: boolean, current: boolean) => ({
  borderRadius: '50px', fontSize: '0.8125rem', fontWeight: selected ? 600 : 500, color: selected ? '#fff' : 'text.primary',
  bgcolor: selected ? 'primary.main' : 'transparent',
  outline: current && !selected ? '1px solid' : 'none', outlineColor: 'primary.main', outlineOffset: -1,
  transition: 'background-color .15s, color .15s',
  '&:hover': { bgcolor: selected ? 'primary.dark' : 'primary.light', color: selected ? '#fff' : 'primary.main' },
  '&.Mui-focusVisible': { boxShadow: (t: Theme) => `0 0 0 3px ${t.palette.primary.light}` },
  '&.Mui-disabled': { color: 'text.disabled', opacity: 0.45 },
});

export function DateInput({ type = 'date', value, onChange, min, max, required, disabled, id, name, placeholder, 'aria-label': ariaLabel }: DateInputProps) {
  const kind = type;
  const anchor = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const sel = parse(value);
  const now = today();
  // `cursor` is the month being shown and the day that has keyboard focus.
  const [cursor, setCursor] = useState(() => sel ?? { ...now, hh: 9, mm: 0 });
  const [view, setView] = useState<View>(kind === 'month' ? 'month' : 'day');
  const [time, setTime] = useState({ hh: sel?.hh ?? 9, mm: sel?.mm ?? 0 });

  const openPicker = () => {
    if (disabled) return;
    const s = parse(value);
    setCursor(s ?? { ...now, hh: 9, mm: 0 });
    setTime({ hh: s?.hh ?? 9, mm: s?.mm ?? 0 });
    setView(kind === 'month' ? 'month' : 'day');
    setOpen(true);
  };
  const close = () => { setOpen(false); anchor.current?.focus(); };
  const commit = (v: string, keepOpen = false) => { onChange(fakeEvent(v)); if (!keepOpen) close(); };

  // Bounds, compared as ISO strings (lexicographic order equals date order).
  const minDay = min?.slice(0, 10), maxDay = max?.slice(0, 10);
  const minMonth = min?.slice(0, 7), maxMonth = max?.slice(0, 7);
  const dayOff = (s: string) => (!!minDay && s < minDay) || (!!maxDay && s > maxDay);
  const monthOff = (s: string) => (!!minMonth && s < minMonth) || (!!maxMonth && s > maxMonth);
  const yearOff = (y: number) => (!!min && y < +min.slice(0, 4)) || (!!max && y > +max.slice(0, 4));

  const pickDay = (y: number, m: number, d: number) => {
    const day = iso(y, m, d);
    if (dayOff(day)) return;
    if (kind === 'datetime-local') { setCursor({ y, m, d, hh: time.hh, mm: time.mm }); commit(`${day}T${pad(time.hh)}:${pad(time.mm)}`, true); }
    else commit(day);
  };
  const pickMonth = (m: number) => {
    if (kind === 'month') { if (!monthOff(ym(cursor.y, m))) commit(ym(cursor.y, m)); return; }
    setCursor({ ...cursor, m, d: Math.min(cursor.d, daysIn(cursor.y, m)) });
    setView('day');
  };
  const pickYear = (y: number) => { setCursor({ ...cursor, y, d: Math.min(cursor.d, daysIn(y, cursor.m)) }); setView('month'); };
  const step = (dir: 1 | -1) => {
    if (view === 'day') { const t = addDays(cursor.y, cursor.m, 1, 0); const m0 = t.m + dir; const y = t.y + (m0 < 1 ? -1 : m0 > 12 ? 1 : 0); const m = ((m0 + 11) % 12) + 1; setCursor({ ...cursor, y, m, d: Math.min(cursor.d, daysIn(y, m)) }); }
    else if (view === 'month') setCursor({ ...cursor, y: cursor.y + dir });
    else setCursor({ ...cursor, y: cursor.y + dir * 12 });
  };

  // Keyboard focus follows the cursor day. Runs on cursor changes and again once the popover
  // has finished opening (its focus trap focuses the paper first, which would otherwise win).
  const focusCursor = () => {
    if (view !== 'day') return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${iso(cursor.y, cursor.m, cursor.d)}"]`)?.focus({ preventScroll: true });
  };
  useEffect(() => { if (open) focusCursor(); }, [open, view, cursor.y, cursor.m, cursor.d]); // eslint-disable-line react-hooks/exhaustive-deps

  const onGridKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: { y: number; m: number; d: number } | null = null;
    if (e.key in moves) next = addDays(cursor.y, cursor.m, cursor.d, moves[e.key]!);
    else if (e.key === 'Home') next = addDays(cursor.y, cursor.m, cursor.d, -((firstWeekday(cursor.y, cursor.m) + cursor.d - 1) % 7));
    else if (e.key === 'End') next = addDays(cursor.y, cursor.m, cursor.d, 6 - ((firstWeekday(cursor.y, cursor.m) + cursor.d - 1) % 7));
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const m0 = cursor.m + (e.key === 'PageUp' ? -1 : 1); const y = cursor.y + (m0 < 1 ? -1 : m0 > 12 ? 1 : 0); const m = ((m0 + 11) % 12) + 1;
      next = { y, m, d: Math.min(cursor.d, daysIn(y, m)) };
    }
    if (next) { e.preventDefault(); setCursor({ ...cursor, ...next }); }
  };

  const cells = useMemo(() => {
    const lead = firstWeekday(cursor.y, cursor.m), n = daysIn(cursor.y, cursor.m);
    return [...Array<null>(lead).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)];
  }, [cursor.y, cursor.m]);

  const header = view === 'day' ? `${MONTHS[cursor.m - 1]} ${cursor.y}` : view === 'month' ? String(cursor.y) : `${cursor.y - (cursor.y % 12)} – ${cursor.y - (cursor.y % 12) + 11}`;
  const shown = display(kind, value);
  const todayValue = kind === 'month' ? ym(now.y, now.m) : iso(now.y, now.m, now.d);

  return (
    <Box className="date-input" sx={{ position: 'relative', width: '100%', minWidth: kind === 'month' ? 170 : 150 }}>
      <ButtonBase ref={anchor} id={id} type="button" className="input" disabled={disabled} onClick={openPicker}
        aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel ? `${ariaLabel}${shown ? `: ${shown}` : ''}` : undefined}
        // ButtonBase resets border/padding, so the .input look is restated here explicitly.
        sx={{ justifyContent: 'space-between', gap: 1, textAlign: 'left', font: 'inherit', fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
          border: '1px solid var(--sp-input-border)', borderRadius: 'var(--sp-radius-input)', bgcolor: disabled ? 'var(--sp-grey-100)' : 'var(--sp-paper)', color: 'text.primary',
          px: '14px', '&:hover': { borderColor: 'var(--sp-input-border-hover)' }, '&.Mui-focusVisible': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 3px ${t.palette.primary.light}` },
          ...(open && { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 3px ${t.palette.primary.light}` }) }}>
        <Box component="span" sx={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: shown ? 'text.primary' : 'text.secondary' }}>
          {shown || placeholder || (kind === 'month' ? 'Select month' : 'Select date')}
        </Box>
        <SolarIcon icon="solar:calendar-line-duotone" size={19} />
      </ButtonBase>
      {/* Native input only for constraint validation (required) and form serialisation. */}
      <input tabIndex={-1} aria-hidden="true" name={name} required={required} value={value} onChange={() => {}}
        onFocus={() => anchor.current?.focus()}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none', border: 0, padding: 0 }} />

      <Popover open={open} anchorEl={anchor.current} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ transition: { onEntered: focusCursor }, paper: { role: 'dialog', 'aria-label': kind === 'month' ? 'Choose month' : 'Choose date', sx: { mt: 1, p: 2, width: 308, maxWidth: 'calc(100vw - 24px)', borderRadius: '14px', boxShadow: (t: Theme) => t.tokens.shadows.dropdown } } as object }}>
        {/* Header: period label (click to zoom out) and previous / next. */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <ButtonBase onClick={() => setView(view === 'day' ? 'month' : 'year')} disabled={view === 'year'} aria-label={`${header}, change ${view === 'day' ? 'month' : 'year'}`}
            sx={{ px: 1, py: 0.5, borderRadius: '8px', fontWeight: 600, fontSize: '0.9375rem', gap: 0.5, '&:hover': { bgcolor: 'action.hover' } }}>
            {header}{view !== 'year' && <SolarIcon icon="solar:alt-arrow-down-line-duotone" size={16} />}
          </ButtonBase>
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={() => step(-1)} aria-label="Previous"><SolarIcon icon="solar:alt-arrow-left-line-duotone" size={18} /></IconButton>
          <IconButton size="small" onClick={() => step(1)} aria-label="Next"><SolarIcon icon="solar:alt-arrow-right-line-duotone" size={18} /></IconButton>
        </Box>

        {view === 'day' && (
          <Box ref={grid} role="grid" onKeyDown={onGridKey}>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.5 }} role="row">
              {WEEKDAYS.map((w) => <Typography key={w} role="columnheader" sx={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', py: 0.5 }}>{w}</Typography>)}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 0.5 }} role="row">
              {cells.map((d, i) => {
                if (d === null) return <span key={`b${i}`} />;
                const day = iso(cursor.y, cursor.m, d);
                const isSel = !!sel && iso(sel.y, sel.m, sel.d) === day;
                const isToday = day === iso(now.y, now.m, now.d);
                const isCursor = d === cursor.d;
                return (
                  <ButtonBase key={day} data-day={day} role="gridcell" aria-selected={isSel} aria-current={isToday ? 'date' : undefined}
                    tabIndex={isCursor ? 0 : -1} disabled={dayOff(day)} onClick={() => pickDay(cursor.y, cursor.m, d)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickDay(cursor.y, cursor.m, d); } }}
                    aria-label={`${d} ${MONTHS[cursor.m - 1]} ${cursor.y}`}
                    sx={{ ...cellSx(isSel, isToday), height: 36, width: 36, mx: 'auto' }}>
                    {d}
                  </ButtonBase>
                );
              })}
            </Box>
          </Box>
        )}

        {view === 'month' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            {MONTHS.map((label, i) => {
              const key = ym(cursor.y, i + 1);
              const isSel = !!sel && ym(sel.y, sel.m) === key;
              return (
                <ButtonBase key={label} onClick={() => pickMonth(i + 1)} disabled={kind === 'month' && monthOff(key)} aria-pressed={isSel}
                  sx={{ ...cellSx(isSel, key === ym(now.y, now.m)), height: 40 }}>
                  {label.slice(0, 3)}
                </ButtonBase>
              );
            })}
          </Box>
        )}

        {view === 'year' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
            {Array.from({ length: 12 }, (_, i) => cursor.y - (cursor.y % 12) + i).map((y) => (
              <ButtonBase key={y} onClick={() => pickYear(y)} disabled={yearOff(y)} aria-pressed={sel?.y === y} sx={{ ...cellSx(sel?.y === y, y === now.y), height: 40 }}>{y}</ButtonBase>
            ))}
          </Box>
        )}

        {kind === 'datetime-local' && view === 'day' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
            <SolarIcon icon="solar:clock-circle-line-duotone" size={18} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, mr: 'auto' }}>Time</Typography>
            {(['hh', 'mm'] as const).map((part) => (
              <select key={part} className="input" aria-label={part === 'hh' ? 'Hour' : 'Minute'} value={time[part]} style={{ width: 74, height: 36 }}
                onChange={(e) => {
                  const t = { ...time, [part]: +e.target.value };
                  setTime(t);
                  if (sel) commit(`${iso(sel.y, sel.m, sel.d)}T${pad(t.hh)}:${pad(t.mm)}`, true);
                }}>
                {Array.from({ length: part === 'hh' ? 24 : 60 }, (_, n) => <option key={n} value={n}>{pad(n)}</option>)}
              </select>
            ))}
          </Box>
        )}

        {/* Footer: clear (optional fields only), jump to today / this month, done for date-time. */}
        <Box sx={{ display: 'flex', alignItems: 'center', mt: 1.5, gap: 1 }}>
          {!required && value && <button type="button" className="btn sm ghost" onClick={() => commit('')}>Clear</button>}
          <Box sx={{ flex: 1 }} />
          {kind === 'datetime-local'
            ? <button type="button" className="btn sm primary" onClick={close}>Done</button>
            : <button type="button" className="btn sm ghost" disabled={kind === 'month' ? monthOff(todayValue) : dayOff(todayValue)} onClick={() => commit(todayValue)}>{kind === 'month' ? 'This month' : 'Today'}</button>}
        </Box>
      </Popover>
    </Box>
  );
}
