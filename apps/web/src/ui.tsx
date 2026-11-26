/**
 * Shared UI primitives, styled after the Spike Admin UI system (Breadcrumb card, ParentCard,
 * KPI cards with tinted icon boxes, status chips, dialogs, drawers, tabs, toasts).
 * Every export keeps the signature the pages already use, so page logic is unchanged.
 */
import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert, Avatar as MuiAvatar, Box, Button, ButtonBase, Card as MuiCard, Chip as MuiChip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Drawer as MuiDrawer, IconButton, Stack, Tab, Tabs as MuiTabs, Tooltip, Typography,
} from '@mui/material';
import { useTheme, type Theme } from '@mui/material/styles';
import { errMsg } from './api';
import { SolarIcon, type SolarName } from './icons/SolarIcon';
import { AVATARS, avatarSrc, setAvatar, useAvatar } from './avatars';

/* ---------- async data ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    fn().then((d) => { if (n === seq.current) { setData(d); setError(null); } }).catch((e) => { if (n === seq.current) setError(errMsg(e)); }).finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/* ---------- tones ---------- */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | '';
export type PaletteKey = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error';
const TONE_KEY: Record<string, PaletteKey> = { ok: 'success', warn: 'warning', bad: 'error', info: 'primary', '': 'secondary' };
export const toneKey = (t: Tone = ''): PaletteKey => TONE_KEY[t] ?? 'secondary';

/* ---------- toasts ---------- */
type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, bad }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), bad ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <Stack role="status" aria-live="polite" spacing={1.25} sx={{ position: 'fixed', right: 24, top: 24, zIndex: 2000, maxWidth: 380 }}>
        {items.map((t) => (
          <Alert key={t.id} variant="filled" icon={<SolarIcon icon={t.bad ? 'solar:danger-triangle-line-duotone' : 'solar:check-circle-line-duotone'} size={22} />}
            onClose={() => setItems((x) => x.filter((y) => y.id !== t.id))}
            sx={{ bgcolor: t.bad ? 'error.dark' : 'primary.main', color: '#fff', boxShadow: (th) => th.tokens.shadows.dropdown, fontWeight: 500, '& .MuiAlert-icon': { color: '#fff' } }}>
            {t.text}
          </Alert>
        ))}
      </Stack>
    </ToastCtx.Provider>
  );
}

/* ---------- small pieces ---------- */
export const Spinner = () => <CircularProgress size={18} thickness={5} aria-label="Loading" sx={{ verticalAlign: 'middle' }} />;
export const Loading = () => <Box sx={{ display: 'grid', placeItems: 'center', py: 7.5 }}><CircularProgress size={30} thickness={4.5} aria-label="Loading" /></Box>;

export function IconBox({ icon, color = 'primary', size = 48, iconSize = 24, radius = 12 }: { icon: SolarName; color?: PaletteKey; size?: number; iconSize?: number; radius?: number }) {
  return (
    <Box sx={{ width: size, height: size, flexShrink: 0, borderRadius: `${radius}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: `${color}.light`, color: `${color}.main` }}>
      <SolarIcon icon={icon} size={iconSize} />
    </Box>
  );
}

const alertSx = (k: PaletteKey) => ({
  mb: 2.25, bgcolor: `${k}.light`, color: (t: Theme) => t.tokens.onTint[k], border: 0, fontSize: '0.875rem', alignItems: 'center',
  '& .MuiAlert-icon': { color: `${k}.main`, opacity: 1 }, '& .MuiAlert-message': { flex: 1, minWidth: 0 }, '& .muted': { color: 'inherit', opacity: 0.85 }, '& a': { fontWeight: 600 },
});

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <Alert severity="error" icon={<SolarIcon icon="solar:danger-triangle-line-duotone" size={22} />} sx={alertSx('error')}
      action={retry && <Button size="small" color="error" variant="outlined" onClick={retry}>Try again</Button>}>
      {error}
    </Alert>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Box className="empty" sx={{ py: 5, px: 2.5, textAlign: 'center' }}>
      <Box sx={{ mx: 'auto', mb: 1.75, width: 64, height: 64, borderRadius: '50%', bgcolor: 'primary.light', color: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <SolarIcon icon="solar:inbox-line-duotone" size={30} />
      </Box>
      <Typography variant="h6" component="h3" sx={{ mb: 0.75 }}>{title}</Typography>
      {children && <Typography component="div" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto' }}>{children}</Typography>}
    </Box>
  );
}

/** Spike "Breadcrumb" card: page title (and description) on the left, actions on the right. */
/** `avatar` (optional) renders a leading picture, used by the employee profile header. */
export function PageHead({ title, sub, avatar, children }: { title: string; sub?: ReactNode; avatar?: ReactNode; children?: ReactNode }) {
  useEffect(() => { document.title = `${title} · Meridian`; }, [title]);
  const hasActions = Array.isArray(children) ? children.some(Boolean) : !!children;
  return (
    <MuiCard className="page-head" sx={{ mb: '30px', px: { xs: 2.5, md: 3.75 }, py: 2.75, position: 'relative', overflow: 'hidden', bgcolor: 'primary.light' }}>
      <Box aria-hidden sx={{ position: 'absolute', right: { xs: -70, md: 60 }, top: -48, width: 150, height: 150, borderRadius: '50%', border: '26px solid', borderColor: 'background.paper', opacity: 0.35, pointerEvents: 'none' }} />
      <Box aria-hidden sx={{ position: 'absolute', right: { xs: -40, md: -30 }, bottom: -70, width: 140, height: 140, borderRadius: '50%', bgcolor: 'background.paper', opacity: 0.25, pointerEvents: 'none' }} />
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between" spacing={2} sx={{ position: 'relative' }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ minWidth: 0 }}>
        {avatar}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" sx={{ fontSize: '1.25rem', color: 'text.primary' }}>{title}</Typography>
          {sub && <Typography component="div" color="text.secondary" sx={{ mt: 0.75, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>{sub}</Typography>}
        </Box>
        </Stack>
        {hasActions && <Box className="actions">{children}</Box>}
      </Stack>
    </MuiCard>
  );
}

/** Spike "ParentCard": header row (18px / 600 title) + divider + 24px content. `flush` drops the padding (tables, lists). */
export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <MuiCard component="section" className="card">
      {(title || actions) && (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2} className="card-h" sx={{ px: 3, py: 1.75, minHeight: 62, flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="h5" component="h2" sx={{ fontSize: '1.0625rem' }}>{title}</Typography>
            {actions && <Box className="actions">{actions}</Box>}
          </Stack>
          <Divider />
        </>
      )}
      {flush ? children : <Box className="card-b" sx={{ p: 3 }}>{children}</Box>}
    </MuiCard>
  );
}

/** KPI card: tinted icon box, muted label, big value, caption. */
const STAT_ICONS: Array<[RegExp, SolarName, PaletteKey]> = [
  [/head|people|employee|staff|member/i, 'solar:users-group-rounded-line-duotone', 'primary'],
  [/gross|pay|net|salary|cost|earn|amount|total/i, 'solar:wallet-money-line-duotone', 'success'],
  [/deduct|tax|gosi|contrib/i, 'solar:bill-list-line-duotone', 'warning'],
  [/leave|absen|holiday|day/i, 'solar:calendar-line-duotone', 'info'],
  [/approv|pending|request|queue/i, 'solar:checklist-minimalistic-line-duotone', 'warning'],
  [/ticket|case|open|help/i, 'solar:ticket-line-duotone', 'error'],
  [/hour|time|late|clock|overtime/i, 'solar:clock-circle-line-duotone', 'info'],
  [/error|block|fail|risk|exception|warn/i, 'solar:danger-triangle-line-duotone', 'error'],
  [/period|month|date|run/i, 'solar:calendar-mark-line-duotone', 'primary'],
];
export function Stat({ k, v, s, icon, color }: { k: string; v: ReactNode; s?: ReactNode; icon?: SolarName; color?: PaletteKey }) {
  const auto = STAT_ICONS.find(([re]) => re.test(k));
  const ic = icon ?? auto?.[1] ?? 'solar:chart-2-line-duotone';
  const col = color ?? auto?.[2] ?? 'primary';
  // Long values (money such as "AED 118,156.25") step down in size so they never overflow the card.
  const len = typeof v === 'string' || typeof v === 'number' ? String(v).length : 0;
  const fs = len > 13 ? { xs: '1.125rem', xl: '1.25rem' } : len > 9 ? { xs: '1.25rem', xl: '1.375rem' } : '1.375rem';
  return (
    <MuiCard className="stat" sx={{ p: 3, height: '100%' }}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <IconBox icon={ic} color={col} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography color="text.secondary" sx={{ fontSize: '0.875rem' }}>{k}</Typography>
          <Typography variant="h3" component="div" className="num" sx={{ fontSize: fs, mt: 0.25, lineHeight: 1.35, overflowWrap: 'anywhere', '& a': { color: 'inherit' } }}>{v}</Typography>
        </Box>
      </Stack>
      {s && <Typography component="div" color="text.secondary" sx={{ fontSize: '0.8125rem', mt: 1.75 }}>{s}</Typography>}
    </MuiCard>
  );
}

export const Chip = ({ tone = '', children }: { tone?: Tone; children: ReactNode }) => {
  const k = toneKey(tone);
  return <MuiChip size="small" className="chip" label={children} sx={{ height: 24, px: 0.25, fontSize: '0.75rem', fontWeight: 600, bgcolor: `${k}.light`, color: (t) => t.tokens.onTint[k], textTransform: 'capitalize', verticalAlign: 'middle', borderRadius: '6px' }} />;
};
const STATUS_TONE: Record<string, Tone> = {
  active: 'ok', approved: 'ok', published: 'ok', paid: 'ok', finalised: 'ok', delivered: 'ok', resolved: 'ok', present: 'ok', ok: 'ok', accepted: 'ok',
  pending: 'warn', in_review: 'warn', calculated: 'info', locked: 'info', draft: '', on_leave: 'info', open: 'info', in_progress: 'info', incomplete: 'warn', late: 'warn', review: 'warn', waived: 'warn',
  rejected: 'bad', terminated: 'bad', failed: 'bad', cancelled: '', voided: '', absent: 'bad', blocking: 'bad', suspended: 'bad', closed: '', reversed: 'bad', released: 'info', payment_released: 'info',
};
export const StatusChip = ({ status }: { status: string }) => <Chip tone={STATUS_TONE[status] ?? ''}>{status.replace(/_/g, ' ')}</Chip>;

/* ---------- avatars ---------- */
const AVATAR_KEYS: PaletteKey[] = ['primary', 'success', 'warning', 'error', 'info', 'secondary'];
export const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
/** A person's picture if they chose one, else tinted initials. */
export const Avatar = ({ name, size = 36 }: { name: string; size?: number }) => {
  const pic = useAvatar(name);
  const k = AVATAR_KEYS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_KEYS.length]!;
  return (
    <MuiAvatar aria-hidden className="avatar" src={pic ? avatarSrc(pic) : undefined} alt=""
      sx={{ width: size, height: size, fontSize: size > 50 ? '1.25rem' : size < 32 ? '0.6875rem' : '0.8125rem', bgcolor: pic ? 'grey.100' : `${k}.light`, color: (t) => t.tokens.onTint[k], flex: 'none' }}>
      {initials(name)}
    </MuiAvatar>
  );
};

/** Grid of the illustrated portraits. Controlled (value/onChange) or bound to a person's name. */
export function AvatarPicker({ name, value, onChange, size = 56 }: { name?: string; value?: string | null; onChange?: (id: string | null) => void; size?: number }) {
  const bound = useAvatar(name ?? '');
  const current = value !== undefined ? value : bound;
  const pick = (id: string | null) => { if (onChange) onChange(id); else if (name) setAvatar(name, id); };
  return (
    <Box role="radiogroup" aria-label="Profile picture" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
      <Tooltip title="Initials"><ButtonBase role="radio" aria-checked={!current} onClick={() => pick(null)}
        sx={{ width: size, height: size, borderRadius: '50%', bgcolor: 'primary.light', color: 'primary.main', fontWeight: 600, fontSize: '0.875rem', outline: '2px solid', outlineOffset: 2, outlineColor: !current ? 'primary.main' : 'transparent', transition: 'outline-color .15s' }}>
        {name ? initials(name) || 'Aa' : 'Aa'}
      </ButtonBase></Tooltip>
      {AVATARS.map((a) => (
        <Tooltip key={a.id} title={a.label}>
          <ButtonBase role="radio" aria-checked={current === a.id} aria-label={a.label} onClick={() => pick(a.id)}
            sx={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', bgcolor: 'grey.100', outline: '2px solid', outlineOffset: 2, outlineColor: current === a.id ? 'primary.main' : 'transparent', transition: 'outline-color .15s, transform .15s', '&:hover': { transform: 'translateY(-2px)' } }}>
            <img src={avatarSrc(a.id)} alt="" width={size} height={size} style={{ display: 'block', objectFit: 'cover' }} loading="lazy" />
          </ButtonBase>
        </Tooltip>
      ))}
    </Box>
  );
}

export const Banner = ({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) => {
  const k: PaletteKey = tone === 'info' || tone === '' ? 'info' : toneKey(tone);
  const icon: SolarName = tone === 'ok' ? 'solar:check-circle-line-duotone' : tone === 'warn' ? 'solar:danger-triangle-line-duotone' : tone === 'bad' ? 'solar:close-circle-line-duotone' : 'solar:info-circle-line-duotone';
  return <Alert className="banner" severity={tone === 'bad' ? 'error' : tone === 'warn' ? 'warning' : tone === 'ok' ? 'success' : 'info'} role={tone === 'bad' ? 'alert' : 'note'} icon={<SolarIcon icon={icon} size={22} />} sx={alertSx(k)}>{children}</Alert>;
};

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<[T, string]>; value: T; onChange: (t: T) => void }) {
  return (
    <MuiCard sx={{ mb: 3, px: 1.5 }}>
      <MuiTabs value={tabs.some(([k]) => k === value) ? value : false} onChange={(_, v) => onChange(v as T)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
        sx={{ minHeight: 56, '& .MuiTab-root': { minHeight: 56, px: 2.25 }, '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0' } }}>
        {tabs.map(([k, label]) => <Tab key={k} value={k} label={label} />)}
      </MuiTabs>
    </MuiCard>
  );
}

/* ---------- forms ---------- */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const id = useRef('f' + Math.random().toString(36).slice(2)).current;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div>{isValidElement(children) ? cloneElement(children as any, { id }) : children}</div>
      {hint && <div className="hint">{hint}</div>}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}

/* ---------- overlays ---------- */
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('.MuiDialogContent-root input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .MuiDialogContent-root select, .MuiDialogContent-root textarea')?.focus(), 80);
    return () => clearTimeout(t);
  }, []);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth={wide ? 'md' : 'sm'} aria-label={title} slotProps={{ paper: { ref, sx: { maxWidth: wide ? 760 : 540 } } }}>
      <DialogTitle component="div" sx={{ px: 3.5, pt: 3, pb: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Typography variant="h5" component="h2">{title}</Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ color: 'text.secondary', mr: -1 }}><SolarIcon icon="solar:close-circle-line-duotone" size={24} /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 3.5, pt: '6px !important', pb: 1 }}>{children}</DialogContent>
      {footer && <DialogActions sx={{ px: 3.5, pt: 2, pb: 3, gap: 1 }}>{footer}</DialogActions>}
    </Dialog>
  );
}

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <MuiDrawer open anchor="right" onClose={onClose} slotProps={{ paper: { sx: { width: 'min(580px, 100%)', borderRadius: { sm: '18px 0 0 18px' } } } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 3, py: 2, position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h5" component="h2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{title}</Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ color: 'text.secondary' }}><SolarIcon icon="solar:close-circle-line-duotone" size={24} /></IconButton>
      </Stack>
      <Box sx={{ px: 3, pt: 2.5, pb: 5 }}>{children}</Box>
    </MuiDrawer>
  );
}

/** A form dialog: runs `onSubmit`, shows the server's error inline, closes on success. */
export function FormModal({ title, submit = 'Save', danger, onClose, onSubmit, children, wide }: { title: string; submit?: string; danger?: boolean; onClose: () => void; onSubmit: () => Promise<unknown>; children: ReactNode; wide?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try { await onSubmit(); onClose(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} wide={wide} footer={<>
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="submit" form="fm" className={'btn ' + (danger ? 'danger' : 'primary')} disabled={busy}>{busy ? 'Working…' : submit}</button>
    </>}>
      <form id="fm" onSubmit={go}>{err && <Banner tone="bad">{err}</Banner>}{children}</form>
    </Modal>
  );
}

/** Confirm dialog with an optional reason that the server requires for audit. */
export function ConfirmModal({ title, body, confirm, danger, reasonLabel, minReason = 5, onClose, onConfirm }: { title: string; body?: ReactNode; confirm: string; danger?: boolean; reasonLabel?: string; minReason?: number; onClose: () => void; onConfirm: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState('');
  const ok = !reasonLabel || reason.trim().length >= minReason;
  return (
    <FormModal title={title} submit={confirm} danger={danger} onClose={onClose} onSubmit={async () => { if (!ok) throw new Error(`Please give a reason of at least ${minReason} characters`); await onConfirm(reason.trim()); }}>
      {body && <Typography component="div" color="text.secondary" sx={{ mb: 1.5 }}>{body}</Typography>}
      {reasonLabel && <Field label={reasonLabel}><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>}
    </FormModal>
  );
}

export function Table({ head, children, empty }: { head: Array<string | { label: string; num?: boolean }>; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr>{head.map((h, i) => typeof h === 'string' ? <th key={i}>{h}</th> : <th key={i} className={h.num ? 'num' : ''}>{h.label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

/** Theme-aware chart colours for MUI X charts. */
export function useChartColors() {
  const t = useTheme();
  return [t.palette.primary.main, t.palette.info.main, t.palette.success.main, t.palette.warning.main, t.palette.error.main, t.palette.secondary.main];
}
