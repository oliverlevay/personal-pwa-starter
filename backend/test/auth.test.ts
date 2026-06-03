// Auth unit tests. Env is set BEFORE importing auth (which reads config at load), and
// node:test runs each test file in its own process, so this env is isolated.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.APP_PASSWORD = 'hunter2pw';
process.env.SESSION_SECRET = 'test-secret';
process.env.INBOX_TOKEN = 'inbox-tok';

const auth = await import('../lib/auth.ts');

function fakeReq(cookie?: string): import('node:http').IncomingMessage {
  return { headers: cookie ? { cookie } : {} } as import('node:http').IncomingMessage;
}

test('checkPassword is constant-length and exact', () => {
  assert.equal(auth.checkPassword('hunter2pw'), true);
  assert.equal(auth.checkPassword('wrong'), false);
  assert.equal(auth.checkPassword(''), false);
  assert.equal(auth.checkPassword(undefined), false);
});

test('session cookie round-trips through currentUser', () => {
  const setCookie = auth.sessionCookie(); // "pwa_session=...; HttpOnly; ..."
  const value = setCookie.split(';')[0]; // "pwa_session=<token>"
  assert.equal(auth.currentUser(fakeReq(value)), 'user');
});

test('tampered / missing cookie -> not authenticated', () => {
  assert.equal(auth.currentUser(fakeReq()), null);
  assert.equal(auth.currentUser(fakeReq('pwa_session=garbage.parts.here')), null);
});

test('inbox token is enabled and compared exactly', () => {
  assert.equal(auth.inboxEnabled(), true);
  assert.equal(auth.checkInboxToken('inbox-tok'), true);
  assert.equal(auth.checkInboxToken('nope'), false);
});
