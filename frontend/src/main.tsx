import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Drive browser chrome + PWA manifest colors from the theme tokens, so theme.css is the
// single source of color — no literals in HTML or the manifest.
const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
if (bg) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  // Re-emit the manifest with themed colors (the static file ships colorless).
  fetch('/manifest.webmanifest')
    .then((r) => r.json())
    .then((m) => {
      const themed = JSON.stringify({ ...m, theme_color: bg, background_color: bg });
      const url = URL.createObjectURL(new Blob([themed], { type: 'application/manifest+json' }));
      document.querySelector('link[rel="manifest"]')?.setAttribute('href', url);
    })
    .catch(() => {});
}

// Register the service worker (PWA install + offline + Web Push). Dev too, so push works locally.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
