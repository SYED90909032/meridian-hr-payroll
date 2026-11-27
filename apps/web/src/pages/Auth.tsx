/**
 * Sign in, create workspace and change password, in Spike's AuthShell
 * (modules/auth/components/AuthShell.tsx: blank canvas, cyan blob top-right, coral circle
 * bottom-left, a two-column card with the illustration left and the form right).
 * Form logic, fields, validation and API calls are unchanged from the previous version.
 * New: "Create workspace" lets the owner pick a profile picture (stored on this device).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Box, Card, Divider, Stack, Typography } from '@mui/material';
import { ApiError, errMsg, post } from '../api';
import { useSession } from '../session';
import { AvatarPicker, Banner, Field } from '../ui';
import { setAvatar } from '../avatars';
import { LogoMark } from '../layout/Logo';
import { SolarIcon } from '../icons/SolarIcon';

const Brand = () => (
  <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 4 }}>
    <LogoMark size={34} />
    <Typography sx={{ fontWeight: 700, fontSize: '1.25rem', letterSpacing: '-0.02em' }}>Meridian</Typography>
  </Stack>
);

const POINTS = [
  { icon: 'solar:shield-check-line-duotone', text: 'Every pay run locked, hashed and approved' },
  { icon: 'solar:users-group-rounded-line-duotone', text: 'People, time, leave and payroll in one place' },
] as const;

/** Canvas + card. `wide` shows the illustration column on md+ (sign in, register). */
function AuthShell({ title, sub, wide = true, maxWidth = 1128, children }: { title: string; sub?: ReactNode; wide?: boolean; maxWidth?: number; children: ReactNode }) {
  useEffect(() => { document.title = `${title} · Meridian`; }, [title]);
  return (
    <Box sx={{ minHeight: '100vh', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', px: { xs: 2, sm: 3 }, py: { xs: 4, md: 5 }, bgcolor: 'background.default' }}>
      <Box aria-hidden sx={{ position: 'absolute', width: { xs: 170, md: 300 }, height: { xs: 170, md: 310 }, top: { xs: -40, md: 20 }, right: { xs: -60, md: '12%' }, borderRadius: '45% 55% 40% 60%', bgcolor: 'info.main', opacity: 0.88, transform: 'rotate(-14deg)' }} />
      <Box aria-hidden sx={{ position: 'absolute', width: { xs: 165, md: 300 }, height: { xs: 165, md: 300 }, bottom: { xs: -70, md: 38 }, left: { xs: -70, md: '12%' }, borderRadius: '50%', bgcolor: 'error.main', opacity: 0.88 }} />
      <Card sx={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: wide ? { xs: 520, md: maxWidth } : 480, boxShadow: '0 10px 36px rgba(80, 105, 148, 0.12)', overflow: 'hidden' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} sx={{ minHeight: wide ? { md: 640 } : undefined }}>
          {wide && (
            <Box sx={{ display: { xs: 'none', md: 'flex' }, flex: '1 1 52%', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', bgcolor: 'primary.light', px: 6, py: 6, position: 'relative' }}>
              <Box component="img" src="/images/auth/auth-hero.png" alt="" aria-hidden sx={{ width: '100%', maxWidth: 400, height: 'auto' }} />
              <Typography variant="h4" sx={{ mt: 4, textAlign: 'center', fontSize: '1.375rem' }}>People and payroll, with the controls built in.</Typography>
              <Stack spacing={1.5} sx={{ mt: 3 }}>
                {POINTS.map((p) => (
                  <Stack key={p.text} direction="row" spacing={1.5} alignItems="center">
                    <Box sx={{ width: 34, height: 34, borderRadius: '50%', bgcolor: 'background.paper', color: 'primary.main', display: 'grid', placeItems: 'center', flex: 'none' }}><SolarIcon icon={p.icon} size={19} /></Box>
                    <Typography color="text.secondary">{p.text}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          )}
          <Box sx={{ flex: '1 1 48%', minWidth: 0, px: { xs: 3, sm: 5, md: 7 }, py: { xs: 4, sm: 5, md: 6 }, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Brand />
            <Typography variant="h3" component="h1" sx={{ fontSize: { xs: '1.5rem', sm: '1.75rem' }, mb: 1 }}>{title}</Typography>
            {sub && <Typography color="text.secondary" sx={{ mb: 3.5 }}>{sub}</Typography>}
            {children}
          </Box>
        </Stack>
      </Card>
    </Box>
  );
}

const Submit = ({ busy, children }: { busy: boolean; children: ReactNode }) => (
  <button className="btn primary" style={{ width: '100%', height: 46, fontSize: 15, marginTop: 6 }} disabled={busy}>{children}</button>
);

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
    <AuthShell title="Welcome back" sub="Sign in to your Meridian workspace.">
      {err && <Banner tone="bad">{err}</Banner>}
      <form onSubmit={submit}>
        <Field label="Work email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {needCode && (
          <Field label={useRecovery ? 'Recovery code' : '6-digit code'} hint={useRecovery ? 'Each recovery code works once.' : 'From your authenticator app.'}>
            <input className="input mono" inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" maxLength={useRecovery ? 20 : 6} value={code} onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))} required autoFocus />
          </Field>
        )}
        <Submit busy={busy}>{busy ? 'Signing in…' : needCode ? 'Verify and sign in' : 'Sign in'}</Submit>
        {needCode && <button type="button" className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => { setUseRecovery(!useRecovery); setCode(''); }}>{useRecovery ? 'Use authenticator code' : 'Use a recovery code'}</button>}
      </form>
      <Divider sx={{ my: 3.5 }} />
      <Typography sx={{ textAlign: 'center', mb: 1.5 }}><Link to="/forgot-password">Forgot password?</Link></Typography>
      <Typography color="text.secondary" sx={{ textAlign: 'center' }}>New company? <Link to="/register" style={{ fontWeight: 600 }}>Create your workspace</Link></Typography>
    </AuthShell>
  );
}

function PublicPassword({ mode }: { mode: 'forgot' | 'reset' | 'invite' }) {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [again, setAgain] = useState('');
  const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const forgot = mode === 'forgot';
  const title = forgot ? 'Forgot your password?' : mode === 'invite' ? 'Accept your invitation' : 'Reset your password';
  const sub = forgot ? 'Enter your work email and we will send a reset link if an account exists.' : mode === 'invite' ? 'Choose a password to activate your Meridian account.' : 'Choose a new password for your Meridian account.';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (forgot) { await post('/auth/forgot-password', { email: email.trim() }); setDone(true); }
      else { if (password !== again) throw new Error('The passwords do not match'); await post(mode === 'invite' ? '/auth/accept-invitation' : '/auth/reset-password', { token, password }); setDone(true); }
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return <AuthShell title={title} wide={false} sub={sub}>
    {done ? <><Banner tone="ok">{forgot ? 'If that email is registered, a reset link is on its way. Check your inbox.' : 'Your password is set. You can now sign in.'}</Banner><Typography sx={{ mt: 2, textAlign: 'center' }}><Link to="/login">Go to sign in</Link></Typography></> : <>
      {err && <Banner tone="bad">{err}</Banner>}
      <form onSubmit={submit}>
        {forgot ? <Field label="Work email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field> : <><Field label="New password" hint="At least 12 characters."><input className="input" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></Field><Field label="New password again"><input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field></>}
        <Submit busy={busy}>{busy ? 'Saving…' : forgot ? 'Email me a reset link' : mode === 'invite' ? 'Accept invitation' : 'Set new password'}</Submit>
      </form>
      <Typography sx={{ mt: 2, textAlign: 'center' }}><Link to="/login">Back to sign in</Link></Typography>
    </>}
  </AuthShell>;
}
export function ForgotPassword() { return <PublicPassword mode="forgot" />; }
export function ResetPassword() { return <PublicPassword mode="reset" />; }
export function AcceptInvitation() { return <PublicPassword mode="invite" />; }

export function Register() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ companyName: '', slug: '', country: 'AE', currency: 'AED', displayName: '', email: '', password: '' });
  const [pic, setPic] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to="/" replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await post('/auth/register', { ...f, email: f.email.trim(), companyName: f.companyName.trim() });
      if (pic) setAvatar(f.displayName, pic); // client-side only, keyed by display name
      await refresh(); nav('/settings/security');
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Create your workspace" sub="You become the owner. Turn on two-step verification straight after." maxWidth={1240}>
      {err && <Banner tone="bad">{err}</Banner>}
      <form onSubmit={submit}>
        <Field label="Company name"><input className="input" value={f.companyName} onChange={(e) => setF((x) => ({ ...x, companyName: e.target.value, slug: slugify(e.target.value) }))} required minLength={2} maxLength={120} autoFocus /></Field>
        <div className="row">
          <Field label="Workspace address" hint="Lowercase letters, numbers, dashes."><input className="input" value={f.slug} onChange={set('slug')} required minLength={2} maxLength={41} pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]" /></Field>
          <Field label="Country" hint="Pay rules ship for UAE first."><select className="input" value={f.country} onChange={set('country')}><option value="AE">United Arab Emirates</option></select></Field>
        </div>
        <Field label="Your name"><input className="input" value={f.displayName} onChange={set('displayName')} required minLength={2} maxLength={100} autoComplete="name" /></Field>
        <div className="field">
          <span className="label">Profile picture <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></span>
          <AvatarPicker name={f.displayName} value={pic} onChange={setPic} size={46} />
        </div>
        <Field label="Work email"><input className="input" type="email" value={f.email} onChange={set('email')} required autoComplete="username" /></Field>
        <Field label="Password" hint="At least 12 characters. A passphrase works well."><input className="input" type="password" value={f.password} onChange={set('password')} required minLength={12} maxLength={128} autoComplete="new-password" /></Field>
        <Submit busy={busy}>{busy ? 'Creating…' : 'Create workspace'}</Submit>
      </form>
      <Divider sx={{ my: 3 }} />
      <Typography color="text.secondary" sx={{ textAlign: 'center' }}>Already have one? <Link to="/login" style={{ fontWeight: 600 }}>Sign in</Link></Typography>
    </AuthShell>
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
    <AuthShell title="Choose a new password" wide={false} sub={me.user.mustChangePassword ? 'Choose a password to continue.' : undefined}>
      {err && <Banner tone="bad">{err}</Banner>}
      <form onSubmit={submit}>
        <Field label="Current password"><input className="input" type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 12 characters."><input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} autoComplete="new-password" /></Field>
        <Submit busy={busy}>{busy ? 'Saving…' : 'Change password'}</Submit>
      </form>
    </AuthShell>
  );
}
