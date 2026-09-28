// Deterministic synthetic image fixtures used by the current VISION suite.

import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const combined = new Uint8Array(typeBytes.length + data.length);
  combined.set(typeBytes);
  combined.set(data, typeBytes.length);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crc32(combined));
  return Buffer.concat([
    Buffer.from(len), Buffer.from(typeBytes), Buffer.from(data), Buffer.from(crcBytes),
  ]);
}

export function generateSyntheticPng(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = [];
  for (let y = 0; y < height; y++) {
    raw.push(0);
    for (let x = 0; x < width; x++) {
      const pixel = pixels[(y * width) + x] || [0, 0, 0];
      raw.push(pixel[0], pixel[1], pixel[2]);
    }
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.from(raw))),
    pngChunk('IEND', new Uint8Array(0)),
  ]).toString('base64');
}

let cached = null;

export function getSyntheticTestImages() {
  if (cached) return cached;
  const redPixel = generateSyntheticPng(1, 1, [[255, 0, 0]]);
  const red8x8 = generateSyntheticPng(8, 8, Array(64).fill([255, 0, 0]));
  const circle = [];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const distance = Math.hypot(x - 16, y - 16);
      circle.push(distance <= 10 && distance >= 8 ? [0, 0, 0] : [255, 255, 255]);
    }
  }
  const dots = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const red = Math.hypot(x - 4, y - 8);
      const green = Math.hypot(x - 8, y - 8);
      const blue = Math.hypot(x - 12, y - 8);
      if (red <= 2) dots.push([255, 0, 0]);
      else if (green <= 2) dots.push([0, 255, 0]);
      else if (blue <= 2) dots.push([0, 0, 255]);
      else dots.push([255, 255, 255]);
    }
  }
  cached = Object.freeze({
    redPixel,
    red8x8,
    circleImg: generateSyntheticPng(32, 32, circle),
    dotsImg: generateSyntheticPng(16, 16, dots),
  });
  return cached;
}

export default { generateSyntheticPng, getSyntheticTestImages };
