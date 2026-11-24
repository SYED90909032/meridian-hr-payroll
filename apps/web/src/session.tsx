import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, get, post, setStepUpHook, setUnauthHook, errMsg } from './api';
import { Banner, Field, Loading, Modal } from './ui';

export interface Me {
  user: { id: string; email: string; displayName: string; employeeId: string | null; totpEnabled: boolean; mfa: boolean; mustChangePassword: boolean; stepUpValid: boolean };
  tenant: { id: string; name: string; slug: string; country: string; currency: string } | null;
  memberships: Array<{ id: string; name: string; slug: string }>;
  roles: string[];
  perms: string[];
}
interface Ctx { me: Me | null; ready: boolean; refresh: () => Promise<void>; signOut: () => Promise<void>; can: (...perms: string[]) => boolean; currency: string }
const SessionCtx = createContext<Ctx>(null as unknown as Ctx);
export const useSession = () => useContext(SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [stepUp, setStepUp] = useState<null | ((ok: boolean) => void)>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const refresh = useCallback(async () => {
    try { setMe(await get<Me>('/auth/me')); } catch (e) { if (!(e instanceof ApiError) || e.status !== 401) console.error(e); setMe(null); } finally { setReady(true); }
  }, []);
  const signOut = useCallback(async () => { try { await post('/auth/logout'); } catch { /* already out */ } setMe(null); }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    setUnauthHook(() => { if (meRef.current) setMe(null); });
    setStepUpHook(() => new Promise<boolean>((resolve) => setStepUp(() => resolve)));
    return () => { setUnauthHook(null); setStepUpHook(null); };
  }, []);

  const can = useCallback((...p: string[]) => !!me && p.every((x) => me.perms.includes(x)), [me]);
  if (!ready) return <Loading />;
  return (
    <SessionCtx.Provider value={{ me, ready, refresh, signOut, can, currency: me?.tenant?.currency ?? 'AED' }}>
      {children}
      {stepUp && <StepUpDialog totp={!!me?.user.totpEnabled} onDone={(ok) => { stepUp(ok); setStepUp(null); if (ok) void refresh(); }} />}
    </SessionCtx.Provider>
  );
}

/** Re-confirm identity before a sensitive action. The server decides what needs it; this just collects the proof. */
function StepUpDialog({ totp, onDone }: { totp: boolean; onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/step-up', { password, ...(totp && code ? { totp: code } : {}) }); onDone(true); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Confirm it's you" onClose={() => onDone(false)} footer={<>
      <button className="btn" onClick={() => onDone(false)}>Cancel</button>
      <button className="btn primary" type="submit" form="stepup" disabled={busy || !password || (totp && code.length !== 6)}>{busy ? 'Checking…' : 'Confirm'}</button>
    </>}>
      <form id="stepup" onSubmit={submit}>
        <p className="muted" style={{ marginBottom: 12 }}>This action changes sensitive data. Enter your password{totp ? ' and a code from your authenticator app' : ''}. Confirmation lasts 10 minutes.</p>
        {err && <Banner tone="bad">{err}</Banner>}
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {totp && <Field label="6-digit code"><input className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>}
      </form>
    </Modal>
  );
}
