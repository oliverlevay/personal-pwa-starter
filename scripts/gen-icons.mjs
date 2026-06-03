// Generate app icons + notification badge with zero dependencies (node:zlib + manual PNG).
// - icon-192 / icon-512 / apple-touch-icon: full-bleed OPAQUE (maskable-safe; iOS shows no
//   transparent corners). Dark rounded field + gradient inset + dark center dot.
// - badge-96: MONOCHROME on transparent — Android keeps only the alpha and tints it, so a
//   full-color image here renders as a white blob. A transparent ring renders correctly.
// Run: node scripts/gen-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, '..', 'frontend', 'public', 'icons');

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

// Encode an RGBA pixel function into a PNG buffer.
function encode(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => Math.round(a + (b - a) * t);

// Full-bleed app icon: opaque dark field (maskable-safe), gradient inset, dark center dot.
function appIcon(size) {
  const inset = size * 0.1875;
  const innerSize = size * 0.625;
  const innerR = size * 0.140625;
  const cx = size / 2;
  const cy = size / 2;
  const dot = size * 0.164;
  const bg = [0x0f, 0x11, 0x15];
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
    if (Math.hypot(x - cx, y - cy) <= dot) return [...bg, 255];
    if (inRoundRect(x, y, inset, inset, innerSize, innerSize, innerR)) {
      const t = (x + y) / (2 * size);
      return [mix(0x6d, 0x9b, t), mix(0x8b, 0x6d, t), 255, 255];
    }
    return [...bg, 255]; // opaque everywhere (no transparent corners)
  });
}

// Monochrome notification badge: white ring on transparent (alpha-only matters on Android).
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

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-192.png'), appIcon(192));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), appIcon(512));
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), appIcon(180));
fs.writeFileSync(path.join(OUT, 'badge-96.png'), badge(96));
console.log('wrote icon-192, icon-512, apple-touch-icon, badge-96');
