// Shared Node-side reader for the private C3 Studio backend port file.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOCAL_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOCAL_BACKEND_HOSTS = new Set(['127.0.0.1', 'localhost']);
const MAX_PORT_FILE_BYTES = 4096;

function resolvePortFilePath() {
  if (process.env.C3_PORT_FILE) {
    return path.isAbsolute(process.env.C3_PORT_FILE)
      ? path.normalize(process.env.C3_PORT_FILE)
      : null;
  }
  return path.join(os.homedir(), '.c3', 'port');
}

function normalizeLocalAccess(info, requireCapability = true) {
  if (!info || typeof info !== 'object') return null;
  const host = typeof info.host === 'string' ? info.host.toLowerCase() : '';
  const port = info.port;
  if (
    !LOCAL_BACKEND_HOSTS.has(host)
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
  ) {
    return null;
  }

  const localCapability = typeof info.localCapability === 'string'
    && LOCAL_CAPABILITY_PATTERN.test(info.localCapability)
    ? info.localCapability
    : null;
  if (requireCapability && !localCapability) return null;

  return Object.freeze({
    backendUrl: new URL(`http://${host}:${port}`).origin,
    port,
    localCapability,
  });
}

function readLocalAccess(options = {}) {
  const requireCapability = options.requireCapability !== false;
  const portFile = options.portFile ?? resolvePortFilePath();
  if (typeof portFile !== 'string' || !path.isAbsolute(portFile)) return null;

  let descriptor;
  try {
    descriptor = fs.openSync(
      portFile,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const stat = fs.fstatSync(descriptor);
    if (
      !stat.isFile()
      || stat.size < 1
      || stat.size > MAX_PORT_FILE_BYTES
      || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)
      || (
        typeof process.getuid === 'function'
        && Number.isInteger(stat.uid)
        && stat.uid !== process.getuid()
      )
    ) {
      return null;
    }
    const payload = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < payload.length) {
      const bytesRead = fs.readSync(
        descriptor,
        payload,
        offset,
        payload.length - offset,
        offset,
      );
      if (bytesRead === 0) return null;
      offset += bytesRead;
    }
    const afterRead = fs.fstatSync(descriptor);
    if (
      afterRead.dev !== stat.dev
      || afterRead.ino !== stat.ino
      || afterRead.size !== stat.size
      || afterRead.mtimeMs !== stat.mtimeMs
    ) {
      return null;
    }
    const parsed = JSON.parse(payload.toString('utf8'));
    return normalizeLocalAccess(parsed, requireCapability);
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

module.exports = {
  LOCAL_CAPABILITY_PATTERN,
  normalizeLocalAccess,
  readLocalAccess,
  resolvePortFilePath,
};
