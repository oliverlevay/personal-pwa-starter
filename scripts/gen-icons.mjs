// Generate app icons + notification badge + icon.svg with zero dependencies. Colors are
// read from frontend/src/theme.css (--bg, --accent, --accent-2) so the theme file is the
// SINGLE source of color for the whole project — no hardcoded colors anywhere else.
// Re-run after changing the theme:  node scripts/gen-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'frontend', 'public', 'icons');
const THEME = path.join(ROOT, 'frontend', 'src', 'theme.css');

// ── Read brand colors from theme.css ──────────────────────────────
const css = fs.readFileSync(THEME, 'utf8');
const pick = (name, fallback) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  return m ? m[1] : fallback;
};
const hexToRgb = (h) => {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const BG_HEX = pick('bg', '#0f1115');
const A1_HEX = pick('accent', '#6d8bff');
const A2_HEX = pick('accent-2', '#9b6dff');
const BG = hexToRgb(BG_HEX);
const A1 = hexToRgb(A1_HEX);
const A2 = hexToRgb(A2_HEX);

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encode(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => Math.round(a + (b - a) * t);

// Full-bleed app icon: opaque --bg field, --accent→--accent-2 gradient inset, --bg center dot.
function appIcon(size) {
  const inset = size * 0.1875;
  const innerSize = size * 0.625;
  const innerR = size * 0.140625;
  const cx = size / 2;
  const cy = size / 2;
  const dot = size * 0.164;
  const inRoundRect = (X, Y, x0, y0, w, h, rad) => {
    if (X < x0 || Y < y0 || X >= x0 + w || Y >= y0 + h) return false;
    const dx = Math.min(X - x0, x0 + w - 1 - X);
    const dy = Math.min(Y - y0, y0 + h - 1 - Y);
    if (dx >= rad || dy >= rad) return true;
    const ddx = rad - dx;
    const ddy = rad - dy;
    return ddx * ddx + ddy * ddy <= rad * rad;
  };
  return encode(size, (x, y) => {
    if (Math.hypot(x - cx, y - cy) <= dot) return [...BG, 255];
    if (inRoundRect(x, y, inset, inset, innerSize, innerSize, innerR)) {
      const t = (x + y) / (2 * size);
      return [mix(A1[0], A2[0], t), mix(A1[1], A2[1], t), mix(A1[2], A2[2], t), 255];
    }
    return [...BG, 255];
  });
}

// Monochrome notification badge: white ring on transparent (Android tints the alpha).
function badge(size) {
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.46;
  const inner = size * 0.26;
  return encode(size, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return d <= outer && d >= inner ? [255, 255, 255, 255] : [0, 0, 0, 0];
  });
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${A1_HEX}"/>
      <stop offset="1" stop-color="${A2_HEX}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="${BG_HEX}"/>
  <rect x="96" y="96" width="320" height="320" rx="72" fill="url(#g)"/>
  <circle cx="256" cy="256" r="84" fill="${BG_HEX}"/>
</svg>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);
fs.writeFileSync(path.join(OUT, 'icon-192.png'), appIcon(192));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), appIcon(512));
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), appIcon(180));
fs.writeFileSync(path.join(OUT, 'badge-96.png'), badge(96));
console.log(`wrote icons from theme.css (bg ${BG_HEX}, accent ${A1_HEX} → ${A2_HEX})`);
