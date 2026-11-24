import { useEffect, useRef, useState } from 'react';
import { get, post } from '../api';
import { Banner, PageHead, Spinner, useToast } from '../ui';

interface Msg { role: string; content: string; created_at?: string }
const SUGGEST = ['What is my leave balance?', 'Who is on leave today?', 'How many people work here?', 'What approvals are waiting for me?', 'What are the next public holidays?'];

export default function Assistant() {
  const toast = useToast();
  const [conv, setConv] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, busy]);
  const send = async (content: string) => {
    if (!content.trim() || busy) return;
    setBusy(true); setText('');
    setMsgs((m) => [...m, { role: 'user', content }]);
    try {
      let id = conv;
      if (!id) { id = (await post<{ id: string }>('/assistant/conversations')).id; setConv(id); }
      const r = await post<{ answer: string; tool: string | null }>(`/assistant/conversations/${id}/messages`, { content });
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer }]);
    } catch (e: any) { toast(e.message, true); setMsgs((m) => m.slice(0, -1)); setText(content); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title="Assistant" sub="Answers from your own data, limited to what you are already allowed to see." />
      <Banner tone="info"><span className="muted">The assistant can only look things up through fixed, permission-checked queries. It never sees salaries, bank details, ID numbers or leave reasons, and it cannot change anything.</span></Banner>
      <div className="chatbox">
        <div className="chat-body">
          {!msgs.length && <div className="empty"><h3>Ask a question</h3><div className="inline" style={{ justifyContent: 'center', marginTop: 10 }}>{SUGGEST.map((s) => <button key={s} className="btn sm" onClick={() => send(s)}>{s}</button>)}</div></div>}
          {msgs.map((m, i) => <div key={i} className={'msg ' + m.role}>{m.content}</div>)}
          {busy && <div className="msg assistant"><Spinner /></div>}
          <div ref={end} />
        </div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input className="input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Ask about leave, headcount, approvals…" aria-label="Message" />
          <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      </div>
    </>
  );
}
