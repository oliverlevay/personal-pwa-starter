// Inbound email/receipt ingestion. The Cloudflare email worker (or any client) POSTs
// JSON to /api/inbox/:token; the app supplies what to DO with the attachments (store +
// analyze in the finance app). Token-guarded in the API router — never trust the sender.
//
// JSON (not multipart/.eml parsing) keeps this zero-dep: the CF worker decodes the email
// and posts a clean payload. See cloudflare/email-worker.js.
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY = 25 * 1024 * 1024; // 25 MB (a couple of receipt PDFs/images)

export interface InboundFile {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface InboundEmail {
  from?: string;
  subject?: string;
  files: InboundFile[];
}

export interface IngestResult {
  ok: boolean;
  summary?: Record<string, unknown>;
  error?: string;
  code?: number;
}

interface InboxPayload {
  from?: string;
  subject?: string;
  attachments?: Array<{ filename?: string; contentType?: string; dataBase64?: string }>;
}

function readJson(req: IncomingMessage): Promise<InboxPayload> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// Build a POST /api/inbox handler. `onEmail` does the app-specific work and returns a
// summary; transient errors should throw (so the worker/Postmark retries), terminal
// per-file problems should be folded into the summary.
export function createInboxHandler(onEmail: (email: InboundEmail) => Promise<Record<string, unknown>>) {
  return async function handleInbox(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let payload: InboxPayload;
    try {
      payload = await readJson(req);
    } catch (e) {
      const msg = (e as Error).message;
      return send(res, msg === 'too large' ? 413 : 400, { error: msg === 'too large' ? 'Too large.' : 'Bad JSON.' });
    }
    const files: InboundFile[] = (payload.attachments || [])
      .filter((a) => a && a.dataBase64)
      .map((a) => ({
        filename: a.filename || 'attachment',
        contentType: a.contentType || 'application/octet-stream',
        bytes: Buffer.from(String(a.dataBase64).split(',').pop() || '', 'base64'),
      }));
    try {
      const summary = await onEmail({ from: payload.from, subject: payload.subject, files });
      send(res, 201, { ok: true, summary });
    } catch (e) {
      // Let it 500 so the sender retries — ingestion should be idempotent (dedup by hash).
      send(res, 500, { error: (e as Error).message });
    }
  };
}
