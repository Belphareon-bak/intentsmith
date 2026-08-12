#!/usr/bin/env node

// Trusted-local operator CLI for the terminal failover target authority.
// It has no HTTP/WS surface and never pulls, deletes, applies or starts a model.

import Database from 'better-sqlite3';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createModelAutomationPolicyRepository,
  createModelFailoverTargetInventoryReader,
} from '../src/db/model-policy.js';
import { OllamaModelBindingProvider } from '../src/upgrade/model-binding-application.js';

const COMMANDS = new Set(['status', 'set', 'clear']);
const OPTION_NAMES = new Set([
  'canonical-name',
  'database',
  'digest-sha256',
  'expected-revision',
  'requested-name',
  'role',
]);

function fail(message) {
  throw new Error(`MODEL_FAILOVER_TARGET_CLI_INVALID: ${message}`);
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length < 1 || !COMMANDS.has(argv[0])) {
    fail('expected status, set or clear command');
  }
  const command = argv[0];
  const options = Object.create(null);
  for (let index = 1; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (typeof token !== 'string' || !token.startsWith('--') || value === undefined) {
      fail('options must be exact --name value pairs');
    }
    const name = token.slice(2);
    if (!OPTION_NAMES.has(name) || Object.hasOwn(options, name)) {
      fail(`unknown or duplicate option: ${token}`);
    }
    options[name] = value;
  }
  const allowed = command === 'status'
    ? new Set(['database', 'role'])
    : command === 'clear'
      ? new Set(['database', 'expected-revision', 'role'])
      : new Set([
        'canonical-name',
        'database',
        'digest-sha256',
        'expected-revision',
        'requested-name',
        'role',
      ]);
  const unexpected = Object.keys(options).filter(name => !allowed.has(name));
  if (unexpected.length > 0) fail(`option not valid for ${command}: --${unexpected[0]}`);
  if (typeof options.database !== 'string' || !path.isAbsolute(options.database)) {
    fail('--database must be an explicit absolute path');
  }
  if (command !== 'status' || Object.hasOwn(options, 'role')) {
    if (typeof options.role !== 'string' || options.role.trim() === '') fail('--role is required');
  }
  if (command !== 'status') {
    if (!/^\d+$/.test(options['expected-revision'] || '')) {
      fail('--expected-revision must be a non-negative decimal integer');
    }
    const expectedRevision = Number(options['expected-revision']);
    if (!Number.isSafeInteger(expectedRevision)) fail('--expected-revision exceeds safe integer');
    options.expectedRevision = expectedRevision;
  }
  if (command === 'set') {
    for (const name of ['requested-name', 'canonical-name', 'digest-sha256']) {
      if (typeof options[name] !== 'string' || options[name].length === 0) {
        fail(`--${name} is required`);
      }
    }
  }
  return Object.freeze({ command, options: Object.freeze(options) });
}

function openOperatorDatabase(databasePath) {
  const lexicalPath = path.resolve(databasePath);
  if (lexicalPath !== databasePath || realpathSync(databasePath) !== lexicalPath) {
    fail('--database must be its canonical lexical path');
  }
  const before = lstatSync(lexicalPath, { bigint: true });
  const currentUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : null;
  if (!before.isFile()
    || before.isSymbolicLink()
    || before.nlink !== 1n
    || currentUid === null
    || before.uid !== currentUid) {
    fail('--database must be a current-user-owned regular non-symlink with one link');
  }
  const db = new Database(databasePath, { fileMustExist: true });
  const after = lstatSync(lexicalPath, { bigint: true });
  const openedPath = db.pragma('database_list').find(row => row.name === 'main')?.file;
  const identityChanged = after.dev !== before.dev
    || after.ino !== before.ino
    || after.uid !== before.uid
    || after.nlink !== 1n
    || !after.isFile()
    || openedPath !== lexicalPath;
  if (identityChanged) {
    db.close();
    fail('--database identity changed during open');
  }
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) {
      fail('foreign key authority is unavailable');
    }
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

export async function executeModelFailoverTargetCommand(input, dependencies = {}) {
  const parsed = parseArgs(input);
  const db = dependencies.db ?? openOperatorDatabase(parsed.options.database);
  const ownsDb = dependencies.db === undefined;
  try {
    if (parsed.command === 'status') {
      const repository = createModelAutomationPolicyRepository(db);
      return parsed.options.role
        ? repository.readTarget(parsed.options.role)
        : repository.readTargets();
    }
    if (parsed.command === 'clear') {
      return createModelAutomationPolicyRepository(db).clearTarget({
        role: parsed.options.role,
        expectedRevision: parsed.options.expectedRevision,
      });
    }

    const provider = dependencies.provider ?? new OllamaModelBindingProvider();
    if (!provider || typeof provider.listInstalled !== 'function') {
      fail('set requires a narrow installed-model inventory provider');
    }
    if (typeof provider.getOrigin !== 'function') {
      fail('set requires an exact loopback inventory origin');
    }
    const origin = new URL(provider.getOrigin());
    if (origin.protocol !== 'http:'
      || origin.hostname !== '127.0.0.1'
      || origin.username !== ''
      || origin.password !== ''
      || origin.pathname !== '/') {
      fail('inventory origin must be exact http://127.0.0.1 loopback');
    }
    const inventory = await provider.listInstalled();
    const targetInventoryReader = createModelFailoverTargetInventoryReader(inventory);
    return await createModelAutomationPolicyRepository(db, {
      targetInventoryReader,
    }).setTarget({
      role: parsed.options.role,
      expectedRevision: parsed.options.expectedRevision,
      target: {
        requestedName: parsed.options['requested-name'],
        canonicalName: parsed.options['canonical-name'],
        digestSha256: parsed.options['digest-sha256'],
      },
    });
  } finally {
    if (ownsDb) db.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const result = await executeModelFailoverTargetCommand(argv);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch(error => {
    process.stderr.write(`${error?.code || 'MODEL_FAILOVER_TARGET_CLI_FAILED'}: ${error?.message || error}\n`);
    process.exitCode = 1;
  });
}
