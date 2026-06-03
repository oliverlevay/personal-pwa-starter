// Generic streaming chat over the Anthropic Messages API (zero-dep: built-in fetch, no SDK).
// The scaffold owns the robust streaming + tool loop; each app injects its own system
// prompt + tools (e.g. the finance app exposes SQL-over-transactions tools). Distilled
// from oliver-och-klara-i-japan's chat.ts, minus the trip-specific bits.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.ts';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_HISTORY = 20;
const MAX_MSG_LEN = 8000;
const MAX_BODY = 8 * 1024 * 1024;
const MAX_TOOL_ROUNDS = 8;

// Status lines are framed by ASCII RS (0x1e) so the client can show a transient
// "working…" indicator without it landing in the saved answer. 0x1e never appears in
// normal text/markdown -> a safe delimiter. Plain text deltas are written unframed.
const RS = '\x1e';

export interface ChatTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatConfig {
  // Built fresh per request so the app can embed a current data snapshot in the prompt.
  system: (user: string | null) => string | SystemBlock[];
  tools?: ChatTool[];
  runTool?: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  model?: string;
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}
type ContentBlock = Record<string, unknown>;
interface ConvoMessage {
  role: string;
  content: string | ContentBlock[];
}
interface RoundResult {
  error: string | null;
  content: ContentBlock[];
  toolUses: ContentBlock[];
  stopReason: string | null;
}

// Keep only well-formed user/assistant turns with non-empty text; cap length + count.
function sanitize(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const out: ChatMessage[] = [];
  for (const m of input as Array<{ role?: string; content?: unknown; error?: boolean }>) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    if (m.role === 'assistant' && m.error === true) continue; // failed turn -> don't feed back
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (!content) continue;
    out.push({ role: m.role, content: content.slice(0, MAX_MSG_LEN) });
  }
  return out.slice(-MAX_HISTORY);
}

function readJson(req: IncomingMessage): Promise<{ messages?: unknown }> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendErr(res: ServerResponse, code: number, error: string): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error }));
}

function writeStatus(res: ServerResponse, text: string): void {
  if (text) res.write(`${RS}${text}${RS}`);
}

// One streaming Messages call. Writes text deltas straight to the client, returns the
// model's full content blocks (text + tool_use) and stop_reason for the tool loop.
async function streamRound(
  payload: Record<string, unknown>,
  res: ServerResponse,
  signal: AbortSignal,
): Promise<RoundResult> {
  const empty: RoundResult = { error: null, content: [], toolUses: [], stopReason: null };
  let upstream: Response;
  try {
    upstream = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal,
    });
  } catch (e) {
    return { ...empty, error: 'Could not reach Claude: ' + (e as Error).message };
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    let msg = `Claude returned an error (${upstream.status}).`;
    try {
      msg = JSON.parse(text).error.message || msg;
    } catch {}
    return { ...empty, error: msg };
  }

  const blocks: Record<string, any>[] = [];
  let stopReason: string | null = null;

  const onEvent = (ev: Record<string, any>): void => {
    if (ev.type === 'content_block_start') {
      const cb = ev.content_block || {};
      if (cb.type === 'text') blocks[ev.index] = { type: 'text', text: '' };
      else if (cb.type === 'tool_use') {
        blocks[ev.index] = { type: 'tool_use', id: cb.id, name: cb.name, json: '' };
        writeStatus(res, `Running ${cb.name}…`);
      } else blocks[ev.index] = { type: 'passthrough', raw: cb };
    } else if (ev.type === 'content_block_delta') {
      const b = blocks[ev.index];
      if (!b) return;
      if (ev.delta.type === 'text_delta') {
        b.text += ev.delta.text;
        res.write(ev.delta.text);
      } else if (ev.delta.type === 'input_json_delta') {
        b.json += ev.delta.partial_json;
      }
    } else if (ev.type === 'content_block_stop') {
      const b = blocks[ev.index];
      if (b && b.type === 'tool_use') {
        try {
          b.input = b.json ? JSON.parse(b.json) : {};
        } catch {
          b.input = {};
        }
      }
    } else if (ev.type === 'message_delta') {
      if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
    } else if (ev.type === 'error') {
      res.write('\n\n⚠️ ' + ((ev.error && ev.error.message) || 'An error occurred.'));
    }
  };

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const json = line.slice(5).trim();
        if (!json) continue;
        let ev;
        try {
          ev = JSON.parse(json);
        } catch {
          continue;
        }
        onEvent(ev);
      }
    }
  } catch {
    // Client likely disconnected mid-stream — nothing to do.
  }

  const content: ContentBlock[] = blocks
    .filter(Boolean)
    .map((b): ContentBlock => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input || {} };
      return b.raw;
    })
    .filter((b: any) => (b.type === 'text' ? b.text.trim() !== '' : true));
  const toolUses = content.filter((b) => b.type === 'tool_use');
  return { error: null, content, toolUses, stopReason };
}

// Build a POST /api/chat handler bound to one app's system prompt + tools.
export function createChatHandler(cfg: ChatConfig) {
  return async function handleChat(
    req: IncomingMessage,
    res: ServerResponse,
    user: string | null,
  ): Promise<void> {
    try {
      if (!config.anthropicApiKey) {
        return sendErr(res, 500, 'Chat is not configured: ANTHROPIC_API_KEY is missing.');
      }
      let body: { messages?: unknown };
      try {
        body = await readJson(req);
      } catch (e) {
        const msg = (e as Error).message;
        return sendErr(res, msg === 'too large' ? 413 : 400, msg === 'too large' ? 'Too large.' : 'Bad request.');
      }
      const messages = sanitize(body.messages);
      if (!messages.length) return sendErr(res, 400, 'No messages to answer.');

      const convo: ConvoMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
      const system = cfg.system(user);

      const ac = new AbortController();
      let clientGone = false;
      res.on('close', () => {
        if (!res.writableEnded) {
          clientGone = true;
          ac.abort();
        }
      });

      const reqPayload: Record<string, unknown> = {
        model: cfg.model || config.anthropicModel,
        max_tokens: 4000,
        system,
        ...(cfg.tools && cfg.tools.length ? { tools: cfg.tools } : {}),
      };

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const result = await streamRound({ ...reqPayload, messages: convo }, res, ac.signal);
        if (clientGone) break;
        if (result.error) {
          res.write('\n\n⚠️ ' + result.error);
          break;
        }
        convo.push({ role: 'assistant', content: result.content });
        if (result.stopReason !== 'tool_use' || !result.toolUses.length) break;
        if (!cfg.runTool) break;

        const toolResults: ContentBlock[] = [];
        for (const tu of result.toolUses as Array<{ id: string; name: string; input: Record<string, unknown> }>) {
          let out: unknown;
          let isError = false;
          try {
            out = await cfg.runTool(tu.name, tu.input || {});
          } catch (e) {
            out = (e as Error).message;
            isError = true;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: typeof out === 'string' ? out : JSON.stringify(out),
            ...(isError ? { is_error: true } : {}),
          });
        }
        if (clientGone) break;
        convo.push({ role: 'user', content: toolResults });
      }
      if (!clientGone) res.end();
    } catch (e) {
      if (!res.headersSent) sendErr(res, 500, 'Internal error: ' + (e as Error).message);
      else
        try {
          res.end();
        } catch {}
    }
  };
}
