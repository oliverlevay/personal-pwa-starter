// Streaming chat with: thoughts, tool chips, "✶ Cogitated for Ns", markdown, attach/paste,
// web search — plus persisted conversations, history (last-3 + list), multi-device live
// sync (SSE), auto-title, a stop button, and an auto-growing input. Framed stream (ASCII
// RS 0x1e): unframed = answer, THINK: = thoughts, TOOLS: = chips, TITLE: = title, else status.
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type ChatFile, type Conversation, type StoredMessage } from '../lib/api.ts';
import { Button, Textarea } from './ui.tsx';

interface ToolRun {
  label: string;
  ok: boolean;
}
interface Attachment {
  name: string;
  mime: string;
  preview?: string;
}
interface Msg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachment?: Attachment;
  thoughts?: string;
  tools?: ToolRun[];
  done?: string;
  error?: boolean;
}

const RS = '\x1e';
const GERUNDS = [
  'Cogitated', 'Pondered', 'Ruminated', 'Noodled', 'Mused', 'Deliberated', 'Contemplated',
  'Percolated', 'Schemed', 'Conjured', 'Ideated', 'Marinated', 'Wrangled', 'Synthesized',
  'Mulled', 'Reasoned', 'Brainstormed', 'Cerebrated',
];
const randomGerund = (): string => GERUNDS[Math.floor(Math.random() * GERUNDS.length)];
const uid = (): string => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

function parseStream(raw: string): {
  text: string;
  thoughts: string;
  status: string;
  tools?: ToolRun[];
  title?: string;
} {
  const parts = raw.split(RS);
  let text = '';
  let thoughts = '';
  let status = '';
  let tools: ToolRun[] | undefined;
  let title: string | undefined;
  parts.forEach((part, i) => {
    if (i % 2 === 0) text += part;
    else if (part.startsWith('THINK:')) thoughts += part.slice(6);
    else if (part.startsWith('TOOLS:')) {
      try {
        tools = JSON.parse(part.slice(6));
      } catch {
        /* partial */
      }
    } else if (part.startsWith('TITLE:')) {
      try {
        title = JSON.parse(part.slice(6));
      } catch {
        /* partial */
      }
    } else status = part;
  });
  return { text, thoughts, status, tools, title };
}

function fileToChatFile(file: File): Promise<ChatFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mime: file.type, dataBase64: String(reader.result) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Map a persisted message back to the in-memory shape (meta holds thoughts/tools/etc).
function fromStored(m: StoredMessage): Msg {
  return { id: m.id, role: m.role, content: m.content, ...(m.meta as Partial<Msg>) };
}

export function ChatWidget() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<ChatFile | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const clientId = useRef(uid()).current;
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshList = (): void => {
    api.listConversations().then(setConversations).catch(() => {});
  };
  useEffect(refreshList, []);

  const scrollDown = (): void => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
  };

  function patch(id: string, p: Partial<Msg>): void {
    setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  // ── Multi-device live sync: apply events from OTHER clients on this conversation ──
  useEffect(() => {
    if (!convId) return;
    const es = new EventSource(`/api/conversations/${convId}/events?client=${encodeURIComponent(clientId)}`);
    es.onmessage = (e) => {
      let ev: { type?: string; message?: StoredMessage; id?: string; text?: string; title?: string };
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.type === 'message' && ev.message) {
        const m = ev.message;
        setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur.map((x) => (x.id === m.id ? fromStored(m) : x)) : [...cur, fromStored(m)]));
        scrollDown();
      } else if (ev.type === 'delta' && ev.id) {
        const id = ev.id;
        const text = ev.text || '';
        setMessages((cur) =>
          cur.some((x) => x.id === id)
            ? cur.map((x) => (x.id === id ? { ...x, content: x.content + text } : x))
            : [...cur, { id, role: 'assistant', content: text }],
        );
        scrollDown();
      } else if (ev.type === 'title' && ev.title) {
        setConversations((cs) => cs.map((c) => (c.id === convId ? { ...c, title: ev.title } : c)));
      }
    };
    return () => es.close();
  }, [convId, clientId]);

  function startNew(): void {
    setConvId(null);
    setMessages([]);
    setShowHistory(false);
  }

  async function openConversation(id: string): Promise<void> {
    setShowHistory(false);
    try {
      const conv = await api.getConversation(id);
      setConvId(id);
      setMessages(conv.messages.map(fromStored));
      scrollDown();
    } catch {
      /* gone */
    }
  }

  async function removeConversation(id: string): Promise<void> {
    await api.deleteConversation(id).catch(() => {});
    if (id === convId) startNew();
    refreshList();
  }

  async function attach(file: File | undefined | null): Promise<void> {
    if (file) setPending(await fileToChatFile(file));
  }

  function growTextarea(): void {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if ((!text && !pending) || busy) return;
    const file = pending;

    // Ensure a saved conversation exists (so history + sync work from message #1).
    let cid = convId;
    if (!cid) {
      try {
        const conv = await api.createConversation();
        cid = conv.id;
        setConvId(cid);
        setConversations((cs) => [conv, ...cs]);
      } catch {
        cid = null; // fall back to ephemeral if persistence is unavailable
      }
    }

    const userMsg: Msg = {
      id: uid(),
      role: 'user',
      content: text,
      attachment: file
        ? { name: file.name || 'file', mime: file.mime || '', preview: file.mime?.startsWith('image/') ? file.dataBase64 : undefined }
        : undefined,
    };
    const replyId = uid();
    const history = [...messages, userMsg];
    setMessages([...history, { id: replyId, role: 'assistant', content: '' }]);
    setInput('');
    setPending(null);
    setBusy(true);
    setStatus('');
    requestAnimationFrame(growTextarea);
    scrollDown();
    const startedAt = performance.now();
    const ac = new AbortController();
    abortRef.current = ac;

    if (cid) api.appendMessage(cid, { id: userMsg.id, role: 'user', content: text, meta: { attachment: userMsg.attachment } }, clientId).catch(() => {});

    try {
      const res = await api.chatStream(
        history.map((m) => ({ role: m.role, content: m.content })),
        { file, convId: cid || undefined, clientId, replyId, signal: ac.signal },
      );
      if (!res.ok || !res.body) throw new Error(`Chat failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      let newTitle: string | undefined;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const parsed = parseStream(raw);
        if (parsed.title) newTitle = parsed.title;
        setStatus(parsed.status);
        patch(replyId, { content: parsed.text, thoughts: parsed.thoughts || undefined, tools: parsed.tools });
        scrollDown();
      }
      const secs = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
      const parsed = parseStream(raw);
      const finalMsg: Msg = {
        id: replyId,
        role: 'assistant',
        content: parsed.text,
        thoughts: parsed.thoughts || undefined,
        tools: parsed.tools,
        done: `${randomGerund()} for ${secs}s`,
      };
      patch(replyId, { done: finalMsg.done });
      if (cid) {
        api.appendMessage(cid, { id: replyId, role: 'assistant', content: finalMsg.content, meta: { thoughts: finalMsg.thoughts, tools: finalMsg.tools, done: finalMsg.done } }, clientId).catch(() => {});
        if (newTitle) {
          api.patchConversation(cid, newTitle, clientId).catch(() => {});
          setConversations((cs) => cs.map((c) => (c.id === cid ? { ...c, title: newTitle } : c)));
        }
        refreshList();
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patch(replyId, { content: '⚠️ ' + (e as Error).message, error: true });
    } finally {
      setBusy(false);
      setStatus('');
      abortRef.current = null;
    }
  }

  const currentTitle = conversations.find((c) => c.id === convId)?.title || 'New chat';
  const recent = conversations.slice(0, 3);

  return (
    <div className="chat">
      <div className="chat-head">
        <button className="chat-head-btn" onClick={() => setShowHistory((v) => !v)}>
          ☰ History
        </button>
        <span className="chat-title">{currentTitle}</span>
        <button className="chat-head-btn" onClick={startNew}>
          + New
        </button>
      </div>

      {showHistory ? (
        <div className="chat-log">
          {conversations.length === 0 && <p className="muted">No conversations yet.</p>}
          {conversations.map((c) => (
            <div key={c.id} className="conv-row">
              <button className="conv-open" onClick={() => void openConversation(c.id)}>
                {c.title || 'Untitled'}
              </button>
              <button className="btn-danger conv-del" onClick={() => void removeConversation(c.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="chat-log" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="muted">Ask the assistant something…</p>
              {recent.length > 0 && (
                <div className="recent">
                  <p className="muted recent-label">Recent</p>
                  {recent.map((c) => (
                    <button key={c.id} className="recent-item" onClick={() => void openConversation(c.id)}>
                      {c.title || 'Untitled'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`turn turn-${m.role}`}>
              {m.thoughts && (
                <details className="thoughts" open={busy}>
                  <summary>💭 Thoughts</summary>
                  <div className="thoughts-body">{m.thoughts}</div>
                </details>
              )}
              {(m.content || m.attachment || (m.role === 'assistant' && busy && !m.thoughts)) && (
                <div className={`bubble bubble-${m.role}${m.error ? ' bubble-error' : ''}`}>
                  {m.attachment &&
                    (m.attachment.preview ? (
                      <img className="chat-attach-img" src={m.attachment.preview} alt={m.attachment.name} />
                    ) : (
                      <span className="chip">📎 {m.attachment.name}</span>
                    ))}
                  {m.role === 'assistant' && !m.error && m.content ? (
                    <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                  ) : (
                    m.content || (m.attachment ? '' : '…')
                  )}
                </div>
              )}
              {m.tools && m.tools.length > 0 && (
                <div className="chips">
                  {m.tools.map((t, j) => (
                    <span key={j} className={`chip ${t.ok ? '' : 'chip-fail'}`}>
                      🔧 {t.label}
                      {t.ok ? '' : ' (failed)'}
                    </span>
                  ))}
                </div>
              )}
              {m.done && <div className="chat-done">✶ {m.done}</div>}
            </div>
          ))}
          {status && <div className="chat-status">{status}</div>}
        </div>
      )}

      {!showHistory && (
        <>
          {pending && (
            <div className="chat-pending">
              {pending.mime?.startsWith('image/') ? (
                <img className="chat-attach-img" src={pending.dataBase64} alt={pending.name} />
              ) : (
                <span className="chip">📎 {pending.name}</span>
              )}
              <button className="chat-pending-x" onClick={() => setPending(null)} aria-label="Remove attachment">
                ✕
              </button>
            </div>
          )}
          <div className="chat-input">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf,.txt,.md,.csv"
              hidden
              onChange={(e) => {
                void attach(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} aria-label="Attach file">
              📎
            </Button>
            <Textarea
              ref={taRef}
              rows={1}
              value={input}
              placeholder="Type a message"
              onChange={(e) => {
                setInput(e.target.value);
                growTextarea();
              }}
              onPaste={(e) => {
                const img = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'));
                if (img) void attach(img.getAsFile());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {busy ? (
              <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
                Stop
              </Button>
            ) : (
              <Button onClick={() => void send()} disabled={!input.trim() && !pending}>
                Send
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
