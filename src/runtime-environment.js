// Runtime entry-point environment.
//
// The database module deliberately has no implicit path fallback: importing it
// without an explicit C3_DB_PATH must fail before it can touch operator data.
// The production server entry point imports this module first so the normal
// local runtime keeps its project-local default after the exact install-root
// dotenv file has been safely loaded. Other module entry points must import
// this bootstrap explicitly before initializing runtime state.

import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { normalizeLegacyLocalOrigins } from './security/legacy-local-access-policy.js';
import { requireLegacyLoopbackHost } from './security/legacy-listener-policy.js';
import {
  NOTIFICATION_ENV_OWNED_KEYS,
  readRootEnvironmentBootstrap,
  requireRootEnvironmentBootstrap,
} from './security/root-environment-file.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, '..');

export const WEBHOOK_SECRET_SOURCE_UNSAFE = 'WEBHOOK_SECRET_SOURCE_UNSAFE';
export const WEBHOOK_SECRET_AUTHORITY_INVALID = 'WEBHOOK_SECRET_AUTHORITY_INVALID';
export const WEBHOOK_SECRET_NOT_CONFIGURED = 'WEBHOOK_SECRET_NOT_CONFIGURED';
export const NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID =
  'NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID';

const WEBHOOK_SECRET_KEY = 'C3_WEBHOOK_SECRET';
const brandedWebhookSecretAuthorities = new WeakSet();
const brandedNotificationEnvironmentAuthorities = new WeakSet();

function webhookSecretAuthorityError(code) {
  const error = new Error(code);
  error.name = 'WebhookSecretAuthorityError';
  error.code = code;
  return error;
}

function rejectUnsafeWebhookSecretSource() {
  throw webhookSecretAuthorityError(WEBHOOK_SECRET_SOURCE_UNSAFE);
}

function notificationEnvironmentAuthorityError() {
  const error = new TypeError(NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID);
  error.code = NOTIFICATION_ENVIRONMENT_AUTHORITY_INVALID;
  return error;
}

function requireProcessEnvironment(processEnvironment) {
  if (!processEnvironment || typeof processEnvironment !== 'object'
    || Array.isArray(processEnvironment)) {
    rejectUnsafeWebhookSecretSource();
  }
  return processEnvironment;
}

function captureProcessNotificationValues(processEnvironment) {
  const captured = new Map();
  for (const key of NOTIFICATION_ENV_OWNED_KEYS) {
    if (!Object.hasOwn(processEnvironment, key)) continue;
    const value = processEnvironment[key];
    if (typeof value !== 'string') rejectUnsafeWebhookSecretSource();
    captured.set(key, value);
  }
  return captured;
}

function createNotificationEnvironmentAuthority(processValues, bootstrap) {
  requireRootEnvironmentBootstrap(bootstrap);
  const values = new Map();
  const sources = {};
  for (const key of NOTIFICATION_ENV_OWNED_KEYS) {
    const processOwnsValue = processValues.has(key);
    const value = processOwnsValue
      ? processValues.get(key)
      : (bootstrap.notificationValue(key) ?? '');
    if (typeof value !== 'string') rejectUnsafeWebhookSecretSource();
    values.set(key, value);
    sources[key] = Object.freeze({
      configured: value.length > 0,
      source: processOwnsValue ? 'PROCESS_ENV' : 'ROOT_ENV_FILE',
    });
  }
  Object.freeze(sources);

  const ownedKeys = new Set(NOTIFICATION_ENV_OWNED_KEYS);
  const authority = Object.create(null);
  Object.defineProperties(authority, {
    status: {
      enumerable: false,
      value: () => sources,
    },
    value: {
      enumerable: false,
      value: key => {
        if (typeof key !== 'string' || !ownedKeys.has(key)) {
          throw notificationEnvironmentAuthorityError();
        }
        return values.get(key);
      },
    },
  });
  Object.freeze(authority);
  brandedNotificationEnvironmentAuthorities.add(authority);
  return authority;
}

function createWebhookSecretAuthority(notificationAuthority) {
  const validatedNotificationAuthority = requireNotificationEnvironmentAuthority(
    notificationAuthority,
  );
  const selectedSecret = validatedNotificationAuthority.value(WEBHOOK_SECRET_KEY);
  const status = validatedNotificationAuthority.status()[WEBHOOK_SECRET_KEY];
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
 * Read the exact install-root dotenv file once and derive both notification
 * capabilities from that immutable snapshot. Ordinary dotenv values retain
 * dotenv's established no-override behavior; canonical and legacy
 * notification values never enter the ambient environment.
 */
export function readRuntimeEnvironmentAuthorities({ projectRoot: root, processEnvironment }) {
  requireProcessEnvironment(processEnvironment);
  const processValues = captureProcessNotificationValues(processEnvironment);
  let bootstrap;
  try {
    bootstrap = readRootEnvironmentBootstrap({ projectRoot: root });
    const ambientEnvironment = Object.create(null);
    bootstrap.forEachAmbient((key, value) => {
      ambientEnvironment[key] = value;
    });
    dotenv.populate(processEnvironment, ambientEnvironment, {
      debug: false,
      override: false,
    });
  } catch {
    rejectUnsafeWebhookSecretSource();
  }

  const notificationEnvironmentAuthority = createNotificationEnvironmentAuthority(
    processValues,
    bootstrap,
  );
  const webhookSecretAuthority = createWebhookSecretAuthority(
    notificationEnvironmentAuthority,
  );
  return Object.freeze({
    notificationEnvironmentAuthority,
    webhookSecretAuthority,
  });
}

export function readNotificationEnvironmentAuthority(options) {
  return readRuntimeEnvironmentAuthorities(options).notificationEnvironmentAuthority;
}

export function readWebhookSecretAuthority(options) {
  return readRuntimeEnvironmentAuthorities(options).webhookSecretAuthority;
}

export function requireNotificationEnvironmentAuthority(value) {
  if ((typeof value !== 'object' && typeof value !== 'function')
    || value === null
    || !brandedNotificationEnvironmentAuthorities.has(value)
    || !Object.isFrozen(value)) {
    throw notificationEnvironmentAuthorityError();
  }
  return value;
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

// This synchronous read is deliberately the first runtime operation. A single
// safe snapshot feeds ordinary dotenv parity, all twelve notification values
// and the existing webhook HMAC signer without ambient credential population.
const runtimeEnvironmentAuthorities = readRuntimeEnvironmentAuthorities({
  projectRoot,
  processEnvironment: process.env,
});
export const notificationEnvironmentAuthority =
  runtimeEnvironmentAuthorities.notificationEnvironmentAuthority;
export const webhookSecretAuthority =
  runtimeEnvironmentAuthorities.webhookSecretAuthority;

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
