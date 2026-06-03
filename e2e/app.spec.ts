import { test, expect } from '@playwright/test';

test('loads, does Notes CRUD, and persists across reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();

  const title = `e2e note ${Date.now()}`;
  await page.getByPlaceholder('New note').fill(title);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(title)).toBeVisible();

  // Reload: data comes from SQLite (server) + the localStorage query cache.
  await page.reload();
  await expect(page.getByText(title)).toBeVisible();
});

test('registers the service worker (PWA/offline/push plumbing)', async ({ page }) => {
  await page.goto('/');
  const ready = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(ready).toBe(true);
});

test('settings shows push state and the VAPID key endpoint works', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText(/Web Push status:/)).toBeVisible();

  const res = await request.get('/api/push/key');
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { publicKey: string };
  expect(body.publicKey.length).toBeGreaterThan(20);
});

test('chat streams a reply bubble', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Chat' }).click();
  await page.getByPlaceholder('Type a message').fill('hello');
  await page.getByRole('button', { name: 'Send' }).click();

  // User bubble appears immediately; assistant bubble follows (a real answer if
  // ANTHROPIC_API_KEY is set, otherwise the "not configured" error bubble — either way
  // the streaming UI wiring is exercised).
  await expect(page.locator('.bubble-user', { hasText: 'hello' })).toBeVisible();
  await expect(page.locator('.bubble-assistant')).toBeVisible({ timeout: 15_000 });
});
