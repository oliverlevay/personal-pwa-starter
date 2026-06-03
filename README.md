# personal-pwa-starter

A copy-and-delete template for small personal PWA apps. Distilled from the reusable shell
shared across several hand-built apps (japan trip planner, valentina) — so a new app is
mostly *domain code* on top of a proven base.

**Stack**
- **Backend:** Node ≥22.18, **zero runtime dependencies except `web-push`**. Native TypeScript (no build step). SQLite via the built-in `node:sqlite`.
- **Frontend:** React 19 + Vite + TypeScript, installable PWA (manifest + service worker).
- **Deploy:** multi-stage Dockerfile → Railway (single container + a volume for the SQLite file).

**What's included** (the pieces every app re-derives): shared-password auth, a `Store`
interface over SQLite, Web Push (VAPID auto-seeded), streaming Claude chat with tool
support, and a receipt/email inbox. Plus the PWA shell: offline caching, a
localStorage-hydrated query cache, a streaming chat widget, and a mobile tab-bar UI.

## Layout

```
backend/
  server.ts            # entry point — wire migrations, resources, chat tools, inbox here
  lib/{config,store,auth,push,chat,inbox,api}.ts
frontend/
  public/{manifest.webmanifest, sw.js, icons/}
  src/{App,main}.tsx, src/lib/{api,query,push}.ts, src/components/{ui,ChatWidget}.tsx, src/views/Login.tsx
cloudflare/email-worker.js   # forwards inbound email → /api/inbox/:token
scripts/gen-icons.mjs        # regenerate PNG icons from the SVG (zero-dep)
Dockerfile · docker-compose.yml · railway.json · CONTRACT.md
```

## Develop

```bash
cp .env.example .env          # optional in dev
npm install                   # backend dep (web-push)
npm run dev:backend           # :3000  (node --watch, native TS)
npm --prefix frontend install
npm run dev:frontend          # :5173  (Vite, proxies /api → :3000)
```

Ports are **derived from the worktree path** (`npm run ports` to print them), so every
`git worktree` gets its own stable backend/frontend/e2e ports. Several agents can run
`npm run dev` in parallel worktrees and you can open each at its own URL — no collisions,
and each worktree's `./data/app.db` is separate. `PORT` env overrides (prod/Railway).

The backend serves the built SPA in production, so only the backend runs there.

## Test

```bash
npm test            # backend (node:test) + frontend (Vitest)
npm run test:e2e    # Playwright (builds frontend, drives a real browser)
```

- **Backend** unit/integration: `node:test`, zero-dep. Each test uses a temp SQLite file; the integration test binds port 0 — safe to run from many worktrees at once.
- **Frontend** unit: Vitest + jsdom (no server/ports).
- **E2E**: Playwright on the per-worktree `e2e` port with an isolated temp DB; `reuseExistingServer` locally. First run once: `npx playwright install chromium`.

Design principles: **SOLID · KISS · DRY** — interfaces only at swap/test boundaries
(`Store`, `Pusher`, external services), plain concrete types elsewhere; no config/plugin
layer; nothing speculative.

## Build a new app from it

1. Clone/copy this directory; rename in `package.json`, `manifest.webmanifest`, `index.html`.
2. **Re-skin:** edit `frontend/src/theme.css` — it's the single source of color (CSS, the
   browser chrome, the PWA manifest, and the icons all derive from it; no color literal
   lives anywhere else). Then `node scripts/gen-icons.mjs` to regenerate matching icons.
3. In `backend/lib/app.ts`: add your tables to `store.migrate([...])`, list them in `resources`, and replace the demo chat `system`/`tools` and `inbox` handler with your domain logic.
4. Add views under `frontend/src/`. Keep using `components/ui` primitives.

See [CONTRACT.md](./CONTRACT.md) for the HTTP surface the frontend depends on.

## Deploy (Railway)

1. New project from this repo (uses the Dockerfile).
2. Add a **volume** and set `DATA_DIR` to its mount path (e.g. `/data`) so `app.db` persists.
3. Set env: `APP_PASSWORD`, `SESSION_SECRET`, `VAPID_SUBJECT`, and optionally
   `ANTHROPIC_API_KEY`, `INBOX_TOKEN`.

## Notes
- `node:sqlite` is still flagged experimental; the run scripts pass `--disable-warning=ExperimentalWarning`. Node 24 recommended for deploy.
- iOS Web Push requires the PWA to be **installed** to the home screen (iOS 16.4+).
