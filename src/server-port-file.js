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
import { isValidLegacyLocalCapability } from './security/legacy-local-access-policy.js';

const TEST_RUN_NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function buildServerPortPayload(
  { port, host, pid, started },
  testRunNonce,
  localCapability,
) {
  const payload = { port, host, pid, started };
  if (testRunNonce !== undefined) {
    if (
      typeof testRunNonce !== 'string'
      || !TEST_RUN_NONCE_PATTERN.test(testRunNonce)
    ) {
      throw new Error(
        'INTENTSMITH_TEST_SERVER_NONCE must contain 32-128 safe characters',
      );
    }
    payload.testRunNonce = testRunNonce;
  }
  if (localCapability !== undefined) {
    if (!isValidLegacyLocalCapability(localCapability)) {
      throw new Error(
        'Legacy local capability must be a 256-bit base64url value',
      );
    }
    payload.localCapability = localCapability;
  }
  return payload;
}

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
