import { Fragment, useState } from 'react';
import { fmtDateTime, get, post } from '../api';
import { useSession } from '../session';
import { Banner, Card, Chip, Empty, ErrorBox, Loading, PageHead, Table, Tabs, useAsync, useToast } from '../ui';

interface Ev { seq: string; at: string; actor: string | null; action: string; entity: string | null; entity_id: string | null; data: unknown; ip: string | null; hash: string }
interface Block { from_seq: string; to_seq: string; merkle_root: string; signature: string; key_id: string; sealed_at: string }

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
  const ver = useAsync(() => get<{ intact: boolean; first_broken_seq: string | null; bad_blocks: unknown[]; sealed_blocks: number }>('/audit/verify'), []);
  const blocks = useAsync(() => get<{ blocks: Block[]; public_key_pem: string; key_id: string }>('/audit/blocks'), []);
  return (
    <>
      <PageHead title="Audit log" sub="Every sensitive action is recorded, chained by hash, and can be sealed with a signature.">
        {can('audit.seal') && <button className="btn" onClick={async () => { try { const r = await post<any>('/audit/seal'); toast(r.sealed === false ? 'Nothing new to seal' : 'Sealed'); blocks.reload(); ver.reload(); } catch (e: any) { toast(e.message, true); } }}>Seal now</button>}
      </PageHead>
      <Tabs tabs={[['events', 'Events'], ['integrity', 'Integrity']]} value={tab} onChange={setTab} />
      {tab === 'events' && (
        <Card actions={<form className="inline" onSubmit={(e) => { e.preventDefault(); setBefore(null); setApplied(filter.trim()); }}><input className="input" placeholder="Action prefix, e.g. pay_run." value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter" /><button className="btn">Filter</button></form>} flush>
          {ev.error ? <ErrorBox error={ev.error} retry={ev.reload} /> : ev.loading && !rows.length ? <Loading /> : rows.length ? (
            <>
              <Table head={['#', 'When', 'Who', 'Action', 'Subject']}>
                {rows.map((e) => (
                  <Fragment key={e.seq}>
                    <tr className="click" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
                      <td className="mono faint">{e.seq}</td><td className="nowrap">{fmtDateTime(e.at)}</td><td>{e.actor ?? <span className="faint">system</span>}</td><td className="mono">{e.action}</td><td className="faint">{e.entity}</td>
                    </tr>
                    {open === e.seq && <tr><td colSpan={5}><pre className="pre">{JSON.stringify({ data: e.data, entity_id: e.entity_id, ip: e.ip, hash: e.hash }, null, 2)}</pre></td></tr>}
                  </Fragment>
                ))}
              </Table>
              {ev.data && ev.data.events.length === 50 && <div className="card-b"><button className="btn" onClick={() => setBefore(rows[rows.length - 1].seq)}>Load older</button></div>}
            </>
          ) : <Empty title="No events match" />}
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
