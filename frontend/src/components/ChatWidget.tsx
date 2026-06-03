// Streaming chat UI with QoL: live "thoughts" (collapsible), tool-call chips, a working
// status line, and a whimsical "✶ Cogitated for Ns" completion line. Reads the framed
// stream from /api/chat (ASCII RS 0x1e): unframed = answer, THINK: = thoughts, TOOLS: =
// chips, anything else = transient status. Distilled from oliver-och-klara-i-japan.
import { useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { Button, Textarea } from './ui.tsx';

interface ToolRun {
  label: string;
  ok: boolean;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string;
  thoughts?: string;
  tools?: ToolRun[];
  done?: string; // e.g. "Cogitated for 12s"
  error?: boolean;
}

const RS = '\x1e';

// Whimsical completion verbs, à la Claude Code's "✶ Cogitated for 52s".
const GERUNDS = [
  'Cogitated', 'Pondered', 'Ruminated', 'Noodled', 'Mused', 'Deliberated', 'Contemplated',
  'Percolated', 'Schemed', 'Conjured', 'Ideated', 'Marinated', 'Wrangled', 'Synthesized',
  'Mulled', 'Reasoned', 'Brainstormed', 'Cerebrated',
];
const randomGerund = (): string => GERUNDS[Math.floor(Math.random() * GERUNDS.length)];

// Even-index segments are answer text; odd-index are control frames (THINK:/TOOLS:/status).
function parseStream(raw: string): { text: string; thoughts: string; status: string; tools?: ToolRun[] } {
  const parts = raw.split(RS);
  let text = '';
  let thoughts = '';
  let status = '';
  let tools: ToolRun[] | undefined;
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      text += part;
    } else if (part.startsWith('THINK:')) {
      thoughts += part.slice(6);
    } else if (part.startsWith('TOOLS:')) {
      try {
        tools = JSON.parse(part.slice(6));
      } catch {
        /* partial frame — ignore until complete */
      }
    } else {
      status = part; // latest status wins
    }
  });
  return { text, thoughts, status, tools };
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

  function patchLast(patch: Partial<Msg>): void {
    setMessages((m) => {
      const copy = [...m];
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
      return copy;
    });
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || busy) return;
    const history: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    setStatus('');
    scrollDown();
    const startedAt = performance.now();

    try {
      const res = await api.chatStream(history.map((m) => ({ role: m.role, content: m.content })));
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
        patchLast({
          content: parsed.text,
          thoughts: parsed.thoughts || undefined,
          tools: parsed.tools,
        });
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
            {(m.content || (m.role === 'assistant' && busy && !m.thoughts)) && (
              <div className={`bubble bubble-${m.role}${m.error ? ' bubble-error' : ''}`}>
                {m.content || '…'}
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
