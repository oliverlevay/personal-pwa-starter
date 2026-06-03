// Store unit tests (node:test, zero-dep). Each test gets its own temp SQLite file, so
// running this from multiple git worktrees at once never collides.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../lib/store.ts';

function tmpStore(): SqliteStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-store-'));
  const s = new SqliteStore(path.join(dir, 'app.db'));
  s.migrate([
    {
      id: 'm1',
      sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, done INTEGER, created_at TEXT, updated_at TEXT)',
    },
  ]);
  return s;
}

test('insert assigns id + timestamps; find returns the row', () => {
  const s = tmpStore();
  const row = s.insert<{ id: string; title: string; created_at: string }>('notes', { title: 'hi' });
  assert.ok(row.id, 'has id');
  assert.equal(row.title, 'hi');
  assert.ok(row.created_at, 'has created_at');
  assert.deepEqual(s.find('notes', row.id), row);
  s.close();
});

test('update changes fields and bumps updated_at; remove deletes', () => {
  const s = tmpStore();
  const row = s.insert<{ id: string }>('notes', { title: 'a' });
  const updated = s.update<{ title: string }>('notes', row.id, { title: 'b' });
  assert.equal(updated?.title, 'b');
  assert.equal(s.remove('notes', row.id), true);
  assert.equal(s.find('notes', row.id), undefined);
  assert.equal(s.remove('notes', row.id), false);
  s.close();
});

test('booleans/objects coerce for binding', () => {
  const s = tmpStore();
  const row = s.insert<{ id: string; done: number }>('notes', { title: 'x', done: true });
  assert.equal(row.done, 1);
  s.close();
});

test('config get/set round-trips and upserts', () => {
  const s = tmpStore();
  assert.equal(s.getConfig('k'), undefined);
  s.setConfig('k', 'v1');
  assert.equal(s.getConfig('k'), 'v1');
  s.setConfig('k', 'v2');
  assert.equal(s.getConfig('k'), 'v2');
  s.close();
});

test('migrate is idempotent (re-running applied steps is a no-op)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-store-'));
  const file = path.join(dir, 'app.db');
  const s1 = new SqliteStore(file);
  const m = [{ id: 'x1', sql: 'CREATE TABLE t (id TEXT PRIMARY KEY)' }];
  s1.migrate(m);
  s1.migrate(m); // would throw "table t already exists" if not guarded
  s1.close();
  const s2 = new SqliteStore(file);
  assert.doesNotThrow(() => s2.migrate(m));
  s2.close();
});

test('raw all/get/run work; bad identifier is rejected', () => {
  const s = tmpStore();
  s.run('INSERT INTO notes (id, title) VALUES (?, ?)', ['1', 'one']);
  assert.equal(s.get<{ title: string }>('SELECT title FROM notes WHERE id = ?', ['1'])?.title, 'one');
  assert.equal(s.all('SELECT * FROM notes').length, 1);
  assert.throws(() => s.insert('bad name', { x: 1 }), /Invalid identifier/);
  s.close();
});
