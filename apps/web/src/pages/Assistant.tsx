import { useEffect, useRef, useState } from 'react';
import { get, post } from '../api';
import { Banner, PageHead, Spinner, useToast } from '../ui';

interface Msg { role: string; content: string; created_at?: string; sources?: Array<{ tool: string; record_count: number }> }
const SUGGEST = ['What is my leave balance?', 'Who is on leave today?', 'How many people work here?', 'What approvals are waiting for me?', 'What are the next public holidays?'];

export default function Assistant() {
  const toast = useToast();
  const [conv, setConv] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  // Scroll only the message list, never the page: scrollIntoView would also scroll the window
  // and push the whole chat box off screen after each message.
  const body = useRef<HTMLDivElement>(null);
  // Fit the chat box to the space left below it on screen, so the input row is always visible
  // without the page scrolling (min 340px on very short screens). Recomputed on resize.
  const box = useRef<HTMLDivElement>(null);
  const [boxH, setBoxH] = useState<number>();
  useEffect(() => {
    const fit = () => {
      const el = box.current; if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setBoxH(Math.max(340, window.innerHeight - top - 24));
    };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => { const el = body.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [msgs, busy]);
  const send = async (content: string) => {
    if (!content.trim() || busy) return;
    setBusy(true); setText('');
    setMsgs((m) => [...m, { role: 'user', content }]);
    try {
      let id = conv;
      if (!id) { id = (await post<{ id: string }>('/assistant/conversations')).id; setConv(id); }
      const r = await post<{ answer: string; tool: string | null; sources: Array<{ tool: string; record_count: number }> }>(`/assistant/conversations/${id}/messages`, { content });
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, sources: r.sources }]);
    } catch (e: any) { toast(e.message, true); setMsgs((m) => m.slice(0, -1)); setText(content); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHead title="Assistant" sub="Answers from your own data, limited to what you are already allowed to see." />
      <Banner tone="info"><span className="muted">The assistant can only look things up through fixed, permission-checked queries. It never sees salaries, bank details, ID numbers or leave reasons, and it cannot change anything.</span></Banner>
      <div className="chatbox" ref={box} style={boxH ? { height: boxH } : undefined}>
        <div className="chat-body" ref={body}>
          {!msgs.length && <div className="empty"><h3>Ask a question</h3><div className="inline" style={{ justifyContent: 'center', marginTop: 10 }}>{SUGGEST.map((s) => <button key={s} className="btn sm" onClick={() => send(s)}>{s}</button>)}</div></div>}
          {msgs.map((m, i) => <div key={i} className={'msg ' + m.role}>{m.content}{m.role === 'assistant' && m.sources?.length ? <div className="faint" style={{ marginTop: 8 }}>Sources: {m.sources.map((s) => `${s.tool} (${s.record_count})`).join(', ')}</div> : null}</div>)}
          {busy && <div className="msg assistant"><Spinner /></div>}
        </div>
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <input className="input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Ask about leave, headcount, approvals…" aria-label="Message" />
          <button className="btn primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      </div>
    </>
  );
}
