import { Fragment, useState } from 'react';
import { fmtDateTime, get, post } from '../api';
import { useSession } from '../session';
import { Banner, Card, Chip, Empty, ErrorBox, Loading, PageHead, Table, Tabs, useAsync, useToast } from '../ui';

interface Ev { seq: string; at: string; actor: string | null; action: string; entity: string | null; entity_id: string | null; data: unknown; ip: string | null; hash: string }
interface Block { from_seq: string; to_seq: string; merkle_root: string; signature: string; key_id: string; sealed_at: string }

/** Activity types offered in the filter. Each maps to the action prefix the API filters on
 *  (`kernel.audit_event.action LIKE '<prefix>%'`). Taken from the audit() calls in apps/api. */
const ACTION_GROUPS: Array<[string, Array<[string, string]>]> = [
  ['Payroll', [['pay_run.', 'Pay runs'], ['pay_group.', 'Pay groups'], ['pay.', 'Adjustments and controls'], ['payslip.', 'Payslips viewed'], ['payment_file.', 'Payment files']]],
  ['People', [['employee.', 'Employee records'], ['compensation.', 'Compensation'], ['bank.', 'Bank details'], ['identity.', 'Identity details'], ['pii.', 'Sensitive data revealed'], ['document.', 'Documents'], ['org.', 'Organisation']]],
  ['Time and leave', [['leave.', 'Leave requests'], ['leave_type.', 'Leave types'], ['attendance.', 'Attendance'], ['punch.', 'Clock-ins'], ['shift.', 'Shifts'], ['holiday.', 'Public holidays'], ['time.', 'Time settings']]],
  ['Workflow', [['approval.', 'Approvals'], ['announcement.', 'Announcements'], ['ticket.', 'Helpdesk tickets'], ['kb.', 'Knowledge base'], ['assistant.', 'Assistant questions']]],
  ['Security and access', [['iam.', 'Members and roles'], ['device.', 'Devices'], ['apikey.', 'API keys'], ['webhook.', 'Webhooks'], ['audit.', 'Audit sealing'], ['tenant.', 'Workspace']]],
];
export default function Audit() {
  const { can } = useSession();
  const toast = useToast();
  const [tab, setTab] = useState<'events' | 'integrity'>('events');
  const [filter, setFilter] = useState('');
  const [applied, setApplied] = useState('');
  const [before, setBefore] = useState<string | null>(null);
  const [rows, setRows] = useState<Ev[]>([]);
  const ev = useAsync(async () => {
    const r = await get<{ events: Ev[] }>(`/audit/events?limit=50${applied ? `&action=${encodeURIComponent(applied)}` : ''}${before ? `&before_seq=${before}` : ''}`);
    setRows((x) => (before ? [...x, ...r.events] : r.events));
    return r;
  }, [applied, before]);
  const [open, setOpen] = useState<string | null>(null);
  // Free-text search narrows the rows already loaded (who / action / subject, case-insensitive);
  // the Activity type select is sent to the API as an action prefix (`?action=pay_run.`).
  const q = filter.trim().toLowerCase().replace(/\s+/g, ' ');
  const shown = q ? rows.filter((e) => [e.actor ?? 'system', e.action, e.action.replace(/[._]/g, ' '), e.entity ?? ''].some((v) => v.toLowerCase().includes(q))) : rows;
  const ver = useAsync(() => get<{ intact: boolean; first_broken_seq: string | null; bad_blocks: unknown[]; sealed_blocks: number }>('/audit/verify'), []);
  const blocks = useAsync(() => get<{ blocks: Block[]; public_key_pem: string; key_id: string }>('/audit/blocks'), []);
  return (
    <>
      <PageHead title="Audit log" sub="Every sensitive action is recorded, chained by hash, and can be sealed with a signature.">
        {can('audit.seal') && <button className="btn" onClick={async () => { try { const r = await post<any>('/audit/seal'); toast(r.sealed === false ? 'Nothing new to seal' : 'Sealed'); blocks.reload(); ver.reload(); } catch (e: any) { toast(e.message, true); } }}>Seal now</button>}
      </PageHead>
      <Tabs tabs={[['events', 'Events'], ['integrity', 'Integrity']]} value={tab} onChange={setTab} />
      {tab === 'events' && (
        <Card title="Events" actions={
          <div className="inline audit-filters">
            <select className="input" aria-label="Activity type" value={applied} onChange={(e) => { setBefore(null); setApplied(e.target.value); }}>
              <option value="">All activity</option>
              {ACTION_GROUPS.map(([group, items]) => (
                <optgroup key={group} label={group}>{items.map(([prefix, label]) => <option key={prefix} value={prefix}>{label}</option>)}</optgroup>
              ))}
            </select>
            <input className="input" type="search" placeholder="Search who, action or subject" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search loaded events" />
            {(applied || filter) && <button type="button" className="btn ghost" onClick={() => { setFilter(''); setBefore(null); setApplied(''); }}>Clear</button>}
          </div>} flush>
          {ev.error ? <ErrorBox error={ev.error} retry={ev.reload} /> : ev.loading && !rows.length ? <Loading /> : shown.length ? (
            <>
              <Table head={['#', 'When', 'Who', 'Action', 'Subject']}>
                {shown.map((e) => (
                  <Fragment key={e.seq}>
                    <tr className="click" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
                      <td className="mono faint">{e.seq}</td><td className="nowrap">{fmtDateTime(e.at)}</td><td>{e.actor ?? <span className="faint">system</span>}</td><td className="mono">{e.action}</td><td className="faint">{e.entity}</td>
                    </tr>
                    {open === e.seq && <tr><td colSpan={5}><pre className="pre">{JSON.stringify({ data: e.data, entity_id: e.entity_id, ip: e.ip, hash: e.hash }, null, 2)}</pre></td></tr>}
                  </Fragment>
                ))}
              </Table>
              {ev.data && ev.data.events.length === 50 && <div className="card-b">{q && <span className="faint" style={{ marginRight: 12 }}>Search covers the {rows.length} events loaded so far.</span>}<button className="btn" onClick={() => setBefore(rows[rows.length - 1].seq)}>Load older</button></div>}
            </>
          ) : <Empty title="No events match">{q && rows.length ? 'Nothing in the loaded events matches your search. Try another word, choose a different activity type or load older events.' : 'There is no recorded activity of this type yet.'}</Empty>}
        </Card>
      )}
      {tab === 'integrity' && (
        <>
          <Card title="Chain check">
            {ver.error ? <ErrorBox error={ver.error} retry={ver.reload} /> : ver.data ? (
              ver.data.intact ? <Banner tone="ok">The hash chain is intact and {ver.data.sealed_blocks} sealed block(s) match their signatures.</Banner>
                : <Banner tone="bad">Tampering detected. {ver.data.first_broken_seq ? `Chain breaks at event ${ver.data.first_broken_seq}. ` : ''}{ver.data.bad_blocks.length ? `${ver.data.bad_blocks.length} sealed block(s) do not match.` : ''}</Banner>
            ) : <Loading />}
            <button className="btn" onClick={ver.reload}>Check again</button>
          </Card>
          <div style={{ height: 16 }} />
          <Card title="Sealed blocks" flush>
            {blocks.data?.blocks.length ? (
              <Table head={['Events', 'Sealed', 'Merkle root']}>{blocks.data.blocks.map((b) => <tr key={b.from_seq}><td>{b.from_seq} – {b.to_seq}</td><td>{fmtDateTime(b.sealed_at)}</td><td className="mono">{b.merkle_root.slice(0, 24)}…</td></tr>)}</Table>
            ) : <Empty title="Nothing sealed yet">Sealing signs a batch of events with an Ed25519 key so later edits can be detected even by someone with database access.</Empty>}
          </Card>
          {blocks.data && <><div style={{ height: 16 }} /><Card title={<>Public key <Chip>{blocks.data.key_id}</Chip></>}><p className="muted" style={{ marginTop: 0 }}>Use this to verify block signatures independently.</p><pre className="pre">{blocks.data.public_key_pem}</pre></Card></>}
        </>
      )}
    </>
  );
}
