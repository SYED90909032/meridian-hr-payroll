import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, fmtDate, fmtDateTime } from '../api';
import { Banner, Card, Chip, ConfirmModal, Empty, ErrorBox, Loading, PageHead, Table, useAsync, useToast } from '../ui';

/* ---------------------------------------------------------------- approvals */
interface Item { step_id: string; step_no: number; request_id: string; kind: string; title: string; payload: Record<string, any>; content_hash: string; created_at: string; requester_name: string | null; max_channel_assurance: string }

export default function Approvals() {
  const toast = useToast();
  const inbox = useAsync(() => get<{ items: Item[] }>('/flow/inbox'), []);
  const mine = useAsync(() => get<{ requests: Array<{ id: string; kind: string; title: string; status: string; created_at: string; decided_at: string | null }> }>('/flow/requests'), []);
  const [act, setAct] = useState<null | { item: Item; decision: 'approve' | 'reject' }>(null);
  return (
    <>
      <PageHead title="Approvals" sub="Each decision is bound to exactly what you see here. If the request changes, you will be asked to review again." />
      {inbox.error && <ErrorBox error={inbox.error} retry={inbox.reload} />}
      <Card title="Waiting for you" flush>
        {inbox.loading && !inbox.data ? <Loading /> : inbox.data && inbox.data.items.length ? (
          <Table head={['Request', 'From', 'Submitted', '']}>
            {inbox.data.items.map((i) => (
              <tr key={i.step_id}>
                <td><div style={{ fontWeight: 550 }}>{i.title}</div><div className="faint">{i.kind.replace(/_/g, ' ')}{i.payload?.days_x1000 ? ` · ${(i.payload.days_x1000 / 1000).toFixed(1)} days` : ''}</div></td>
                <td>{i.requester_name ?? '—'}</td><td className="nowrap">{fmtDateTime(i.created_at)}</td>
                <td className="right nowrap"><button className="btn sm danger" onClick={() => setAct({ item: i, decision: 'reject' })}>Decline</button> <button className="btn sm primary" onClick={() => setAct({ item: i, decision: 'approve' })}>Approve</button></td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="Nothing waiting">New requests routed to you will appear here.</Empty>}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Requests you made" flush>
        {mine.data && mine.data.requests.length ? (
          <Table head={['Request', 'Status', 'Submitted', 'Decided']}>
            {mine.data.requests.map((r) => <tr key={r.id}><td>{r.title}</td><td><Chip tone={r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : r.status === 'pending' ? 'warn' : ''}>{r.status}</Chip></td><td>{fmtDate(r.created_at)}</td><td>{fmtDate(r.decided_at)}</td></tr>)}
          </Table>
        ) : <Empty title="No requests yet">Leave requests you submit are tracked here. <Link to="/leave">Request leave</Link></Empty>}
      </Card>
      {act && (
        <ConfirmModal title={act.decision === 'approve' ? 'Approve request' : 'Decline request'} confirm={act.decision === 'approve' ? 'Approve' : 'Decline'} danger={act.decision === 'reject'}
          reasonLabel={act.decision === 'reject' ? 'Reason (shown to the requester)' : undefined} minReason={3} onClose={() => setAct(null)}
          body={<><strong>{act.item.title}</strong><div className="faint mono" style={{ marginTop: 6, fontSize: 11 }}>Bound to {act.item.content_hash.slice(0, 16)}…</div></>}
          onConfirm={async (comment) => { await post(`/flow/steps/${act.item.step_id}/decide`, { decision: act.decision, contentHash: act.item.content_hash, ...(comment ? { comment } : {}) }); toast(act.decision === 'approve' ? 'Approved' : 'Declined'); inbox.reload(); mine.reload(); }} />
      )}
      <Banner tone="info"><span className="muted">Email approval links exist in the API but no email provider is connected in this build, so approvals happen here.</span></Banner>
    </>
  );
}
