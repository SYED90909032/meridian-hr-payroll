import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { fmtDateTime, get, post, put } from '../api';
import { useMe, useSession } from '../session';
import { Banner, Card, Chip, ConfirmModal, ErrorBox, Field, FormModal, Loading, Modal, PageHead, Table, useAsync, useToast } from '../ui';

export default function Security() {
  const { refresh } = useSession(); const me = useMe();
  const toast = useToast();
  const sessions = useAsync(() => get<{ sessions: Array<{ id: string; created_at: string; last_seen_at: string; ip: string | null; user_agent: string | null; current: boolean }> }>('/auth/sessions'), []);
  const preferences = useAsync(() => get<{ preferences: Array<{ kind: string; email_enabled: boolean }>; securityEmailRequired: boolean }>('/comms/notification-preferences'), []);
  const [enrol, setEnrol] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [off, setOff] = useState(false);
  const [pw, setPw] = useState(false);
  const [others, setOthers] = useState(false);
  return (
    <>
      <PageHead title="Security" sub="Protect your account and see where you are signed in." />
      <Card title="Two-step verification" actions={me.user.totpEnabled ? <Chip tone="ok">On</Chip> : <Chip tone="warn">Off</Chip>}>
        <p className="muted" style={{ marginTop: 0 }}>{me.user.totpEnabled ? 'Your account asks for a 6-digit code from your authenticator app at sign-in. Approving payroll requires it.' : 'Add an authenticator app (such as Google Authenticator, 1Password or Authy). It is required to approve payroll.'}</p>
        {me.user.totpEnabled ? <button className="btn" onClick={() => setOff(true)}>Turn off</button> : <button className="btn primary" onClick={() => setEnrol(true)}>Set up</button>}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Password" actions={<button className="btn" onClick={() => setPw(true)}>Change password</button>}>
        <span className="muted">Use at least 12 characters. A long phrase is better than a clever short one. Changing it signs out your other devices.</span>
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Notification emails">
        <p className="muted">Security messages are always sent. Other transactional email can be adjusted here.</p>
        {preferences.data?.securityEmailRequired && <p className="muted">Security email cannot be turned off.</p>}
        {(['leave-requested', 'leave-decided', 'approval-pending', 'pay-run-ready', 'payslip-published'] as const).map((kind) => {
          const enabled = preferences.data?.preferences.find((x) => x.kind === kind)?.email_enabled ?? true;
          return <label key={kind} className="check"><input type="checkbox" checked={enabled} onChange={async (e) => { await put('/comms/notification-preferences', { kind, emailEnabled: e.target.checked }); preferences.reload(); }} /> Email: {kind.replaceAll('-', ' ')}</label>;
        })}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Where you are signed in" actions={<button className="btn" onClick={() => setOthers(true)}>Sign out everywhere else</button>} flush>
        {sessions.error ? <ErrorBox error={sessions.error} retry={sessions.reload} /> : sessions.loading && !sessions.data ? <Loading /> : (
          <Table head={['Device', 'Address', 'Last active', '']}>
            {sessions.data!.sessions.map((s) => <tr key={s.id}><td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.user_agent ?? 'Unknown'}</td><td className="mono">{s.ip ?? '—'}</td><td>{fmtDateTime(s.last_seen_at)}</td><td>{s.current && <Chip tone="ok">this device</Chip>}</td></tr>)}
          </Table>
        )}
      </Card>
      {enrol && <Enrol onClose={() => setEnrol(false)} onDone={(c) => { setCodes(c); refresh(); }} />}
      {codes && (
        <Modal title="Save your recovery codes" onClose={() => setCodes(null)} footer={<button className="btn primary" onClick={() => setCodes(null)}>I have saved them</button>}>
          <Banner tone="warn">Each code works once if you lose your phone. They are shown only now.</Banner>
          <div className="codes mono">{codes.map((c) => <div key={c}>{c}</div>)}</div>
          <button className="btn sm" onClick={() => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Copied'))}>Copy all</button>
        </Modal>
      )}
      {off && <ConfirmModal title="Turn off two-step verification" confirm="Turn off" danger body="You will lose the ability to approve payroll until you set it up again." onClose={() => setOff(false)} onConfirm={async () => { await post('/auth/mfa/disable'); toast('Turned off'); refresh(); }} />}
      {pw && <ChangePw onClose={() => setPw(false)} />}
      {others && <ConfirmModal title="Sign out other devices" confirm="Sign out" body="Every session except this one will end." onClose={() => setOthers(false)} onConfirm={async () => { await post('/auth/sessions/revoke-others'); toast('Done'); sessions.reload(); }} />}
    </>
  );
}

function Enrol({ onClose, onDone }: { onClose: () => void; onDone: (codes: string[]) => void }) {
  const [info, setInfo] = useState<{ secret: string; uri: string } | null>(null);
  const [qr, setQr] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  useEffect(() => { post<{ secret: string; uri: string }>('/auth/mfa/begin').then(setInfo).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (info) QRCode.toDataURL(info.uri, { margin: 1, width: 192 }).then(setQr).catch(() => undefined); }, [info]);
  if (err) return <Modal title="Set up two-step verification" onClose={onClose}><Banner tone="bad">{err}</Banner></Modal>;
  if (!info) return <Modal title="Set up two-step verification" onClose={onClose}><Loading /></Modal>;
  return (
    <FormModal title="Set up two-step verification" submit="Verify and turn on" onClose={onClose} onSubmit={async () => { const r = await post<{ recoveryCodes: string[] }>('/auth/mfa/confirm', { code }); onDone(r.recoveryCodes); }}>
      <ol className="steps"><li>Scan this code with your authenticator app.</li></ol>
      <div className="center">{qr ? <img src={qr} width={192} height={192} alt="QR code for your authenticator app" /> : <Loading />}</div>
      <div className="faint" style={{ textAlign: 'center', margin: '8px 0 14px' }}>Or enter this key by hand: <span className="mono">{info.secret.match(/.{1,4}/g)?.join(' ')}</span></div>
      <Field label="Then enter the 6-digit code it shows"><input className="input mono" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
    </FormModal>
  );
}

function ChangePw({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  return (
    <FormModal title="Change password" onClose={onClose} onSubmit={async () => { if (f.next !== f.again) throw new Error('The new passwords do not match'); await post('/auth/change-password', { current: f.current, next: f.next }); toast('Password changed'); }}>
      <Field label="Current password"><input className="input" type="password" autoComplete="current-password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="New password" hint="At least 12 characters."><input className="input" type="password" autoComplete="new-password" minLength={12} required value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      <Field label="New password again"><input className="input" type="password" autoComplete="new-password" required value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field>
    </FormModal>
  );
}
