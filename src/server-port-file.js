import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export function writePrivatePortFile(filePath, payload) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('Port file path must be a non-empty string');
  }

  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });

  try {
    const existing = lstatSync(resolved);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('Port file path must be a regular non-symlink file');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(
    resolved,
    constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC | noFollow,
    0o600,
  );
  try {
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, JSON.stringify(payload), { encoding: 'utf8' });
  } finally {
    closeSync(descriptor);
  }

  // `mode` only applies when a file is created; normalize an existing stale
  // port file too, then verify the fail-closed reader's contract.
  chmodSync(resolved, 0o600);
  const written = lstatSync(resolved);
  if (!written.isFile() || written.isSymbolicLink() || (written.mode & 0o077) !== 0) {
    throw new Error('Port file was not written as a private regular file');
  }
  return resolved;
}
