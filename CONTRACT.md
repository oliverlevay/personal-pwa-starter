# Backend contract

The frontend depends only on these HTTP endpoints — not on the backend language. The
reference backend is zero-dep Node (`backend/`), but you can reimplement this contract in
Go/Rust/etc. and the existing `frontend/` keeps working unchanged.

All routes are under `/api`. Auth is a same-origin `HttpOnly` session cookie set by
`/api/login`. Everything except `/api/login`, `/api/health`, and `/api/inbox/:token`
requires that cookie (else `401`).

## Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/login` | `{ password }` | `200 {ok}` + `Set-Cookie`, or `401` |
| POST | `/api/logout` | — | `200 {ok}` + clears cookie |
| GET | `/api/me` | — | `{ user }` |
| GET | `/api/health` | — | `{ ok: true }` (unauthenticated) |

## Web Push
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/push/key` | — | `{ publicKey }` (VAPID, base64url) |
| POST | `/api/push/subscribe` | a `PushSubscription` JSON (`{endpoint, keys:{p256dh, auth}}`) | `201 {ok}` |
| POST | `/api/push/unsubscribe` | `{ endpoint }` | `200 {ok}` |
| POST | `/api/push/test` | — | `{ sent }` (devices reached) |

The server auto-generates and persists the VAPID keypair on first run. Payloads are
encrypted `{ title, body, url?, tag? }` JSON; the service worker shows them directly.

## Chat
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/chat` | `{ messages: [{role, content}] }` | streamed `text/plain` |

The response streams answer text directly. Tool-activity status lines are wrapped in
ASCII RS (`0x1e`) delimiters so the client can show a transient indicator without it
landing in the saved message. Even-index segments (split on `0x1e`) are visible text.

## Conversations (persisted chat history + multi-device sync)
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/conversations` | — | conversations (newest first) |
| POST | `/api/conversations` | `{ title? }` | created conversation |
| GET | `/api/conversations/:id` | — | `{ ...conv, messages: [{id, role, content, meta}] }` |
| PATCH | `/api/conversations/:id?client=` | `{ title }` | updated conversation (broadcasts `title`) |
| DELETE | `/api/conversations/:id` | — | `{ ok }` (messages cascade) |
| POST | `/api/conversations/:id/messages?client=` | `{ message: {id, role, content, meta?} }` | `{ ok, added }` — idempotent by message id; broadcasts `message` |
| GET | `/api/conversations/:id/events?client=` | — | SSE stream of `{type:'delta'|'message'|'title', …}` |

The `client` query param identifies the device so it isn't echoed its own events. The
`/api/chat` body accepts `convId`, `clientId`, `replyId` to relay answer deltas to other
devices viewing the same conversation, and (when `convId` is set) the model may call a
`set_conversation_title` tool, surfaced as a `TITLE:` trailer in the chat stream.

## Inbox (receipts / forwarded email)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/inbox/:token` | `{ from?, subject?, attachments:[{filename, contentType, dataBase64}] }` | `201 {ok, summary}` |

Token-guarded (constant-time compare); reached without a session. Disabled (`503`) unless
`INBOX_TOKEN` is set. Ingestion should be idempotent (dedup by content hash) so retries
are safe.

## Generic CRUD
For each table in the app's resource allowlist (`AppRoutes.resources`):

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/:type` | — | array (newest first) |
| POST | `/api/:type` | partial row | created row (with `id`, `created_at`, `updated_at`) |
| GET | `/api/:type/:id` | — | row or `404` |
| PATCH | `/api/:type/:id` | partial row | updated row or `404` |
| DELETE | `/api/:type/:id` | — | `{ ok }` |
