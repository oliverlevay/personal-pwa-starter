// Typed fetch wrapper around the backend (zero extra deps). Same-origin cookie auth.
export interface CodedError extends Error {
  code?: number;
}

export interface ChatFile {
  name?: string;
  mime?: string;
  dataBase64?: string; // data URL or raw base64
}

async function req<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = (await res.json()).error || message;
    } catch {}
    const err = new Error(message) as CodedError;
    err.code = res.status;
    throw err;
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const api = {
  // Generic resource CRUD (key = resource path, e.g. "notes").
  get: <T = unknown>(key: string) => req<T>('GET', '/' + key),
  create: <T = unknown>(type: string, body: unknown) => req<T>('POST', '/' + type, body),
  update: <T = unknown>(type: string, id: string, body: unknown) => req<T>('PATCH', `/${type}/${id}`, body),
  remove: (type: string, id: string) => req('DELETE', `/${type}/${id}`),

  // Auth
  me: () => req<{ user: string }>('GET', '/me'),
  login: (password: string) => req('POST', '/login', { password }),
  logout: () => req('POST', '/logout'),

  // Web Push
  getPushKey: () => req<{ publicKey: string }>('GET', '/push/key'),
  subscribePush: (sub: unknown) => req('POST', '/push/subscribe', sub),
  unsubscribePush: (endpoint: string) => req('POST', '/push/unsubscribe', { endpoint }),
  testPush: () => req<{ sent: number }>('POST', '/push/test'),

  // Chat — returns the raw streaming Response so the caller can read text deltas.
  chatStream: (messages: unknown, file?: ChatFile | null, signal?: AbortSignal) =>
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, ...(file ? { file } : {}) }),
      credentials: 'same-origin',
      signal,
    }),
};
