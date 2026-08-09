// Generates the PWA/app icons from the 16x16 pixel mark, without any
// dependencies: nearest-neighbor scale + hand-rolled PNG encoding (zlib is
// built into Node). Run with: node scripts/gen-icons.js
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// 16x16 source pixels: background + the four-square mark.
const SOURCE = (() => {
  const w = 16;
  const px = new Array(w * w).fill([0x10, 0x11, 0x16, 0xff]); // #101116
  const put = (x, y, x2, y2, c) => {
    for (let yy = y; yy < y2; yy++) {
      for (let xx = x; xx < x2; xx++) px[yy * w + xx] = c;
    }
  };
  put(2, 2, 7, 7, [0xff, 0x41, 0x36, 0xff]); // logo red
  put(9, 2, 14, 7, [0xff, 0xd6, 0x0a, 0xff]); // logo yellow
  put(2, 9, 7, 14, [0x3f, 0xd7, 0xe0, 0xff]); // logo cyan
  put(9, 9, 14, 14, [0x8b, 0x5c, 0xf6, 0xff]); // logo violet
  return px;
})();

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Nearest-neighbor scale of the source mark onto a target canvas.
// `inset` is the fraction of the target that stays empty around the mark
// (maskable icons pad the mark into the safe zone).
function render(size, inset) {
  const rgba = Buffer.alloc(size * size * 4);
  const usable = size * (1 - 2 * inset);
  const scale = usable / 16;
  const offset = size * inset;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.min(15, Math.max(0, Math.floor((x - offset) / scale)));
      const sy = Math.min(15, Math.max(0, Math.floor((y - offset) / scale)));
      const inside = x >= offset && x < offset + usable && y >= offset && y < offset + usable;
      const [r, g, b, a] = inside ? SOURCE[sy * 16 + sx] : [0x10, 0x11, 0x16, 0xff];
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', render(192, 0)],
  ['icon-512.png', render(512, 0)],
  ['icon-maskable-512.png', render(512, 0.1)],
  ['apple-touch-icon.png', render(180, 0)]
];

for (const [name, png] of targets) {
  fs.writeFileSync(path.join(outDir, name), png);
  console.log('wrote icons/' + name + ' (' + png.length + ' bytes)');
}
