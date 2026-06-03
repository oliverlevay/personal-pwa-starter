// Streaming chat UI. Reads text deltas straight from /api/chat; status lines (tool
// activity) are framed by ASCII RS (0x1e) and shown as a transient indicator, mirroring
// the backend in lib/chat.ts. Distilled from oliver-och-klara-i-japan's ChatWidget.
import { useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { Button, Textarea } from './ui.tsx';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

const RS = '\x1e';

// Even-index segments are visible text, odd-index are status frames. Recomputed from the
// full buffer each chunk so a frame split across chunks still resolves correctly.
function parseStream(raw: string): { text: string; status: string } {
  const parts = raw.split(RS);
  const text = parts.filter((_, i) => i % 2 === 0).join('');
  const statuses = parts.filter((_, i) => i % 2 === 1);
  return { text, status: statuses.length ? statuses[statuses.length - 1] : '' };
}

export function ChatWidget() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollDown = (): void => {
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 1e9 }));
  };

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || busy) return;
    const history: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    setStatus('');
    scrollDown();

    try {
      const res = await api.chatStream(history);
      if (!res.ok || !res.body) throw new Error(`Chat failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        const { text: visible, status: st } = parseStream(raw);
        setStatus(st);
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: visible };
          return copy;
        });
        scrollDown();
      }
    } catch (e) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: 'assistant', content: '⚠️ ' + (e as Error).message, error: true };
        return copy;
      });
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
          <div key={i} className={`bubble bubble-${m.role}${m.error ? ' bubble-error' : ''}`}>
            {m.content || (m.role === 'assistant' && busy ? '…' : '')}
          </div>
        ))}
        {status && <div className="chat-status">{status}</div>}
      </div>
      <div className="chat-input">
        <Textarea
          rows={2}
          value={input}
          placeholder="Type a message"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button onClick={() => void send()} disabled={busy || !input.trim()}>
          {busy ? '…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
