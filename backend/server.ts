// Process entry point: build the app from env config and start listening.
// App wiring (migrations, resources, chat, inbox) lives in lib/app.ts.
import http from 'node:http';
import path from 'node:path';
import { config } from './lib/config.ts';
import { createApp, makeRequestListener } from './lib/app.ts';

const { routes } = createApp(config.dataDir);
const spaDir = path.join(import.meta.dirname, '..', 'frontend', 'dist');

http
  .createServer(makeRequestListener(routes, spaDir))
  .listen(config.port, () => console.log(`personal-pwa-starter — listening on :${config.port}`));
