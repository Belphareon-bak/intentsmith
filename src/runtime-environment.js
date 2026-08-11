// Runtime entry-point environment.
//
// The database module deliberately has no implicit path fallback: importing it
// without an explicit C3_DB_PATH must fail before it can touch operator data.
// The production server entry point imports this module first so the normal
// local runtime keeps its project-local default after the exact install-root
// dotenv file has been safely loaded. Other module entry points must import
// this bootstrap explicitly before initializing runtime state.

import { createHmac } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { normalizeLegacyLocalOrigins } from './security/legacy-local-access-policy.js';
import { requireLegacyLoopbackHost } from './security/legacy-listener-policy.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, '..');

export const WEBHOOK_SECRET_SOURCE_UNSAFE = 'WEBHOOK_SECRET_SOURCE_UNSAFE';
export const WEBHOOK_SECRET_AUTHORITY_INVALID = 'WEBHOOK_SECRET_AUTHORITY_INVALID';
export const WEBHOOK_SECRET_NOT_CONFIGURED = 'WEBHOOK_SECRET_NOT_CONFIGURED';

const WEBHOOK_SECRET_KEY = 'C3_WEBHOOK_SECRET';
const MAX_ROOT_ENV_BYTES = 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const brandedWebhookSecretAuthorities = new WeakSet();

function webhookSecretAuthorityError(code) {
  const error = new Error(code);
  error.name = 'WebhookSecretAuthorityError';
  error.code = code;
  return error;
}

function rejectUnsafeWebhookSecretSource() {
  throw webhookSecretAuthorityError(WEBHOOK_SECRET_SOURCE_UNSAFE);
}

function currentEffectiveUid() {
  if (typeof process.geteuid !== 'function') rejectUnsafeWebhookSecretSource();
  return BigInt(process.geteuid());
}

function requireCanonicalProjectRoot(root) {
  if (
    typeof root !== 'string'
    || !path.isAbsolute(root)
    || path.resolve(root) !== root
  ) {
    rejectUnsafeWebhookSecretSource();
  }
  try {
    const rootStat = lstatSync(root, { bigint: true });
    if (
      !rootStat.isDirectory()
      || rootStat.isSymbolicLink()
      || realpathSync(root) !== root
    ) {
      rejectUnsafeWebhookSecretSource();
    }
  } catch (error) {
    if (error?.code === WEBHOOK_SECRET_SOURCE_UNSAFE) throw error;
    rejectUnsafeWebhookSecretSource();
  }
  return root;
}

function requireSafeRootEnvStat(stat, expectedUid) {
  if (
    !stat
    || !stat.isFile()
    || stat.isSymbolicLink()
    || stat.uid !== expectedUid
    || stat.nlink !== 1n
    || (stat.mode & 0o7777n) !== 0o600n
    || stat.size < 0n
    || stat.size > BigInt(MAX_ROOT_ENV_BYTES)
  ) {
    rejectUnsafeWebhookSecretSource();
  }
  return stat;
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left, right) {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function readBoundedRootEnv(descriptor) {
  const chunks = [];
  let total = 0;
  while (total <= MAX_ROOT_ENV_BYTES) {
    const remaining = (MAX_ROOT_ENV_BYTES + 1) - total;
    if (remaining === 0) break;
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > MAX_ROOT_ENV_BYTES) rejectUnsafeWebhookSecretSource();
  return Buffer.concat(chunks, total);
}

function readSafeRootEnvironment(root) {
  const canonicalRoot = requireCanonicalProjectRoot(root);
  const target = path.join(canonicalRoot, '.env');
  const expectedUid = currentEffectiveUid();
  let pathStat;
  try {
    pathStat = lstatSync(target, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze(Object.create(null));
    rejectUnsafeWebhookSecretSource();
  }
  requireSafeRootEnvStat(pathStat, expectedUid);

  if (
    !Number.isInteger(fsConstants.O_NOFOLLOW)
    || fsConstants.O_NOFOLLOW === 0
    || !Number.isInteger(fsConstants.O_NONBLOCK)
    || fsConstants.O_NONBLOCK === 0
  ) {
    rejectUnsafeWebhookSecretSource();
  }

  let descriptor;
  try {
    descriptor = openSync(
      target,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    const openedStat = requireSafeRootEnvStat(
      fstatSync(descriptor, { bigint: true }),
      expectedUid,
    );
    if (!sameFileIdentity(pathStat, openedStat)) rejectUnsafeWebhookSecretSource();

    const bytes = readBoundedRootEnv(descriptor);
    const afterReadStat = requireSafeRootEnvStat(
      fstatSync(descriptor, { bigint: true }),
      expectedUid,
    );
    if (!sameStableFile(openedStat, afterReadStat) || afterReadStat.size !== BigInt(bytes.length)) {
      rejectUnsafeWebhookSecretSource();
    }

    const finalPathStat = requireSafeRootEnvStat(
      lstatSync(target, { bigint: true }),
      expectedUid,
    );
    if (!sameStableFile(afterReadStat, finalPathStat)) rejectUnsafeWebhookSecretSource();
    if (realpathSync(canonicalRoot) !== canonicalRoot) rejectUnsafeWebhookSecretSource();

    let parsed;
    try {
      parsed = dotenv.parse(bytes);
    } catch {
      rejectUnsafeWebhookSecretSource();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      rejectUnsafeWebhookSecretSource();
    }
    return parsed;
  } catch (error) {
    if (error?.code === WEBHOOK_SECRET_SOURCE_UNSAFE) throw error;
    rejectUnsafeWebhookSecretSource();
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        rejectUnsafeWebhookSecretSource();
      }
    }
  }
}

function createWebhookSecretAuthority(selectedSecret, source) {
  const status = Object.freeze({
    configured: selectedSecret.length > 0,
    source,
  });
  const authority = Object.create(null);
  Object.defineProperties(authority, {
    status: {
      enumerable: false,
      value: () => status,
    },
    sign: {
      enumerable: false,
      value: (payload, timestamp) => {
        if (!status.configured) {
          throw webhookSecretAuthorityError(WEBHOOK_SECRET_NOT_CONFIGURED);
        }
        if (
          typeof payload !== 'string'
          || !Number.isSafeInteger(timestamp)
          || timestamp < 0
        ) {
          throw new TypeError('WEBHOOK_SECRET_SIGNING_INPUT_INVALID');
        }
        const digest = createHmac('sha256', selectedSecret)
          .update(`${timestamp}.${payload}`)
          .digest('hex');
        return `sha256=${digest}`;
      },
    },
  });
  Object.freeze(authority);
  brandedWebhookSecretAuthorities.add(authority);
  return authority;
}

/**
 * Read the exact install-root dotenv file once and create an opaque startup
 * authority. The supplied environment is populated only from the verified
 * bytes and never receives the root-file webhook secret.
 */
export function readWebhookSecretAuthority({ projectRoot: root, processEnvironment }) {
  if (
    !processEnvironment
    || typeof processEnvironment !== 'object'
    || Array.isArray(processEnvironment)
  ) {
    rejectUnsafeWebhookSecretSource();
  }

  const processOwnsSecret = Object.hasOwn(processEnvironment, WEBHOOK_SECRET_KEY);
  const processSecret = processOwnsSecret
    ? processEnvironment[WEBHOOK_SECRET_KEY]
    : null;
  if (processOwnsSecret && typeof processSecret !== 'string') {
    rejectUnsafeWebhookSecretSource();
  }

  // Validate the root even when the process value wins: its other dotenv keys
  // are still runtime inputs, and no unsafe source may reach a later effect.
  const rootEnvironment = readSafeRootEnvironment(root);
  const rootSecret = Object.hasOwn(rootEnvironment, WEBHOOK_SECRET_KEY)
    ? rootEnvironment[WEBHOOK_SECRET_KEY]
    : '';
  if (typeof rootSecret !== 'string') rejectUnsafeWebhookSecretSource();

  const nonSecretRootEnvironment = Object.create(null);
  for (const [key, value] of Object.entries(rootEnvironment)) {
    if (key !== WEBHOOK_SECRET_KEY) nonSecretRootEnvironment[key] = value;
  }
  try {
    dotenv.populate(processEnvironment, nonSecretRootEnvironment, {
      debug: false,
      override: false,
    });
  } catch {
    rejectUnsafeWebhookSecretSource();
  }

  return createWebhookSecretAuthority(
    processOwnsSecret ? processSecret : rootSecret,
    processOwnsSecret ? 'PROCESS_ENV' : 'ROOT_ENV_FILE',
  );
}

export function requireWebhookSecretAuthority(value) {
  if (
    (typeof value !== 'object' && typeof value !== 'function')
    || value === null
    || !brandedWebhookSecretAuthorities.has(value)
    || !Object.isFrozen(value)
  ) {
    throw webhookSecretAuthorityError(WEBHOOK_SECRET_AUTHORITY_INVALID);
  }
  return value;
}

// This synchronous read is deliberately the first runtime operation. It loads
// all non-secret dotenv values from already verified root-file bytes and keeps
// the webhook HMAC in one immutable, process-lifetime capability.
export const webhookSecretAuthority = readWebhookSecretAuthority({
  projectRoot,
  processEnvironment: process.env,
});

const M1_WIRE_CONFIG_INVALID = 'M1_WIRE_CONFIG_INVALID';
const DEFAULT_M1_ATTACHMENT_COUNT = 8;
const DEFAULT_TEXT_ATTACHMENT_BYTES = 1024 * 1024;
const DEFAULT_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_M1_AGGREGATE_BYTES = 6 * 1024 * 1024;
const DEFAULT_M1_FRAME_BYTES = 12 * 1024 * 1024;

function rejectM1WireConfig(name, expectation, received) {
  const error = new Error(
    `${M1_WIRE_CONFIG_INVALID}: ${name} ${expectation}; received ${JSON.stringify(received)}`,
  );
  error.code = M1_WIRE_CONFIG_INVALID;
  throw error;
}

function canonicalBoolean(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  if (raw !== 'true' && raw !== 'false') {
    rejectM1WireConfig(name, 'must be exactly true or false', raw);
  }
  process.env[name] = raw;
  return raw === 'true';
}

function canonicalPositiveSafeInteger(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    rejectM1WireConfig(name, 'must be a positive safe integer', raw);
  }
  process.env[name] = String(value);
  return value;
}

function validateM1WireEnvironment() {
  canonicalBoolean('C3_ENABLE_M1_WIRE', true);
  const maxTextBytes = canonicalPositiveSafeInteger(
    'C3_MAX_TEXT_ATTACHMENT',
    DEFAULT_TEXT_ATTACHMENT_BYTES,
  );
  const maxImageBytes = canonicalPositiveSafeInteger(
    'C3_MAX_IMAGE_ATTACHMENT',
    DEFAULT_IMAGE_ATTACHMENT_BYTES,
  );
  canonicalPositiveSafeInteger(
    'C3_M1_ATTACHMENT_MAX_COUNT',
    DEFAULT_M1_ATTACHMENT_COUNT,
  );
  const maxAggregateBytes = canonicalPositiveSafeInteger(
    'C3_M1_ATTACHMENT_MAX_AGGREGATE_BYTES',
    DEFAULT_M1_AGGREGATE_BYTES,
  );
  const maxFrameBytes = canonicalPositiveSafeInteger(
    'C3_M1_WIRE_MAX_FRAME_BYTES',
    DEFAULT_M1_FRAME_BYTES,
  );

  const largestItemLimit = Math.max(maxTextBytes, maxImageBytes);
  if (maxAggregateBytes < largestItemLimit) {
    rejectM1WireConfig(
      'C3_M1_ATTACHMENT_MAX_AGGREGATE_BYTES',
      `must be at least the largest item limit (${largestItemLimit})`,
      maxAggregateBytes,
    );
  }
  if (maxFrameBytes <= maxAggregateBytes) {
    rejectM1WireConfig(
      'C3_M1_WIRE_MAX_FRAME_BYTES',
      `must be greater than C3_M1_ATTACHMENT_MAX_AGGREGATE_BYTES (${maxAggregateBytes})`,
      maxFrameBytes,
    );
  }
}

// Validate and canonicalize the network boundary before any later server
// dependency can initialize SQLite, backups, logs, or other runtime state.
// An omitted host keeps the established safe default; an explicitly invalid
// value fails closed.
process.env.C3_HOST = requireLegacyLoopbackHost(
  process.env.C3_HOST === undefined ? '127.0.0.1' : process.env.C3_HOST,
);
if (process.env.C3_CORS_ORIGINS !== undefined) {
  const configuredOrigins = process.env.C3_CORS_ORIGINS.trim() === ''
    ? []
    : process.env.C3_CORS_ORIGINS.split(',').map(value => value.trim());
  process.env.C3_CORS_ORIGINS = normalizeLegacyLocalOrigins(
    configuredOrigins,
  ).join(',');
}

// Canonicalize every M1 wire policy input before the dependency graph can
// evaluate the database, logger, port-file writer, or any other runtime
// module. The later protocol policy constructor remains a defense-in-depth
// check, but it is not the startup authority.
validateM1WireEnvironment();

if (!process.env.C3_DB_PATH?.trim()) {
  process.env.C3_DB_PATH = path.join(projectRoot, 'data', 'c3.db');
}
