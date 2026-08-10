// Runtime entry-point environment.
//
// The database module deliberately has no implicit path fallback: importing it
// without an explicit C3_DB_PATH must fail before it can touch operator data.
// The production server entry point imports this module first so the normal
// local runtime keeps its project-local default after dotenv has had a chance
// to override it. Other module entry points must import this bootstrap
// explicitly before initializing runtime state.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeLegacyLocalOrigins } from './security/legacy-local-access-policy.js';
import { requireLegacyLoopbackHost } from './security/legacy-listener-policy.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, '..');

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
