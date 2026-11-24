import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { fmtDate, fmtDateTime, get, money, patch, post } from '../api';
import { useSession } from '../session';
import { Banner, Card, Chip, Empty, ErrorBox, Field, FormModal, Loading, PageHead, StatusChip, Table, Tabs, useAsync, useToast } from '../ui';

interface Ticket { id: string; category: string; subject: string; confidential: boolean; status: string; assignee_user_id: string | null; created_at: string; updated_at: string; first_name?: string; last_name?: string }
interface Comment { id: string; author: string | null; body: string; internal: boolean; created_at: string }
const CATS = ['payroll', 'leave', 'benefits', 'it', 'policy', 'grievance', 'other'];

export default function Helpdesk() {
  const { id } = useParams();
  return id ? <TicketView id={id} /> : <Home />;
}

function Home() {
  const { can } = useSession();
  const agent = can('helpdesk.agent');
  const [tab, setTab] = useState<'mine' | 'queue' | 'news' | 'kb'>('mine');
  const tabs: Array<['mine' | 'queue' | 'news' | 'kb', string]> = [['mine', 'My tickets']];
  if (agent) tabs.push(['queue', 'Queue']);
  tabs.push(['news', 'Announcements'], ['kb', 'Knowledge base']);
  return (
    <>
      <PageHead title="Help" sub="Ask HR or payroll a question, and find answers." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'mine' && <Tickets scope="mine" />}
      {tab === 'queue' && <Tickets scope="queue" />}
      {tab === 'news' && <News />}
      {tab === 'kb' && <KB />}
    </>
  );
}

function Tickets({ scope }: { scope: 'mine' | 'queue' }) {
  const nav = useNavigate();
  const toast = useToast();
  const t = useAsync(() => get<{ tickets: Ticket[] }>(`/svc/tickets?scope=${scope}`), [scope]);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ category: 'payroll', subject: '', body: '', confidential: false });
  return (
    <>
      <Card title={scope === 'mine' ? 'Your tickets' : 'Everyone’s tickets'} actions={scope === 'mine' && <button className="btn primary" onClick={() => setAdd(true)}>New ticket</button>} flush>
        {t.error ? <ErrorBox error={t.error} retry={t.reload} /> : t.loading && !t.data ? <Loading /> : t.data!.tickets.length ? (
          <Table head={['Subject', ...(scope === 'queue' ? ['From'] : []), 'Category', 'Status', 'Updated']}>
            {t.data!.tickets.map((x) => (
              <tr key={x.id} className="click" onClick={() => nav(`/helpdesk/${x.id}`)}>
                <td><Link to={`/helpdesk/${x.id}`} onClick={(e) => e.stopPropagation()}><strong>{x.subject}</strong></Link> {x.confidential && <Chip tone="warn">confidential</Chip>}</td>
                {scope === 'queue' && <td>{x.first_name} {x.last_name}</td>}
                <td>{x.category}</td><td><StatusChip status={x.status} /></td><td>{fmtDateTime(x.updated_at)}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="No tickets">Raise one if you need help from HR or payroll.</Empty>}
      </Card>
      {add && (
        <FormModal title="New ticket" submit="Send" onClose={() => setAdd(false)} onSubmit={async () => { const r = await post<{ id: string }>('/svc/tickets', f); toast('Ticket sent'); nav(`/helpdesk/${r.id}`); }}>
          <Field label="Category"><select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Subject"><input className="input" required maxLength={200} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
          <Field label="Details"><textarea className="input" required rows={5} maxLength={10000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={f.confidential} onChange={(e) => setF({ ...f, confidential: e.target.checked })} /> Confidential: only designated HR staff can see this</label>
        </FormModal>
      )}
    </>
  );
}

function TicketView({ id }: { id: string }) {
  const { can } = useSession();
  const toast = useToast();
  const d = useAsync(() => get<{ ticket: Ticket & { body: string }; comments: Comment[] }>(`/svc/tickets/${id}`), [id]);
  const [text, setText] = useState(''); const [internal, setInternal] = useState(false); const [busy, setBusy] = useState(false);
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Loading />;
  const { ticket, comments } = d.data;
  const agent = can('helpdesk.agent');
  const setStatus = async (status: string) => { try { await patch(`/svc/tickets/${id}`, { status }); toast('Updated'); d.reload(); } catch (e: any) { toast(e.message, true); } };
  return (
    <>
      <PageHead title={ticket.subject} sub={<><Link to="/helpdesk">Help</Link> / {ticket.category} · <StatusChip status={ticket.status} /> {ticket.confidential && <Chip tone="warn">confidential</Chip>}</>}>
        {agent ? <select className="input" value={ticket.status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{['open', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
          : ticket.status !== 'closed' && <button className="btn" onClick={() => setStatus('closed')}>Close ticket</button>}
      </PageHead>
      <Card>
        <div className="muted" style={{ marginBottom: 6 }}>{ticket.first_name} {ticket.last_name} · {fmtDateTime(ticket.created_at)}</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{ticket.body}</div>
      </Card>
      <div style={{ height: 12 }} />
      {comments.map((c) => (
        <div key={c.id} className={'bubble' + (c.internal ? ' internal' : '')}>
          <div className="faint">{c.author ?? 'Someone'} · {fmtDateTime(c.created_at)} {c.internal && <Chip tone="warn">internal note, hidden from requester</Chip>}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
        </div>
      ))}
      {ticket.status !== 'closed' && (
        <Card title="Reply">
          <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await post(`/svc/tickets/${id}/comments`, { body: text, internal }); setText(''); setInternal(false); d.reload(); } catch (x: any) { toast(x.message, true); } finally { setBusy(false); } }}>
            <textarea className="input" required rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" />
            <div className="inline" style={{ marginTop: 10, justifyContent: 'space-between' }}>
              {agent ? <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label> : <span />}
              <button className="btn primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}

function News() {
  const { can } = useSession();
  const toast = useToast();
  const a = useAsync(() => get<{ announcements: Array<{ id: string; title: string; body: string; published_at: string; author: string | null }> }>('/svc/announcements'), []);
  const [add, setAdd] = useState(false); const [f, setF] = useState({ title: '', body: '' });
  return (
    <>
      <Card title="Announcements" actions={can('content.write') && <button className="btn primary" onClick={() => setAdd(true)}>Post</button>}>
        {a.error ? <ErrorBox error={a.error} retry={a.reload} /> : a.loading && !a.data ? <Loading /> : a.data!.announcements.length ? a.data!.announcements.map((x) => (
          <div key={x.id} style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}><strong>{x.title}</strong><div className="faint">{x.author} · {fmtDate(x.published_at)}</div><div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{x.body}</div></div>
        )) : <Empty title="No announcements" />}
      </Card>
      {add && <FormModal title="Post an announcement" submit="Post" onClose={() => setAdd(false)} onSubmit={async () => { await post('/svc/announcements', f); toast('Posted. Everyone has been notified.'); a.reload(); }}>
        <Field label="Title"><input className="input" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message"><textarea className="input" required rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      </FormModal>}
    </>
  );
}

function KB() {
  const { can } = useSession();
  const toast = useToast();
  const k = useAsync(() => get<{ articles: Array<{ id: string; title: string; excerpt: string; status: string; version: number }> }>('/svc/kb'), []);
  const [open, setOpen] = useState<null | { id: string; title: string; body: string; version: number; status: string }>(null);
  const [add, setAdd] = useState(false); const [f, setF] = useState({ title: '', body: '', status: 'published' });
  return (
    <>
      <Card title="Knowledge base" actions={can('content.write') && <button className="btn primary" onClick={() => setAdd(true)}>New article</button>} flush>
        {k.error ? <ErrorBox error={k.error} retry={k.reload} /> : k.loading && !k.data ? <Loading /> : k.data!.articles.length ? (
          <Table head={['Article', 'Status']}>{k.data!.articles.map((x) => <tr key={x.id} className="click" onClick={async () => setOpen(await get(`/svc/kb/${x.id}`))}><td><strong>{x.title}</strong><div className="faint">{x.excerpt}</div></td><td><StatusChip status={x.status === 'published' ? 'active' : 'draft'} /></td></tr>)}</Table>
        ) : <Empty title="No articles yet" />}
      </Card>
      {open && <FormModal title={open.title} submit="Close" onClose={() => setOpen(null)} onSubmit={async () => undefined} wide><div style={{ whiteSpace: 'pre-wrap' }}>{open.body}</div></FormModal>}
      {add && <FormModal title="New article" onClose={() => setAdd(false)} onSubmit={async () => { await post('/svc/kb', f); toast('Saved'); k.reload(); }} wide>
        <Field label="Title"><input className="input" required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Body"><textarea className="input" required rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="published">Published</option><option value="draft">Draft</option></select></Field>
      </FormModal>}
    </>
  );
}

export { Banner };
