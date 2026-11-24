import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { errMsg } from './api';

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
      <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/* ---------- small pieces ---------- */
export const Spinner = () => <span className="spinner" role="progressbar" aria-label="Loading" />;
export const Loading = () => <div className="center"><Spinner /></div>;
export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="banner bad" role="alert"><div style={{ flex: 1 }}>{error}</div>{retry && <button className="btn sm" onClick={retry}>Try again</button>}</div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="actions">{children}</div></div>;
}
export function Card({ title, actions, children, flush }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && <div className="card-h"><h2>{title}</h2><div className="actions">{actions}</div></div>}
      {flush ? children : <div className="card-b">{children}</div>}
    </section>
  );
}
export function Stat({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return <div className="card stat"><div className="k">{k}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}</div>;
}
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | '';
export const Chip = ({ tone = '', children }: { tone?: Tone; children: ReactNode }) => <span className={'chip ' + tone}>{children}</span>;
const STATUS_TONE: Record<string, Tone> = {
  active: 'ok', approved: 'ok', published: 'ok', paid: 'ok', finalised: 'ok', delivered: 'ok', resolved: 'ok', present: 'ok', ok: 'ok', accepted: 'ok',
  pending: 'warn', in_review: 'warn', calculated: 'info', locked: 'info', draft: '', on_leave: 'info', open: 'info', in_progress: 'info', incomplete: 'warn', late: 'warn', review: 'warn', waived: 'warn',
  rejected: 'bad', terminated: 'bad', failed: 'bad', cancelled: '', voided: '', absent: 'bad', blocking: 'bad', suspended: 'bad', closed: '', reversed: 'bad', released: 'info', payment_released: 'info',
};
export const StatusChip = ({ status }: { status: string }) => <Chip tone={STATUS_TONE[status] ?? ''}>{status.replace(/_/g, ' ')}</Chip>;
export const Avatar = ({ name }: { name: string }) => <span className="avatar" aria-hidden>{name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>;
export const Banner = ({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) => <div className={'banner ' + tone} role={tone === 'bad' ? 'alert' : undefined}>{children}</div>;
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<[T, string]>; value: T; onChange: (t: T) => void }) {
  return <div className="tabs" role="tablist">{tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={k === value} className={'tab' + (k === value ? ' active' : '')} onClick={() => onChange(k)}>{label}</button>)}</div>;
}

/* ---------- forms ---------- */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const id = useRef('f' + Math.random().toString(36).slice(2)).current;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div>{typeof children === 'object' && children && 'type' in (children as any) ? cloneWithId(children as any, id) : children}</div>
      {hint && <div className="hint">{hint}</div>}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  );
}
import { cloneElement, isValidElement } from 'react';
function cloneWithId(el: any, id: string) { return isValidElement(el) ? cloneElement(el as any, { id }) : el; }

/* ---------- overlays ---------- */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('input, select, textarea, button.primary, button.accent')?.focus(); }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-h"><h2>{title}</h2></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}
export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="drawer-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-h"><h2>{title}</h2><button className="btn ghost sm" onClick={onClose} aria-label="Close">Close</button></div>
        <div className="drawer-b">{children}</div>
      </aside>
    </div>
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
      {body && <div className="muted" style={{ marginBottom: 12 }}>{body}</div>}
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
export const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
