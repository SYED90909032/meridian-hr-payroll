import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError, errMsg, post } from '../api';
import { useSession } from '../session';
import { Banner, Field } from '../ui';

function Logo() {
  return (
    <div className="brand" style={{ justifyContent: 'center', paddingBottom: 18 }}>
      <span className="brand-mark"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M8 23V9l8 9 8-9v14" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
      <span>Meridian</span>
    </div>
  );
}

export function Login() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to={me.user.mustChangePassword ? '/account/password' : '/'} replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await post('/auth/login', { email: email.trim(), password, ...(needCode ? (useRecovery ? { recoveryCode: code.trim() } : { totp: code }) : {}) });
      await refresh(); nav('/');
    } catch (x) {
      if (x instanceof ApiError && x.code === 'mfa_required') { setNeedCode(true); setErr(null); } else setErr(errMsg(x));
    } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Logo />
        <h1 style={{ textAlign: 'center', marginBottom: 4 }}>Sign in</h1>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 20 }}>People and payroll, with the controls built in.</p>
        {err && <Banner tone="bad">{err}</Banner>}
        <form onSubmit={submit}>
          <Field label="Work email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {needCode && (
            <Field label={useRecovery ? 'Recovery code' : '6-digit code'} hint={useRecovery ? 'Each recovery code works once.' : 'From your authenticator app.'}>
              <input className="input mono" inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={useRecovery ? 20 : 6} value={code} onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))} required autoFocus />
            </Field>
          )}
          <button className="btn primary" style={{ width: '100%', height: 38 }} disabled={busy}>{busy ? 'Signing in…' : needCode ? 'Verify and sign in' : 'Sign in'}</button>
          {needCode && <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>}
        </form>
        <p className="muted" style={{ textAlign: 'center', marginTop: 18 }}>New company? <Link to="/register">Create your workspace</Link></p>
      </div>
    </div>
  );
}

export function Register() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ companyName: '', slug: '', country: 'AE', currency: 'AED', displayName: '', email: '', password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to="/" replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/register', { ...f, email: f.email.trim(), companyName: f.companyName.trim() }); await refresh(); nav('/settings/security'); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <div className="card auth-card" style={{ maxWidth: 480 }}>
        <Logo />
        <h1 style={{ textAlign: 'center', marginBottom: 4 }}>Create your workspace</h1>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 20 }}>You become the owner. Turn on two-step verification straight after.</p>
        {err && <Banner tone="bad">{err}</Banner>}
        <form onSubmit={submit}>
          <Field label="Company name"><input className="input" value={f.companyName} onChange={(e) => setF((x) => ({ ...x, companyName: e.target.value, slug: slugify(e.target.value) }))} required minLength={2} maxLength={120} autoFocus /></Field>
          <div className="row">
            <Field label="Workspace address" hint="Lowercase letters, numbers, dashes."><input className="input" value={f.slug} onChange={set('slug')} required minLength={2} maxLength={41} pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]" /></Field>
            <Field label="Country" hint="Pay rules ship for UAE first."><select className="input" value={f.country} onChange={set('country')}><option value="AE">United Arab Emirates</option></select></Field>
          </div>
          <Field label="Your name"><input className="input" value={f.displayName} onChange={set('displayName')} required minLength={2} maxLength={100} autoComplete="name" /></Field>
          <Field label="Work email"><input className="input" type="email" value={f.email} onChange={set('email')} required autoComplete="username" /></Field>
          <Field label="Password" hint="At least 12 characters. A passphrase works well."><input className="input" type="password" value={f.password} onChange={set('password')} required minLength={12} maxLength={128} autoComplete="new-password" /></Field>
          <button className="btn primary" style={{ width: '100%', height: 38 }} disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
        </form>
        <p className="muted" style={{ textAlign: 'center', marginTop: 18 }}>Already have one? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  );
}

export function ChangePassword() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const [cur, setCur] = useState(''); const [next, setNext] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (!me) return <Navigate to="/login" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/change-password', { current: cur, next }); await refresh(); nav('/'); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Logo />
        <h1 style={{ textAlign: 'center', marginBottom: 4 }}>Choose a new password</h1>
        {me.user.mustChangePassword && <p className="muted" style={{ textAlign: 'center', marginBottom: 16 }}>Your administrator gave you a temporary password. Replace it to continue.</p>}
        {err && <Banner tone="bad">{err}</Banner>}
        <form onSubmit={submit}>
          <Field label="Current password"><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 12 characters."><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} autoComplete="new-password" /></Field>
          <button className="btn primary" style={{ width: '100%', height: 38 }} disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </form>
      </div>
    </div>
  );
}
