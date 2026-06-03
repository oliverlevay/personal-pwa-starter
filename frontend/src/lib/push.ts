// Web Push subscription helpers (browser side), ported from valentina.
import { api } from './api.ts';

export type PushState = 'unsupported' | 'off' | 'on' | 'blocked';

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Decode a base64url VAPID key into the byte array PushManager expects. The explicit
// ArrayBuffer backing keeps the type as Uint8Array<ArrayBuffer> (not SharedArrayBuffer),
// which applicationServerKey requires.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

// Ask for permission and register a push subscription. Call from a user gesture.
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser does not support notifications.');
  const reg =
    (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications need permission to work.');

  const { publicKey } = await api.getPushKey();
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.subscribePush(subscription.toJSON());
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.unsubscribePush(sub.endpoint);
    await sub.unsubscribe();
  }
}

export async function sendTestPush(): Promise<number> {
  const { sent } = await api.testPush();
  return sent;
}
