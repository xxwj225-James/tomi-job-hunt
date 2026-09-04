/**
 * Generates app resources/icon.png (256) + resources/tray.png (32) — solid
 * accent rounded square with a white dot ring, hand-rolled PNG encoder
 * (zlib only, no deps). Run once: node scripts/gen-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = [0x3d, 0x6c, 0xff, 255];
const WHITE = [255, 255, 255, 255];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = y * (size * 4 + 1) + 1 + x * 4;
      raw[di] = px[si];
      raw[di + 1] = px[si + 1];
      raw[di + 2] = px[si + 2];
      raw[di + 3] = px[si + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Rounded-rect coverage alpha: inside core fully opaque, soft 1px edge. */
function roundedRect(size, radius) {
  const px = Buffer.alloc(size * size * 4);
  const r = radius;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // signed distance to rounded rect (positive = inside)
      const qx = Math.abs(x - (size - 0.5) / 2) - (size / 2 - r);
      const qy = Math.abs(y - (size - 0.5) / 2) - (size / 2 - r);
      const dx = Math.max(qx, 0);
      const dy = Math.max(qy, 0);
      let d = Math.sqrt(dx * dx + dy * dy) + Math.min(Math.max(qx, qy), 0) - r;
      const alpha = Math.max(0, Math.min(1, 0.5 - d));
      const si = (y * size + x) * 4;
      px[si] = ACCENT[0];
      px[si + 1] = ACCENT[1];
      px[si + 2] = ACCENT[2];
      px[si + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

/** Overlay a white dot ring (drawn after roundedRect). */
function dotRing(px, size, center, outerR, dotR, count) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let i = 0; i < count; i++) {
        const a = (2 * Math.PI * i) / count;
        const cx = center + Math.cos(a) * outerR;
        const cy = center + Math.sin(a) * outerR;
        const dd = (x - cx) ** 2 + (y - cy) ** 2;
        if (dd <= dotR * dotR) {
          const si = (y * size + x) * 4;
          const base = px[si + 3];
          px[si] = WHITE[0];
          px[si + 1] = WHITE[1];
          px[si + 2] = WHITE[2];
          px[si + 3] = Math.round(255 * (base / 255));
        }
      }
    }
  }
  return px;
}

function render(size, radius, withDots) {
  let px = roundedRect(size, radius);
  if (withDots) px = dotRing(px, size, size / 2, size * 0.22, size * 0.06, 8);
  return encodePng(size, px);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'icon.png'), render(256, 56, true));
writeFileSync(join(outDir, 'tray.png'), render(32, 8, true));
console.log('wrote resources/icon.png + resources/tray.png');
