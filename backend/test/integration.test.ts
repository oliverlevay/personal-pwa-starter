// Integration test: boots the real app on an ephemeral port (listen 0) with an isolated
// temp DB, then hits HTTP endpoints. Port 0 + temp dir = safe to run from many worktrees
// simultaneously.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.APP_PASSWORD = ''; // open auth in test (currentUser -> "user")
process.env.INBOX_TOKEN = 'tok';

const { createServer } = await import('../lib/app.ts');

async function boot(): Promise<{ base: string; close: () => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-int-'));
  const { server } = createServer(dir, dir); // spaDir unused by these API calls
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://localhost:${port}`, close: () => server.close() };
}

test('health, me, notes CRUD, push key, inbox token guard', async () => {
  const { base, close } = await boot();
  try {
    assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });

    const me = (await (await fetch(`${base}/api/me`)).json()) as { user: string };
    assert.equal(me.user, 'user');

    const created = (await (
      await fetch(`${base}/api/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      })
    ).json()) as { id: string; title: string };
    assert.ok(created.id);
    assert.equal(created.title, 'hello');

    const list = (await (await fetch(`${base}/api/notes`)).json()) as unknown[];
    assert.equal(list.length, 1);

    const key = (await (await fetch(`${base}/api/push/key`)).json()) as { publicKey: string };
    assert.ok(key.publicKey.length > 20);

    assert.equal((await fetch(`${base}/api/inbox/wrong`, { method: 'POST' })).status, 403);

    const ingest = await fetch(`${base}/api/inbox/tok`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        attachments: [{ filename: 'r.txt', contentType: 'text/plain', dataBase64: Buffer.from('hi').toString('base64') }],
      }),
    });
    assert.equal(ingest.status, 201);
    const ingestBody = (await ingest.json()) as { ok: boolean };
    assert.equal(ingestBody.ok, true);
  } finally {
    close();
  }
});
