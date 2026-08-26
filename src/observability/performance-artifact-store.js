import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export function sha256PerformanceArtifact(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function publishPerformanceArtifactExclusive(filePath, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 1) {
    throw new TypeError('performance-artifact-store:invalid-bytes');
  }
  const descriptor = openSync(filePath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  const directory = openSync(path.dirname(filePath), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return Object.freeze({
    sha256: sha256PerformanceArtifact(bytes),
    byteLength: bytes.byteLength,
  });
}
