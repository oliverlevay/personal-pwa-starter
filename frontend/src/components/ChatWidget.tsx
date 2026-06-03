// Streaming chat UI with QoL: live "thoughts" (collapsible), tool-call chips, working
// status, a whimsical "✶ Cogitated for Ns" completion line, markdown answers, and
// image/file attach + paste. Reads the framed stream from /api/chat (ASCII RS 0x1e):
// unframed = answer, THINK: = thoughts, TOOLS: = chips, else = transient status.
import { useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type ChatFile } from '../lib/api.ts';
import { Button, Textarea } from './ui.tsx';

interface ToolRun {
  label: string;
  ok: boolean;
}
interface Attachment {
  name: string;
  mime: string;
  preview?: string; // data URL, for inline image display
}
interface Msg {
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

function parseStream(raw: string): { text: string; thoughts: string; status: string; tools?: ToolRun[] } {
  const parts = raw.split(RS);
  let text = '';
  let thoughts = '';
  let status = '';
  let tools: ToolRun[] | undefined;
  parts.forEach((part, i) => {
    if (i % 2 === 0) text += part;
    else if (part.startsWith('THINK:')) thoughts += part.slice(6);
    else if (part.startsWith('TOOLS:')) {
      try {
        tools = JSON.parse(part.slice(6));
      } catch {
        /* partial frame */
      }
    } else status = part;
  });
  return { text, thoughts, status, tools };
}

function fileToChatFile(file: File): Promise<ChatFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mime: file.type, dataBase64: String(reader.result) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ChatWidget() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState<ChatFile | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scrollDown = (): void => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
  };

  function patchLast(patch: Partial<Msg>): void {
    setMessages((m) => {
      const copy = [...m];
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
      return copy;
    });
  }

  async function attach(file: File | undefined | null): Promise<void> {
    if (file) setPending(await fileToChatFile(file));
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if ((!text && !pending) || busy) return;
    const file = pending;
    const userMsg: Msg = {
      role: 'user',
      content: text,
      attachment: file
        ? { name: file.name || 'file', mime: file.mime || '', preview: file.mime?.startsWith('image/') ? file.dataBase64 : undefined }
        : undefined,
    };
    const history: Msg[] = [...messages, userMsg];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setPending(null);
    setBusy(true);
    setStatus('');
    scrollDown();
    const startedAt = performance.now();

    try {
      const res = await api.chatStream(
        history.map((m) => ({ role: m.role, content: m.content })),
        file,
      );
      if (!res.ok || !res.body) throw new Error(`Chat failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const parsed = parseStream(raw);
        setStatus(parsed.status);
        patchLast({ content: parsed.text, thoughts: parsed.thoughts || undefined, tools: parsed.tools });
        scrollDown();
      }
      const secs = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
      patchLast({ done: `${randomGerund()} for ${secs}s` });
    } catch (e) {
      patchLast({ content: '⚠️ ' + (e as Error).message, error: true });
    } finally {
      setBusy(false);
      setStatus('');
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && <p className="muted">Ask the assistant something…</p>}
        {messages.map((m, i) => (
          <div key={i} className={`turn turn-${m.role}`}>
            {m.thoughts && (
              <details className="thoughts" open={busy && i === messages.length - 1}>
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
          rows={2}
          value={input}
          placeholder="Type a message"
          onChange={(e) => setInput(e.target.value)}
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
        <Button onClick={() => void send()} disabled={busy || (!input.trim() && !pending)}>
          {busy ? '…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
