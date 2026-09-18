/**
 * Draws the extension icons (shield + checkmark) as PNGs with no dependencies.
 *
 *   node tools/generate-icons.js
 *
 * Writes extension/icons/icon{16,32,48,128}.png. Shapes are maths, not bitmaps,
 * so every size stays sharp; each pixel is supersampled 4x4 for smooth edges.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(__dirname, "..", "extension", "icons");

const SHIELD = [47, 109, 226]; // blue
const SHIELD_DARK = [30, 74, 168]; // bottom of the gradient
const CHECK = [255, 255, 255];

/** Shield outline in a -1..1 box: straight shoulders, rounded top, pointed base. */
function insideShield(x, y) {
  if (y < -1 || y > 1 || Math.abs(x) > 1) return false;
  let halfWidth;
  if (y <= -0.72) {
    const t = (y + 1) / 0.28; // rounded top corners
    halfWidth = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
  } else if (y <= 0.05) {
    halfWidth = 1; // straight shoulders
  } else {
    const t = (y - 0.05) / 0.95; // straight-ish sides curving into a point
    halfWidth = 1 - Math.pow(t, 1.8);
  }
  return Math.abs(x) <= halfWidth;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** The checkmark: a short down-stroke into a long up-stroke. */
function insideCheck(x, y, thickness) {
  return (
    distanceToSegment(x, y, -0.42, 0.0, -0.1, 0.34) < thickness ||
    distanceToSegment(x, y, -0.1, 0.34, 0.46, -0.36) < thickness
  );
}

function renderPixels(size) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);
  const thickness = size <= 16 ? 0.2 : size <= 32 ? 0.17 : 0.15;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let shieldHits = 0;
      let checkHits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          // Map the pixel into the -1..1 box, leaving a small margin
          const x = ((px + (sx + 0.5) / samples) / size) * 2.12 - 1.06;
          const y = ((py + (sy + 0.5) / samples) / size) * 2.12 - 1.06;
          if (!insideShield(x, y)) continue;
          shieldHits++;
          if (insideCheck(x, y, thickness)) checkHits++;
        }
      }

      const total = samples * samples;
      const offset = (py * size + px) * 4;
      if (!shieldHits) continue;

      const shade = py / size; // vertical gradient
      const base = SHIELD.map((channel, i) => Math.round(channel + (SHIELD_DARK[i] - channel) * shade));
      const checkRatio = checkHits / shieldHits;
      const color = base.map((channel, i) => Math.round(channel + (CHECK[i] - channel) * checkRatio));

      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = Math.round((shieldHits / total) * 255);
    }
  }
  return pixels;
}

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function toPng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // rows are prefixed with a filter byte (0 = none)
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, toPng(size, renderPixels(size)));
  console.log(`wrote ${path.relative(process.cwd(), file)} (${size}x${size})`);
}
