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

if (!process.env.C3_DB_PATH?.trim()) {
  process.env.C3_DB_PATH = path.join(projectRoot, 'data', 'c3.db');
}
