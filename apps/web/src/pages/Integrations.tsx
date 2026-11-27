import { useState } from 'react';
import { del, fmtDate, fmtDateTime, get, patch, post, put } from '../api';
import { useSession } from '../session';
import { Banner, Card, Chip, ConfirmModal, Drawer, Empty, ErrorBox, Field, FormModal, Loading, Modal, PageHead, StatusChip, Table, Tabs, useAsync, useToast } from '../ui';

const SCOPES = ['people.read', 'time.read', 'leave.read', 'audit.read', 'insight.read'];
const TOPICS = ['*', 'employee.created', 'employee.updated', 'leave.approved', 'leave.rejected', 'pay_run.approved', 'pay_run.paid', 'pay_run.published', 'approval.resolved'];

export default function Integrations() {
  const { can } = useSession();
  const [tab, setTab] = useState<'keys' | 'hooks' | 'sso' | 'scim'>(can('apikey.manage') ? 'keys' : can('settings.manage') ? 'sso' : 'hooks');
  const tabs: Array<['keys' | 'hooks' | 'sso' | 'scim', string]> = [];
  if (can('apikey.manage')) tabs.push(['keys', 'API keys']);
  if (can('webhook.manage')) tabs.push(['hooks', 'Webhooks']);
  if (can('settings.manage')) { tabs.push(['sso', 'SSO']); tabs.push(['scim', 'SCIM']); }
  return (
    <>
      <PageHead title="Integrations" sub="Connect other systems. Secrets are shown once and stored only as hashes or encrypted." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'keys' ? <Keys /> : tab === 'hooks' ? <Hooks /> : tab === 'sso' ? <Sso /> : <Scim />}
    </>
  );
}

function SecretShown({ title, label, secret, note, onClose }: { title: string; label: string; secret: string; note: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal title={title} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>I have saved it</button>}>
      <Banner tone="warn">{note}</Banner>
      <div className="faint" style={{ marginBottom: 4 }}>{label}</div>
      <div className="secret mono">{secret}</div>
      <button className="btn sm" onClick={() => navigator.clipboard?.writeText(secret).then(() => toast('Copied'))}>Copy</button>
    </Modal>
  );
}

function Sso() {
  const toast = useToast();
  const current = useAsync(() => get<{ config: { issuer_url: string; client_id: string; allowed_email_domains: string[]; enabled: boolean; jit_provision: boolean; default_role: string; group_claim: string | null; idp_mfa_satisfies: boolean } | null }>('/iam/sso'), []);
  const [f, setF] = useState({ issuerUrl: '', clientId: '', clientSecret: '', allowedEmailDomains: '', enabled: false, jitProvision: false, defaultRole: 'employee', groupClaim: '', idpMfaSatisfies: false });
  const c = current.data?.config;
  const save = async () => { await put('/iam/sso', { ...f, allowedEmailDomains: f.allowedEmailDomains.split(',').map((x) => x.trim()).filter(Boolean), groupClaim: f.groupClaim || undefined }); toast('SSO settings saved'); current.reload(); };
  return <Card title="OIDC single sign-on" actions={<Chip tone={c?.enabled ? 'ok' : 'warn'}>{c?.enabled ? 'Enabled' : 'Disabled'}</Chip>}>
    <p className="muted" style={{ marginTop: 0 }}>Discovery, signature validation, nonce and PKCE checks are handled by the maintained openid-client library. The client secret is encrypted before storage.</p>
    <div className="grid g2"><Field label="Issuer URL"><input className="input mono" type="url" value={f.issuerUrl || c?.issuer_url || ''} onChange={(e) => setF({ ...f, issuerUrl: e.target.value })} placeholder="https://idp.example.com" /></Field><Field label="Client ID"><input className="input mono" value={f.clientId || c?.client_id || ''} onChange={(e) => setF({ ...f, clientId: e.target.value })} /></Field></div>
    <Field label="Client secret"><input className="input" type="password" value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} autoComplete="new-password" /></Field>
    <Field label="Allowed email domains" hint="Comma-separated; leave empty to allow any verified domain."><input className="input mono" value={f.allowedEmailDomains} onChange={(e) => setF({ ...f, allowedEmailDomains: e.target.value })} /></Field>
    <div className="roles"><label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Enable SSO</label><label className="check"><input type="checkbox" checked={f.jitProvision} onChange={(e) => setF({ ...f, jitProvision: e.target.checked })} /> Allow just-in-time users</label></div>
    <button className="btn primary" style={{ marginTop: 14 }} disabled={!f.issuerUrl || !f.clientId || !f.clientSecret} onClick={save}>Save SSO settings</button>
  </Card>;
}
function Scim() {
  const toast = useToast();
  const list = useAsync(() => get<{ tokens: Array<{ id: string; token_prefix: string; label: string; expires_at: string; revoked_at: string | null }> }>('/iam/scim-tokens'), []);
  const [show, setShow] = useState<string | null>(null); const [label, setLabel] = useState('Directory provisioning');
  const create = async () => { const r = await post<{ token: string }>('/iam/scim-tokens', { label, expiresInDays: 365 }); setShow(r.token); list.reload(); };
  return <Card title="SCIM 2.0 provisioning" actions={<button className="btn primary" onClick={create}>Create token</button>} flush>
    <p className="muted" style={{ margin: '0 16px 14px' }}>Supported subset: ServiceProviderConfig, Schemas, ResourceTypes, Users list/filter/GET/POST/PUT/PATCH/DELETE (deactivate), and mapped Groups read. Tokens are hashed and shown once.</p>
    <Field label="Token label"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
    {list.data?.tokens.length ? <Table head={['Label', 'Prefix', 'Expires', 'Status', '']}>
      {list.data.tokens.map((x) => <tr key={x.id}><td>{x.label}</td><td className="mono">{x.token_prefix}…</td><td>{fmtDate(x.expires_at)}</td><td>{x.revoked_at ? <Chip tone="bad">revoked</Chip> : <Chip tone="ok">active</Chip>}</td><td className="right">{!x.revoked_at && <button className="btn sm ghost" onClick={async () => { await del(`/iam/scim-tokens/${x.id}`); toast('Token revoked'); list.reload(); }}>Revoke</button>}</td></tr>)}
    </Table> : <Empty title="No SCIM tokens" />}
    {show && <SecretShown title="SCIM bearer token" label="Authorization: Bearer …" secret={show} note="Copy this token now. It cannot be shown again." onClose={() => setShow(null)} />}
  </Card>;
}
function Keys() {
  const toast = useToast();
  const k = useAsync(() => get<{ keys: Array<{ id: string; name: string; prefix: string; scopes: string[]; expires_at: string; revoked_at: string | null; last_used_at: string | null }> }>('/platform/api-keys'), []);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ name: '', scopes: ['people.read'] as string[], days: 90 });
  const [shown, setShown] = useState<string | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  return (
    <>
      <Card title="API keys" actions={<button className="btn primary" onClick={() => setAdd(true)}>Create key</button>} flush>
        {k.error ? <ErrorBox error={k.error} retry={k.reload} /> : k.loading && !k.data ? <Loading /> : k.data!.keys.length ? (
          <Table head={['Name', 'Key', 'Access', 'Expires', 'Last used', '']}>
            {k.data!.keys.map((x) => (
              <tr key={x.id}><td><strong>{x.name}</strong></td><td className="mono">{x.prefix}…</td><td>{x.scopes.map((s) => <Chip key={s}>{s}</Chip>)}</td><td>{fmtDate(x.expires_at)}</td><td>{fmtDateTime(x.last_used_at)}</td>
                <td className="right">{x.revoked_at ? <Chip tone="bad">revoked</Chip> : <button className="btn sm ghost" onClick={() => setRev(x.id)}>Revoke</button>}</td></tr>
            ))}
          </Table>
        ) : <Empty title="No API keys">Keys are read-only and expire. Use them for reporting tools and dashboards.</Empty>}
      </Card>
      {add && (
        <FormModal title="Create an API key" submit="Create" onClose={() => setAdd(false)} onSubmit={async () => { if (!f.scopes.length) throw new Error('Choose at least one permission'); const r = await post<{ key: string }>('/platform/api-keys', { name: f.name, scopes: f.scopes, expires_in_days: +f.days }); setShown(r.key); k.reload(); }}>
          <Field label="Name"><input className="input" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Can read"><div className="roles">{SCOPES.map((s) => <label key={s} className="check"><input type="checkbox" checked={f.scopes.includes(s)} onChange={(e) => setF({ ...f, scopes: e.target.checked ? [...f.scopes, s] : f.scopes.filter((x) => x !== s) })} /> <span className="mono">{s}</span></label>)}</div></Field>
          <Field label="Expires in (days)"><input className="input" type="number" min={1} max={365} value={f.days} onChange={(e) => setF({ ...f, days: +e.target.value })} /></Field>
          <div className="faint">Keys can only read, never change data, and never see pay, bank or private details.</div>
        </FormModal>
      )}
      {shown && <SecretShown title="Your new API key" label="Send as the X-Api-Key header" secret={shown} note="Copy this key now. It cannot be shown again." onClose={() => setShown(null)} />}
      {rev && <ConfirmModal title="Revoke key" confirm="Revoke" danger body="Anything using this key stops working immediately." onClose={() => setRev(null)} onConfirm={async () => { await del(`/platform/api-keys/${rev}`); toast('Revoked'); k.reload(); }} />}
    </>
  );
}

function Hooks() {
  const toast = useToast();
  const h = useAsync(() => get<{ endpoints: Array<{ id: string; url: string; events: string[]; active: boolean; created_at: string }> }>('/platform/webhooks'), []);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ url: 'https://', events: ['*'] as string[] });
  const [shown, setShown] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);
  return (
    <>
      <Card title="Webhook endpoints" actions={<button className="btn primary" onClick={() => setAdd(true)}>Add endpoint</button>} flush>
        {h.error ? <ErrorBox error={h.error} retry={h.reload} /> : h.loading && !h.data ? <Loading /> : h.data!.endpoints.length ? (
          <Table head={['URL', 'Events', 'Status', '']}>
            {h.data!.endpoints.map((x) => (
              <tr key={x.id}><td className="mono" style={{ wordBreak: 'break-all' }}>{x.url}</td><td>{x.events.map((e) => <Chip key={e}>{e}</Chip>)}</td><td>{x.active ? <Chip tone="ok">active</Chip> : <Chip>paused</Chip>}</td>
                <td className="right nowrap"><button className="btn sm ghost" onClick={() => setLog(x.id)}>Deliveries</button><button className="btn sm ghost" onClick={async () => { try { await patch(`/platform/webhooks/${x.id}`, { active: !x.active }); h.reload(); } catch (e: any) { toast(e.message, true); } }}>{x.active ? 'Pause' : 'Resume'}</button></td></tr>
            ))}
          </Table>
        ) : <Empty title="No endpoints">We call your URL with a signed JSON body when something happens.</Empty>}
      </Card>
      <Banner tone="info"><span className="muted">Only public https addresses are allowed. We resolve the address, refuse private and internal ranges, and connect to the checked address. Payloads carry no pay, bank or private data, only identifiers.</span></Banner>
      {add && (
        <FormModal title="Add a webhook endpoint" onClose={() => setAdd(false)} submit="Add" onSubmit={async () => { if (!f.events.length) throw new Error('Choose at least one event'); const r = await post<{ secret: string }>('/platform/webhooks', f); setShown(r.secret); h.reload(); }}>
          <Field label="URL" hint="Must be https and publicly reachable."><input className="input mono" type="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
          <Field label="Events"><div className="roles">{TOPICS.map((t) => <label key={t} className="check"><input type="checkbox" checked={f.events.includes(t)} onChange={(e) => setF({ ...f, events: e.target.checked ? [...f.events, t] : f.events.filter((x) => x !== t) })} /> <span className="mono">{t === '*' ? '* (all events)' : t}</span></label>)}</div></Field>
        </FormModal>
      )}
      {shown && <SecretShown title="Signing secret" label="Verify X-Meridian-Signature: v1=HMAC-SHA256 of “<timestamp>.<body>”" secret={shown} note="Copy this secret now. It cannot be shown again." onClose={() => setShown(null)} />}
      {log && <Deliveries id={log} onClose={() => setLog(null)} />}
    </>
  );
}

function Deliveries({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useAsync(() => get<{ deliveries: Array<{ id: string; event: string; status: string; attempts: number; response_code: number | null; last_error: string | null; created_at: string }> }>(`/platform/webhooks/${id}/deliveries`), [id]);
  return (
    <Drawer title="Recent deliveries" onClose={onClose}>
      {d.error ? <ErrorBox error={d.error} retry={d.reload} /> : !d.data ? <Loading /> : d.data.deliveries.length ? (
        <Table head={['Event', 'Status', 'Tries', 'Response']}>
          {d.data.deliveries.map((x) => <tr key={x.id}><td><div className="mono">{x.event}</div><div className="faint">{fmtDateTime(x.created_at)}</div></td><td><StatusChip status={x.status} /></td><td className="num">{x.attempts}</td><td>{x.response_code ?? x.last_error ?? '—'}</td></tr>)}
        </Table>
      ) : <Empty title="No deliveries yet" />}
    </Drawer>
  );
}
