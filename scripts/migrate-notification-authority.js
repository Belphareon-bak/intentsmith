#!/usr/bin/env node

import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  LEGACY_NOTIFICATION_USER_SETTING_PATHS,
  readLegacyNotificationUserSettingsCensus,
  scrubLegacyNotificationUserSettingsInTransaction,
} from '../src/db/user-settings.js';
import {
  LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS,
  NOTIFICATION_ENV_OWNED_KEYS,
  ROOT_ENVIRONMENT_MAX_BYTES,
  ROOT_ENVIRONMENT_OWNER,
  patchRootEnvironmentFile,
  readRootEnvironmentFile,
} from '../src/security/root-environment-file.js';

export const NOTIFICATION_AUTHORITY_CENSUS_SCHEMA =
  'INTENTSMITH_NOTIFICATION_AUTHORITY_CENSUS/V1';
export const NOTIFICATION_AUTHORITY_MANIFEST_SCHEMA =
  'INTENTSMITH_NOTIFICATION_AUTHORITY_MANIFEST/V1';
export const NOTIFICATION_AUTHORITY_DECISIONS_SCHEMA =
  'INTENTSMITH_NOTIFICATION_AUTHORITY_DECISIONS/V1';
export const NOTIFICATION_AUTHORITY_PLAN_REPORT_SCHEMA =
  'INTENTSMITH_NOTIFICATION_AUTHORITY_PLAN_REPORT/V1';
export const LEGACY_CREDENTIAL_RECEIPT_SCHEMA =
  'INTENTSMITH_LEGACY_CREDENTIAL_RECEIPT/V1';
export const MIGRATION_ACTION = Object.freeze({
  TRANSFER: 'TRANSFER',
  EXPORT: 'EXPORT',
  PURGE: 'PURGE',
});

export const SETUP_NOTIFICATION_PATHS = Object.freeze([
  'notifications.email.from',
  'notifications.email.smtp',
  'notifications.email.to',
  'notifications.ntfy.server',
  'notifications.ntfy.topic',
  'notifications.telegram.chatId',
  'notifications.telegram.token',
]);

export const PAIASS_NOTIFICATION_PATHS = Object.freeze([
  'notifications.discordWebhook',
  'notifications.emailAddresses',
  'notifications.slackChannel',
  'notifications.slackWebhook',
  'notifications.smsApiKey',
  'notifications.smsPhone',
  'notifications.smsSecret',
  'notifications.telegramChatId',
  'notifications.telegramToken',
  'notifications.webhookUrl',
]);

const MODULE_PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_JSON_BYTES = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ENV_ASSIGNMENT_PATTERN = /^(\uFEFF?[^\S\r\n]*(?:export[^\S\r\n]+)?)([\w.-]+)(?:[^\S\r\n]*=[^\S\r\n]*|:[^\S\r\n]+)/u;
const CENSUS_PRIVATE = new WeakMap();
const LEGACY_DB_PATH_SET = new Set(LEGACY_NOTIFICATION_USER_SETTING_PATHS);

const DB_TARGETS = Object.freeze({
  '/notifications/telegramChatId': 'C3_TELEGRAM_CHAT_ID',
  '/notifications/telegramToken': 'C3_TELEGRAM_BOT_TOKEN',
  '/notifications/webhookUrl': 'C3_WEBHOOK_URL',
  'c3.notif.smtpFrom': 'C3_SMTP_FROM',
  'c3.notif.smtpHost': 'C3_SMTP_HOST',
  'c3.notif.smtpPass': 'C3_SMTP_PASS',
  'c3.notif.smtpPort': 'C3_SMTP_PORT',
  'c3.notif.smtpUser': 'C3_SMTP_USER',
  'c3.notif.webhookSecret': 'C3_WEBHOOK_SECRET',
  webhookSecret: 'C3_WEBHOOK_SECRET',
});

const SETUP_TARGETS = Object.freeze({
  'notifications.email.from': 'C3_SMTP_FROM',
  'notifications.ntfy.server': 'C3_NTFY_SERVER',
  'notifications.ntfy.topic': 'C3_NTFY_TOPIC',
  'notifications.telegram.chatId': 'C3_TELEGRAM_CHAT_ID',
  'notifications.telegram.token': 'C3_TELEGRAM_BOT_TOKEN',
});

const PAIASS_TARGETS = Object.freeze({
  'notifications.telegramChatId': 'C3_TELEGRAM_CHAT_ID',
  'notifications.telegramToken': 'C3_TELEGRAM_BOT_TOKEN',
  'notifications.webhookUrl': 'C3_WEBHOOK_URL',
});

const LEGACY_ENV_TARGETS = Object.freeze({
  EMAIL_FROM: 'C3_SMTP_FROM',
  NTFY_SERVER: 'C3_NTFY_SERVER',
  NTFY_TOPIC: 'C3_NTFY_TOPIC',
  TELEGRAM_BOT_TOKEN: 'C3_TELEGRAM_BOT_TOKEN',
  TELEGRAM_CHAT_ID: 'C3_TELEGRAM_CHAT_ID',
});

export class NotificationAuthorityMigrationError extends Error {
  constructor(code, { cause, report } = {}) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'NotificationAuthorityMigrationError';
    this.code = code;
    if (report !== undefined) {
      Object.defineProperty(this, 'report', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: report,
      });
    }
  }
}

function fail(code, cause) {
  throw new NotificationAuthorityMigrationError(code, cause ? { cause } : undefined);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    fail('MIGRATION_JSON_SERIALIZATION_FAILED', error);
  }
  if (typeof serialized !== 'string') fail('MIGRATION_JSON_SERIALIZATION_FAILED');
  return Buffer.from(serialized, 'utf8');
}

function valueSha256(value) {
  return sha256(jsonBytes(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return value;
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function requireAbsolutePath(value, code = 'MIGRATION_PATH_INVALID') {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) {
    fail(code);
  }
  return value;
}

function requireSha256(value, code = 'MIGRATION_SHA256_INVALID') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(code);
  return value;
}

function currentUid() {
  if (typeof process.geteuid !== 'function') fail('MIGRATION_PLATFORM_UNSAFE');
  return BigInt(process.geteuid());
}

function requireOpenFlags() {
  const { O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  if (!Number.isInteger(O_NOFOLLOW) || O_NOFOLLOW === 0
    || !Number.isInteger(O_NONBLOCK) || O_NONBLOCK === 0) {
    fail('MIGRATION_PLATFORM_UNSAFE');
  }
  return O_NOFOLLOW | O_NONBLOCK;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left, right) {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function requireSafeDirectory(directoryPath) {
  requireAbsolutePath(directoryPath);
  try {
    const stat = fs.lstatSync(directoryPath, { bigint: true });
    const mode = stat.mode & 0o7777n;
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== currentUid()
      || (mode & 0o7022n) !== 0n
      || fs.realpathSync(directoryPath) !== directoryPath) {
      fail('MIGRATION_DIRECTORY_UNSAFE');
    }
    return stat;
  } catch (error) {
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_DIRECTORY_UNSAFE', error);
  }
}

function requireSafeFileStat(stat, { mode0600 = false, maximumBytes = null } = {}) {
  const mode = stat.mode & 0o7777n;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== currentUid()
    || stat.nlink !== 1n || (mode & 0o7000n) !== 0n
    || (mode0600 && mode !== 0o600n)
    || (maximumBytes !== null && (stat.size < 0n || stat.size > BigInt(maximumBytes)))) {
    fail('MIGRATION_FILE_UNSAFE');
  }
  return stat;
}

function readBounded(descriptor, maximumBytes) {
  const chunks = [];
  let length = 0;
  while (length <= maximumBytes) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes + 1 - length));
    if (chunk.length === 0) break;
    const read = fs.readSync(descriptor, chunk, 0, chunk.length, null);
    if (read === 0) break;
    chunks.push(chunk.subarray(0, read));
    length += read;
  }
  if (length > maximumBytes) fail('MIGRATION_FILE_UNSAFE');
  return Buffer.concat(chunks, length);
}

function readSafeFileSnapshot(filePath, {
  allowAbsent = false,
  maximumBytes = MAX_JSON_BYTES,
  mode0600 = false,
} = {}) {
  requireAbsolutePath(filePath);
  const directoryPath = path.dirname(filePath);
  const directoryStat = requireSafeDirectory(directoryPath);
  let pathStat;
  try {
    pathStat = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (allowAbsent && error?.code === 'ENOENT') {
      const currentDirectory = requireSafeDirectory(directoryPath);
      if (!sameIdentity(directoryStat, currentDirectory)) fail('MIGRATION_DIRECTORY_UNSAFE');
      return deepFreeze({
        bytes: Buffer.alloc(0),
        exists: false,
        identity: null,
        mode: null,
        path: filePath,
        sha256: sha256(Buffer.alloc(0)),
      });
    }
    fail('MIGRATION_FILE_UNSAFE', error);
  }
  requireSafeFileStat(pathStat, { maximumBytes, mode0600 });

  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | requireOpenFlags(),
    );
    const openedStat = fs.fstatSync(descriptor, { bigint: true });
    requireSafeFileStat(openedStat, { maximumBytes, mode0600 });
    if (!sameStableFile(pathStat, openedStat)) fail('MIGRATION_FILE_UNSAFE');
    const bytes = readBounded(descriptor, maximumBytes);
    const afterRead = fs.fstatSync(descriptor, { bigint: true });
    requireSafeFileStat(afterRead, { maximumBytes, mode0600 });
    if (!sameStableFile(openedStat, afterRead) || afterRead.size !== BigInt(bytes.length)) {
      fail('MIGRATION_FILE_UNSAFE');
    }
    const finalPathStat = fs.lstatSync(filePath, { bigint: true });
    requireSafeFileStat(finalPathStat, { maximumBytes, mode0600 });
    const finalDirectory = requireSafeDirectory(directoryPath);
    if (!sameStableFile(afterRead, finalPathStat)
      || !sameIdentity(directoryStat, finalDirectory)) {
      fail('MIGRATION_FILE_UNSAFE');
    }
    return deepFreeze({
      bytes,
      exists: true,
      identity: `${afterRead.dev}:${afterRead.ino}`,
      mode: Number(afterRead.mode & 0o7777n),
      path: filePath,
      sha256: sha256(bytes),
    });
  } catch (error) {
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_FILE_UNSAFE', error);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { fail('MIGRATION_FILE_UNSAFE'); }
    }
  }
}

function readExactFileIdentity(filePath, expectedStat, expectedBytes, {
  maximumBytes,
  mode0600,
}) {
  requireSafeFileStat(expectedStat, { maximumBytes, mode0600 });
  const pathStat = fs.lstatSync(filePath, { bigint: true });
  requireSafeFileStat(pathStat, { maximumBytes, mode0600 });
  if (!sameStableFile(expectedStat, pathStat)) fail('MIGRATION_FILE_WRITE_FAILED');
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | requireOpenFlags());
    const openedStat = fs.fstatSync(descriptor, { bigint: true });
    requireSafeFileStat(openedStat, { maximumBytes, mode0600 });
    if (!sameStableFile(expectedStat, openedStat)) fail('MIGRATION_FILE_WRITE_FAILED');
    const bytes = readBounded(descriptor, maximumBytes);
    const afterRead = fs.fstatSync(descriptor, { bigint: true });
    requireSafeFileStat(afterRead, { maximumBytes, mode0600 });
    const finalPathStat = fs.lstatSync(filePath, { bigint: true });
    requireSafeFileStat(finalPathStat, { maximumBytes, mode0600 });
    if (!sameStableFile(openedStat, afterRead)
      || !sameStableFile(afterRead, finalPathStat)
      || !bytes.equals(expectedBytes)) {
      fail('MIGRATION_FILE_WRITE_FAILED');
    }
    return afterRead;
  } catch (error) {
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_FILE_WRITE_FAILED', error);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { fail('MIGRATION_FILE_WRITE_FAILED'); }
    }
  }
}

function cleanupExactTemporaryFile(filePath, identityStat, options) {
  if (!identityStat) return;
  try {
    const current = fs.lstatSync(filePath, { bigint: true });
    requireSafeFileStat(current, options);
    if (sameIdentity(identityStat, current)) fs.unlinkSync(filePath);
  } catch { /* best effort only for the exact unpublished temp inode */ }
}

function decodeFatalUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    fail('MIGRATION_UTF8_INVALID', error);
  }
}

function parseJsonSnapshot(snapshot) {
  let document;
  try {
    document = JSON.parse(decodeFatalUtf8(snapshot.bytes));
  } catch (error) {
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_JSON_INVALID', error);
  }
  if (!isPlainObject(document)) fail('MIGRATION_JSON_INVALID');
  return document;
}

function getDottedPath(document, dottedPath) {
  let value = document;
  for (const segment of dottedPath.split('.')) {
    if (!isPlainObject(value) || !Object.hasOwn(value, segment)) {
      return { present: false, value: undefined };
    }
    value = value[segment];
  }
  return { present: true, value };
}

function deleteDottedPath(document, dottedPath) {
  const segments = dottedPath.split('.');
  const leaf = segments.pop();
  let parent = document;
  for (const segment of segments) {
    if (!isPlainObject(parent) || !Object.hasOwn(parent, segment)) return;
    parent = parent[segment];
  }
  if (isPlainObject(parent)) delete parent[leaf];
}

function numericSmtpPort(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 65535
    ? String(value)
    : null;
}

function classifyFinding(pathId, value, targetKey) {
  if (targetKey && typeof value === 'string') {
    return { classification: 'DIRECT_STRING', recommendedAction: 'TRANSFER', targetKey };
  }
  if (pathId === 'c3.notif.smtpPort' && targetKey === 'C3_SMTP_PORT'
    && numericSmtpPort(value) !== null) {
    return {
      classification: 'NUMERIC_SMTP_PORT',
      recommendedAction: 'TRANSFER',
      targetKey,
    };
  }
  return {
    classification: typeof value === 'string' ? 'UNMAPPABLE' : 'NON_STRING',
    recommendedAction: 'EXPORT',
    targetKey: null,
  };
}

function makeFinding(sourceId, pathId, value, targetKey) {
  const classification = classifyFinding(pathId, value, targetKey);
  return deepFreeze({
    sourceId,
    path: pathId,
    valueSha256: valueSha256(value),
    valueType: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
    ...classification,
  });
}

function sourceId(kind, locator) {
  return `${kind}:${sha256(Buffer.from(locator, 'utf8')).slice(0, 24)}`;
}

function splitLinesWithEndings(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\r' && text[index] !== '\n') continue;
    const end = text[index] === '\r' && text[index + 1] === '\n' ? index + 2 : index + 1;
    lines.push(text.slice(start, end));
    start = end;
    if (end === index + 2) index += 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function stripLineEnding(line) {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\r') || line.endsWith('\n')) return line.slice(0, -1);
  return line;
}

function renderExactEnvDeletion(bytes, keys) {
  const selected = new Set(keys);
  let text = decodeFatalUtf8(bytes);
  const fileBom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  if (fileBom) text = text.slice(1);
  const lines = splitLinesWithEndings(text);
  const retained = lines.filter(line => {
    const match = ENV_ASSIGNMENT_PATTERN.exec(stripLineEnding(line));
    return !match || !selected.has(match[2]);
  });
  return Buffer.from(`${fileBom}${retained.join('')}`, 'utf8');
}

function readEnvironmentSource(filePath, { allowAbsent, kind, locator }) {
  if (path.basename(filePath) !== '.env') fail('MIGRATION_ENV_PATH_INVALID');
  const before = readSafeFileSnapshot(filePath, {
    allowAbsent,
    maximumBytes: ROOT_ENVIRONMENT_MAX_BYTES,
    mode0600: true,
  });
  const projectRoot = path.dirname(filePath);
  const canonical = readRootEnvironmentFile({
    projectRoot,
    owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
  });
  const legacy = readRootEnvironmentFile({
    projectRoot,
    owner: ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB,
  });
  const after = readSafeFileSnapshot(filePath, {
    allowAbsent,
    maximumBytes: ROOT_ENVIRONMENT_MAX_BYTES,
    mode0600: true,
  });
  if (before.exists !== after.exists || before.identity !== after.identity
    || before.sha256 !== after.sha256) {
    fail('MIGRATION_SOURCE_CHANGED');
  }
  const canonicalValues = new Map(canonical.keys().map(key => [key, canonical.value(key)]));
  const legacyValues = new Map(legacy.keys().map(key => [key, legacy.value(key)]));
  return {
    canonicalValues,
    kind,
    legacyValues,
    locator,
    snapshot: before,
  };
}

function readDatabaseSource(databasePath) {
  requireAbsolutePath(databasePath, 'MIGRATION_DATABASE_PATH_INVALID');
  requireSafeDirectory(path.dirname(databasePath));
  const stat = fs.lstatSync(databasePath, { bigint: true });
  requireSafeFileStat(stat);
  let db;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
    const openedPathStat = fs.lstatSync(databasePath, { bigint: true });
    requireSafeFileStat(openedPathStat);
    if (!sameIdentity(stat, openedPathStat)) fail('MIGRATION_SOURCE_CHANGED');
    const census = readLegacyNotificationUserSettingsCensus(db);
    const paths = census.paths().map(entry => entry.path);
    if (LEGACY_DB_PATH_SET.size !== 21 || paths.length > 21
      || new Set(paths).size !== paths.length
      || paths.some(pathId => !LEGACY_DB_PATH_SET.has(pathId))) {
      fail('MIGRATION_DATABASE_CENSUS_INVALID');
    }
    const request = paths.length > 0 ? census.scrubRequest(paths) : null;
    const id = sourceId('DB', databasePath);
    const findings = census.paths().map(entry => {
      const value = census.value(entry.path);
      return makeFinding(id, entry.path, value, DB_TARGETS[entry.path] || null);
    });
    return {
      findings,
      privateValues: new Map(findings.map(finding => [finding.path, census.value(finding.path)])),
      publicSource: deepFreeze({
        sourceId: id,
        kind: 'DB',
        locator: databasePath,
        exists: true,
        identity: `${stat.dev}:${stat.ino}`,
        preimageSha256: census.preimageSha256(),
        postimageSha256: request?.postimageSha256 || census.preimageSha256(),
        revision: census.revision(),
      }),
    };
  } catch (error) {
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_DATABASE_READ_FAILED', error);
  } finally {
    if (db) db.close();
  }
}

function readJsonFindingSource(filePath, {
  allowAbsent,
  kind,
  mode0600,
  paths,
  targets,
}) {
  const snapshot = readSafeFileSnapshot(filePath, { allowAbsent, mode0600 });
  const id = sourceId(kind, filePath);
  if (!snapshot.exists) {
    return {
      findings: [],
      privateValues: new Map(),
      publicSource: deepFreeze({
        sourceId: id,
        kind,
        locator: filePath,
        exists: false,
        identity: null,
        preimageSha256: snapshot.sha256,
        postimageSha256: snapshot.sha256,
        revision: null,
      }),
      snapshot,
    };
  }
  const document = parseJsonSnapshot(snapshot);
  const next = structuredClone(document);
  const findings = [];
  const privateValues = new Map();
  for (const pathId of paths) {
    const state = getDottedPath(document, pathId);
    if (!state.present) continue;
    findings.push(makeFinding(id, pathId, state.value, targets[pathId] || null));
    privateValues.set(pathId, structuredClone(state.value));
    deleteDottedPath(next, pathId);
  }
  return {
    document,
    findings,
    privateValues,
    publicSource: deepFreeze({
      sourceId: id,
      kind,
      locator: filePath,
      exists: true,
      identity: snapshot.identity,
      preimageSha256: snapshot.sha256,
      postimageSha256: sha256(jsonBytes(next)),
      revision: null,
    }),
    snapshot,
  };
}

function makeEnvironmentFindingSource(environment, role) {
  const id = sourceId('ENV', environment.locator);
  const values = new Map();
  if (role !== 'ROOT') {
    for (const [key, value] of environment.canonicalValues) values.set(key, value);
  }
  for (const [key, value] of environment.legacyValues) values.set(key, value);
  const findings = [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => makeFinding(
      id,
      key,
      value,
      NOTIFICATION_ENV_OWNED_KEYS.includes(key)
        ? key
        : LEGACY_ENV_TARGETS[key] || null,
    ));
  const postimageBytes = renderExactEnvDeletion(
    environment.snapshot.bytes,
    findings.map(finding => finding.path),
  );
  const allOwnedKeys = [...NOTIFICATION_ENV_OWNED_KEYS, ...LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS];
  const foreignBytes = renderExactEnvDeletion(environment.snapshot.bytes, allOwnedKeys);
  return {
    environmentSnapshot: environment.snapshot,
    findings,
    privateValues: values,
    publicSource: deepFreeze({
      sourceId: id,
      kind: 'ENV',
      role,
      locator: environment.locator,
      exists: environment.snapshot.exists,
      identity: environment.snapshot.identity,
      preimageSha256: environment.snapshot.sha256,
      postimageSha256: sha256(postimageBytes),
      foreignBytesSha256: sha256(foreignBytes),
      revision: null,
    }),
  };
}

function readProcessSource(processEnvironment) {
  if (!isPlainObject(processEnvironment)) fail('MIGRATION_PROCESS_ENV_INVALID');
  const id = 'PROCESS_ENV';
  const privateValues = new Map();
  for (const key of LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS) {
    if (Object.hasOwn(processEnvironment, key)) privateValues.set(key, processEnvironment[key]);
  }
  const findings = [...privateValues]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => makeFinding(id, key, value, LEGACY_ENV_TARGETS[key] || null));
  const preimage = Object.fromEntries([...privateValues].sort(([left], [right]) => (
    left.localeCompare(right)
  )));
  return {
    findings,
    privateValues,
    publicSource: deepFreeze({
      sourceId: id,
      kind: 'PROCESS_ENV',
      locator: 'PROCESS_ENV',
      exists: findings.length > 0,
      identity: null,
      preimageSha256: sha256(jsonBytes(preimage)),
      postimageSha256: sha256(jsonBytes({})),
      revision: null,
    }),
  };
}

function targetProjection(rootEnvironment, processEnvironment) {
  return NOTIFICATION_ENV_OWNED_KEYS.map(key => {
    const processPresent = Object.hasOwn(processEnvironment, key);
    const rootPresent = rootEnvironment.canonicalValues.has(key);
    return deepFreeze({
      key,
      processPresent,
      processValueSha256: processPresent ? valueSha256(processEnvironment[key]) : null,
      rootPresent,
      rootValueSha256: rootPresent
        ? valueSha256(rootEnvironment.canonicalValues.get(key))
        : null,
    });
  });
}

function normalizeHistoricalEnvironmentPaths(paths) {
  if (!Array.isArray(paths) || paths.some(value => typeof value !== 'string')) {
    fail('MIGRATION_ENV_PATH_INVALID');
  }
  const normalized = paths.map(value => requireAbsolutePath(value, 'MIGRATION_ENV_PATH_INVALID'));
  if (new Set(normalized).size !== normalized.length) fail('MIGRATION_ENV_PATH_INVALID');
  return normalized.sort();
}

function censusIdentityProjection(value) {
  return {
    schema: value.schema,
    databasePath: value.databasePath,
    dataDir: value.dataDir,
    historicalEnvironmentPaths: value.historicalEnvironmentPaths,
    paiassInputPath: value.paiassInputPath,
    sources: value.sources,
    targets: value.targets,
    findings: value.findings,
  };
}

export function censusNotificationAuthority({
  databasePath,
  dataDir,
  historicalEnvironmentPaths = [],
  paiassInputPath = null,
  processEnvironment = process.env,
} = {}) {
  requireAbsolutePath(databasePath, 'MIGRATION_DATABASE_PATH_INVALID');
  requireAbsolutePath(dataDir, 'MIGRATION_DATA_DIR_INVALID');
  requireSafeDirectory(dataDir);
  const historicalPaths = normalizeHistoricalEnvironmentPaths(historicalEnvironmentPaths);
  if (paiassInputPath !== null) {
    requireAbsolutePath(paiassInputPath, 'MIGRATION_PAIASS_PATH_INVALID');
  }

  const database = readDatabaseSource(databasePath);
  const setup = readJsonFindingSource(path.join(dataDir, 'c3-setup.json'), {
    allowAbsent: true,
    kind: 'SETUP',
    mode0600: false,
    paths: SETUP_NOTIFICATION_PATHS,
    targets: SETUP_TARGETS,
  });
  const rootPath = path.join(MODULE_PROJECT_ROOT, '.env');
  const rootEnvironment = readEnvironmentSource(rootPath, {
    allowAbsent: true,
    kind: 'ENV',
    locator: rootPath,
  });
  const root = makeEnvironmentFindingSource(rootEnvironment, 'ROOT');
  const processSource = readProcessSource(processEnvironment);

  const environmentSources = [root];
  const seenEnvironmentIdentities = new Set();
  if (rootEnvironment.snapshot.identity) seenEnvironmentIdentities.add(rootEnvironment.snapshot.identity);
  const candidateEnvironments = [
    { allowAbsent: true, path: path.join(dataDir, '.env'), role: 'DATA_DIR' },
    ...historicalPaths.map(filePath => ({ allowAbsent: false, path: filePath, role: 'HISTORICAL' })),
  ];
  for (const candidate of candidateEnvironments) {
    const environment = readEnvironmentSource(candidate.path, {
      allowAbsent: candidate.allowAbsent,
      kind: 'ENV',
      locator: candidate.path,
    });
    if (environment.snapshot.identity
      && seenEnvironmentIdentities.has(environment.snapshot.identity)) continue;
    if (environment.snapshot.identity) seenEnvironmentIdentities.add(environment.snapshot.identity);
    environmentSources.push(makeEnvironmentFindingSource(environment, candidate.role));
  }

  const paiass = paiassInputPath === null ? null : readJsonFindingSource(paiassInputPath, {
    allowAbsent: false,
    kind: 'PAIASS_SETTINGS',
    mode0600: true,
    paths: PAIASS_NOTIFICATION_PATHS,
    targets: PAIASS_TARGETS,
  });

  const allSources = [database, setup, ...environmentSources, processSource];
  if (paiass) allSources.push(paiass);
  const sources = allSources.map(source => source.publicSource)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const findings = allSources.flatMap(source => source.findings)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId)
      || left.path.localeCompare(right.path));
  const targets = targetProjection(rootEnvironment, processEnvironment);

  const publicCensus = {
    schema: NOTIFICATION_AUTHORITY_CENSUS_SCHEMA,
    databasePath,
    dataDir,
    historicalEnvironmentPaths: historicalPaths,
    paiassInputPath,
    sources,
    targets,
    findings,
  };
  publicCensus.censusSha256 = sha256(jsonBytes(censusIdentityProjection(publicCensus)));
  publicCensus.decisionsTemplate = deepFreeze({
    schema: NOTIFICATION_AUTHORITY_DECISIONS_SCHEMA,
    censusSha256: publicCensus.censusSha256,
    actions: findings.map(finding => deepFreeze({
      sourceId: finding.sourceId,
      path: finding.path,
      valueSha256: finding.valueSha256,
      action: null,
    })),
  });
  deepFreeze(publicCensus);
  CENSUS_PRIVATE.set(publicCensus, {
    allSources,
    processEnvironment,
    rootEnvironment,
  });
  return publicCensus;
}

function exactActionSelection(selection) {
  if (!isPlainObject(selection)) fail('MIGRATION_ACTION_INVALID');
  const keys = Object.keys(selection).sort();
  const hasNumericOverride = Object.hasOwn(selection, 'canonicalValue')
    || Object.hasOwn(selection, 'canonicalValueSha256');
  const allowed = selection.action === MIGRATION_ACTION.EXPORT
    ? ['action', 'exportPath', 'path', 'sourceId', 'valueSha256']
    : hasNumericOverride
      ? [
        'action', 'canonicalValue', 'canonicalValueSha256',
        'path', 'sourceId', 'valueSha256',
      ]
      : ['action', 'path', 'sourceId', 'valueSha256'];
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    fail('MIGRATION_ACTION_INVALID');
  }
  if (!Object.values(MIGRATION_ACTION).includes(selection.action)
    || typeof selection.sourceId !== 'string' || typeof selection.path !== 'string') {
    fail('MIGRATION_ACTION_INVALID');
  }
  requireSha256(selection.valueSha256, 'MIGRATION_ACTION_INVALID');
  if (selection.action === MIGRATION_ACTION.EXPORT) {
    requireAbsolutePath(selection.exportPath, 'MIGRATION_EXPORT_PATH_INVALID');
  }
  if (hasNumericOverride) {
    if (selection.action !== MIGRATION_ACTION.TRANSFER
      || selection.path !== 'c3.notif.smtpPort'
      || typeof selection.canonicalValue !== 'string') {
      fail('MIGRATION_ACTION_INVALID');
    }
    requireSha256(selection.canonicalValueSha256, 'MIGRATION_ACTION_INVALID');
  }
  return selection;
}

export function createNotificationAuthorityManifest(census, selections) {
  const privateState = CENSUS_PRIVATE.get(census);
  if (!privateState || !Object.isFrozen(census) || !Array.isArray(selections)) {
    fail('MIGRATION_CENSUS_INVALID');
  }
  if (selections.length !== census.findings.length) fail('MIGRATION_ACTION_REQUIRED');
  const selectionMap = new Map();
  for (const rawSelection of selections) {
    const selection = exactActionSelection(rawSelection);
    const key = `${selection.sourceId}\0${selection.path}`;
    if (selectionMap.has(key)) fail('MIGRATION_ACTION_INVALID');
    selectionMap.set(key, selection);
  }
  const exportPaths = new Set();
  const actions = census.findings.map(finding => {
    const selection = selectionMap.get(`${finding.sourceId}\0${finding.path}`);
    if (!selection) fail('MIGRATION_ACTION_REQUIRED');
    if (selection.valueSha256 !== finding.valueSha256) fail('MIGRATION_SOURCE_CHANGED');
    let numericOverride = null;
    if (selection.action === MIGRATION_ACTION.TRANSFER) {
      if (finding.classification === 'NUMERIC_SMTP_PORT'
        && finding.path === 'c3.notif.smtpPort'
        && finding.targetKey === 'C3_SMTP_PORT') {
        const rawValue = privateValue(census, finding);
        const canonicalValue = numericSmtpPort(rawValue);
        if (canonicalValue === null
          || selection.canonicalValue !== canonicalValue
          || selection.canonicalValueSha256 !== valueSha256(canonicalValue)) {
          fail('MIGRATION_TRANSFER_UNSUPPORTED');
        }
        numericOverride = {
          canonicalValue,
          canonicalValueSha256: selection.canonicalValueSha256,
        };
      } else if (finding.classification !== 'DIRECT_STRING'
        || !finding.targetKey
        || Object.hasOwn(selection, 'canonicalValue')
        || Object.hasOwn(selection, 'canonicalValueSha256')) {
        fail('MIGRATION_TRANSFER_UNSUPPORTED');
      }
    }
    if (selection.action === MIGRATION_ACTION.EXPORT) {
      if (exportPaths.has(selection.exportPath)) fail('MIGRATION_EXPORT_PATH_INVALID');
      exportPaths.add(selection.exportPath);
    }
    return deepFreeze({
      sourceId: finding.sourceId,
      path: finding.path,
      valueSha256: finding.valueSha256,
      classification: finding.classification,
      targetKey: finding.targetKey,
      action: selection.action,
      ...(numericOverride || {}),
      ...(selection.action === MIGRATION_ACTION.EXPORT
        ? { exportPath: selection.exportPath }
        : {}),
    });
  });
  const manifest = {
    schema: NOTIFICATION_AUTHORITY_MANIFEST_SCHEMA,
    censusSha256: census.censusSha256,
    databasePath: census.databasePath,
    dataDir: census.dataDir,
    historicalEnvironmentPaths: census.historicalEnvironmentPaths,
    paiassInputPath: census.paiassInputPath,
    sources: census.sources,
    targets: census.targets,
    actions,
  };
  manifest.paiassReceipts = createManifestPaiassReceiptPlan(census, manifest);
  return deepFreeze(manifest);
}

function normalizeReceiptPathDigests(pathDigests) {
  if (!Array.isArray(pathDigests) || pathDigests.length < 1
    || pathDigests.length > PAIASS_NOTIFICATION_PATHS.length) {
    fail('MIGRATION_RECEIPT_INVALID');
  }
  const normalized = pathDigests.map(entry => {
    if (!isPlainObject(entry)
      || Object.keys(entry).sort().join(',') !== 'path,valueSha256'
      || !PAIASS_NOTIFICATION_PATHS.includes(entry.path)) {
      fail('MIGRATION_RECEIPT_INVALID');
    }
    return deepFreeze({
      path: entry.path,
      valueSha256: requireSha256(entry.valueSha256, 'MIGRATION_RECEIPT_INVALID'),
    });
  });
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index - 1].path >= normalized[index].path) {
      fail('MIGRATION_RECEIPT_INVALID');
    }
  }
  return deepFreeze(normalized);
}

export function createPaiassReceipt({
  action,
  preimageBytes,
  postimageBytes,
  pathDigests,
  exportSha256,
}) {
  if (!Buffer.isBuffer(preimageBytes) || !Buffer.isBuffer(postimageBytes)
    || ![MIGRATION_ACTION.EXPORT, MIGRATION_ACTION.PURGE].includes(action)) {
    fail('MIGRATION_RECEIPT_INVALID');
  }
  const normalizedPathDigests = normalizeReceiptPathDigests(pathDigests);
  const preimageDocument = parseJsonSnapshot({ bytes: preimageBytes });
  const predictedPostimage = structuredClone(preimageDocument);
  for (const entry of normalizedPathDigests) {
    const state = getDottedPath(preimageDocument, entry.path);
    if (!state.present || valueSha256(state.value) !== entry.valueSha256) {
      fail('MIGRATION_RECEIPT_INVALID');
    }
    deleteDottedPath(predictedPostimage, entry.path);
  }
  if (!jsonBytes(predictedPostimage).equals(postimageBytes)) {
    fail('MIGRATION_RECEIPT_INVALID');
  }
  const receipt = {
    schema: LEGACY_CREDENTIAL_RECEIPT_SCHEMA,
    source: 'PAIASS_SETTINGS',
    action,
    preimageSha256: sha256(preimageBytes),
    postimageSha256: sha256(postimageBytes),
    pathDigests: normalizedPathDigests,
  };
  if (action === MIGRATION_ACTION.EXPORT) {
    receipt.exportSha256 = requireSha256(exportSha256, 'MIGRATION_RECEIPT_INVALID');
  } else if (exportSha256 !== undefined) {
    fail('MIGRATION_RECEIPT_INVALID');
  }
  return deepFreeze(receipt);
}

function createPaiassReceiptSequence(preimageBytes, document, actions) {
  let currentDocument = structuredClone(document);
  let currentBytes = Buffer.from(preimageBytes);
  const receipts = [];
  for (const action of actions.filter(entry => entry.action === MIGRATION_ACTION.EXPORT)) {
    const state = getDottedPath(currentDocument, action.path);
    if (!state.present || valueSha256(state.value) !== action.valueSha256) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    const next = structuredClone(currentDocument);
    deleteDottedPath(next, action.path);
    const nextBytes = jsonBytes(next);
    receipts.push(createPaiassReceipt({
      action: MIGRATION_ACTION.EXPORT,
      preimageBytes: currentBytes,
      postimageBytes: nextBytes,
      pathDigests: [{ path: action.path, valueSha256: action.valueSha256 }],
      exportSha256: action.valueSha256,
    }));
    currentDocument = next;
    currentBytes = nextBytes;
  }
  const purgeActions = actions.filter(entry => entry.action !== MIGRATION_ACTION.EXPORT);
  if (purgeActions.length > 0) {
    const next = structuredClone(currentDocument);
    for (const action of purgeActions) {
      const state = getDottedPath(currentDocument, action.path);
      if (!state.present || valueSha256(state.value) !== action.valueSha256) {
        fail('MIGRATION_SOURCE_CHANGED');
      }
      deleteDottedPath(next, action.path);
    }
    const nextBytes = jsonBytes(next);
    receipts.push(createPaiassReceipt({
      action: MIGRATION_ACTION.PURGE,
      preimageBytes: currentBytes,
      postimageBytes: nextBytes,
      pathDigests: purgeActions.map(action => ({
        path: action.path,
        valueSha256: action.valueSha256,
      })).sort((left, right) => left.path.localeCompare(right.path)),
    }));
  }
  return deepFreeze(receipts);
}

function createManifestPaiassReceiptPlan(census, manifest) {
  const source = manifest.sources.find(candidate => candidate.kind === 'PAIASS_SETTINGS');
  if (!source) return deepFreeze([]);
  const privateState = CENSUS_PRIVATE.get(census);
  const privateSource = privateState?.allSources.find(candidate => (
    candidate.publicSource.sourceId === source.sourceId
  ));
  if (!privateSource?.snapshot?.exists || !privateSource.document) {
    fail('MIGRATION_SOURCE_CHANGED');
  }
  const actions = manifest.actions
    .filter(action => action.sourceId === source.sourceId)
    .sort((left, right) => left.path.localeCompare(right.path));
  const receipts = createPaiassReceiptSequence(
    privateSource.snapshot.bytes,
    privateSource.document,
    actions,
  );
  if (receipts.length === 0) {
    if (source.preimageSha256 !== source.postimageSha256) fail('MIGRATION_RECEIPT_INVALID');
  } else if (receipts[0].preimageSha256 !== source.preimageSha256
    || receipts.at(-1).postimageSha256 !== source.postimageSha256) {
    fail('MIGRATION_RECEIPT_INVALID');
  }
  return receipts;
}

function validateManifestTargets(targets) {
  if (!Array.isArray(targets) || targets.length !== NOTIFICATION_ENV_OWNED_KEYS.length) {
    fail('MIGRATION_MANIFEST_INVALID');
  }
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    requireExactKeys(target, [
      'key',
      'processPresent',
      'processValueSha256',
      'rootPresent',
      'rootValueSha256',
    ], 'MIGRATION_MANIFEST_INVALID');
    if (target.key !== NOTIFICATION_ENV_OWNED_KEYS[index]
      || typeof target.processPresent !== 'boolean'
      || typeof target.rootPresent !== 'boolean') {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    if (target.processPresent) {
      requireSha256(target.processValueSha256, 'MIGRATION_MANIFEST_INVALID');
    } else if (target.processValueSha256 !== null) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    if (target.rootPresent) {
      requireSha256(target.rootValueSha256, 'MIGRATION_MANIFEST_INVALID');
    } else if (target.rootValueSha256 !== null) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
  }
}

function validateManifestPaiassReceiptPlan(manifest, sourceMap) {
  if (!Array.isArray(manifest.paiassReceipts)) fail('MIGRATION_MANIFEST_INVALID');
  const source = [...sourceMap.values()].find(candidate => candidate.kind === 'PAIASS_SETTINGS');
  const actions = source
    ? manifest.actions.filter(action => action.sourceId === source.sourceId)
    : [];
  if (!source) {
    if (manifest.paiassReceipts.length !== 0) fail('MIGRATION_MANIFEST_INVALID');
    return;
  }
  const exportActions = actions.filter(action => action.action === MIGRATION_ACTION.EXPORT);
  const purgeActions = actions.filter(action => action.action !== MIGRATION_ACTION.EXPORT);
  const expectedReceiptCount = exportActions.length + (purgeActions.length > 0 ? 1 : 0);
  if (manifest.paiassReceipts.length !== expectedReceiptCount) {
    fail('MIGRATION_MANIFEST_INVALID');
  }
  let previousPostimage = source.preimageSha256;
  for (let index = 0; index < manifest.paiassReceipts.length; index++) {
    const receipt = manifest.paiassReceipts[index];
    const expectedAction = index < exportActions.length
      ? MIGRATION_ACTION.EXPORT
      : MIGRATION_ACTION.PURGE;
    requireExactKeys(
      receipt,
      expectedAction === MIGRATION_ACTION.EXPORT
        ? [
          'schema', 'source', 'action', 'preimageSha256',
          'postimageSha256', 'pathDigests', 'exportSha256',
        ]
        : [
          'schema', 'source', 'action', 'preimageSha256',
          'postimageSha256', 'pathDigests',
        ],
      'MIGRATION_MANIFEST_INVALID',
    );
    if (receipt.schema !== LEGACY_CREDENTIAL_RECEIPT_SCHEMA
      || receipt.source !== 'PAIASS_SETTINGS'
      || receipt.action !== expectedAction
      || requireSha256(receipt.preimageSha256, 'MIGRATION_MANIFEST_INVALID')
        !== previousPostimage) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    requireSha256(receipt.postimageSha256, 'MIGRATION_MANIFEST_INVALID');
    const pathDigests = normalizeReceiptPathDigests(receipt.pathDigests);
    if (expectedAction === MIGRATION_ACTION.EXPORT) {
      const action = exportActions[index];
      if (pathDigests.length !== 1
        || pathDigests[0].path !== action.path
        || pathDigests[0].valueSha256 !== action.valueSha256
        || requireSha256(receipt.exportSha256, 'MIGRATION_MANIFEST_INVALID')
          !== action.valueSha256) {
        fail('MIGRATION_MANIFEST_INVALID');
      }
    } else if (pathDigests.length !== purgeActions.length
      || pathDigests.some((entry, pathIndex) => (
        entry.path !== purgeActions[pathIndex].path
        || entry.valueSha256 !== purgeActions[pathIndex].valueSha256
      ))) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    previousPostimage = receipt.postimageSha256;
  }
  if (previousPostimage !== source.postimageSha256) fail('MIGRATION_MANIFEST_INVALID');
}

function fsyncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      directoryPath,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY || 0)
        | requireOpenFlags(),
    );
    fs.fsyncSync(descriptor);
  } catch (error) {
    fail('MIGRATION_FILE_WRITE_FAILED', error);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { fail('MIGRATION_FILE_WRITE_FAILED'); }
    }
  }
}

function atomicReplaceFile(snapshot, nextBytes, { mode0600 }) {
  if (!snapshot.exists || !Buffer.isBuffer(nextBytes)) fail('MIGRATION_FILE_WRITE_FAILED');
  if (snapshot.bytes.equals(nextBytes)) return deepFreeze({ changed: false });
  const directoryPath = path.dirname(snapshot.path);
  const directoryStat = requireSafeDirectory(directoryPath);
  const current = readSafeFileSnapshot(snapshot.path, {
    maximumBytes: Math.max(MAX_JSON_BYTES, nextBytes.length),
    mode0600,
  });
  if (current.identity !== snapshot.identity || current.sha256 !== snapshot.sha256) {
    fail('MIGRATION_SOURCE_CHANGED');
  }
  const tempPath = path.join(
    directoryPath,
    `.${path.basename(snapshot.path)}.notification-migration-${process.pid}-${randomBytes(12).toString('hex')}.tmp`,
  );
  let tempCreated = false;
  let published = false;
  let tempIdentityStat;
  let tempWrittenStat;
  try {
    const descriptor = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | requireOpenFlags(),
      0o600,
    );
    tempCreated = true;
    try {
      tempIdentityStat = fs.fstatSync(descriptor, { bigint: true });
      requireSafeFileStat(tempIdentityStat, {
        maximumBytes: Math.max(MAX_JSON_BYTES, nextBytes.length),
        mode0600: true,
      });
      fs.writeFileSync(descriptor, nextBytes);
      fs.fchmodSync(descriptor, mode0600 ? 0o600 : snapshot.mode);
      fs.fsyncSync(descriptor);
      tempWrittenStat = fs.fstatSync(descriptor, { bigint: true });
      requireSafeFileStat(tempWrittenStat, {
        maximumBytes: Math.max(MAX_JSON_BYTES, nextBytes.length),
        mode0600,
      });
      if (!sameIdentity(tempIdentityStat, tempWrittenStat)
        || tempWrittenStat.size !== BigInt(nextBytes.length)) {
        fail('MIGRATION_FILE_WRITE_FAILED');
      }
    } finally {
      fs.closeSync(descriptor);
    }
    readExactFileIdentity(tempPath, tempWrittenStat, nextBytes, {
      maximumBytes: Math.max(MAX_JSON_BYTES, nextBytes.length),
      mode0600,
    });
    const beforePublish = readSafeFileSnapshot(snapshot.path, {
      maximumBytes: Math.max(MAX_JSON_BYTES, nextBytes.length),
      mode0600,
    });
    const currentDirectory = requireSafeDirectory(directoryPath);
    if (beforePublish.identity !== snapshot.identity
      || beforePublish.sha256 !== snapshot.sha256
      || !sameIdentity(directoryStat, currentDirectory)) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    readExactFileIdentity(tempPath, tempWrittenStat, nextBytes, {
      maximumBytes: Math.max(MAX_JSON_BYTES, nextBytes.length),
      mode0600,
    });
    fs.renameSync(tempPath, snapshot.path);
    tempCreated = false;
    published = true;
    fsyncDirectory(directoryPath);
    const readback = readSafeFileSnapshot(snapshot.path, {
      maximumBytes: Math.max(MAX_JSON_BYTES, nextBytes.length),
      mode0600,
    });
    const finalDirectory = requireSafeDirectory(directoryPath);
    if (!readback.bytes.equals(nextBytes)
      || readback.identity !== `${tempWrittenStat.dev}:${tempWrittenStat.ino}`
      || !sameIdentity(directoryStat, finalDirectory)) {
      fail('MIGRATION_PUBLICATION_UNKNOWN');
    }
    return deepFreeze({ changed: true, sha256: readback.sha256 });
  } catch (error) {
    if (tempCreated) {
      cleanupExactTemporaryFile(tempPath, tempIdentityStat, {
        maximumBytes: Math.max(MAX_JSON_BYTES, nextBytes.length),
        mode0600: false,
      });
    }
    if (published) fail('MIGRATION_PUBLICATION_UNKNOWN', error);
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_FILE_WRITE_FAILED', error);
  }
}

function publishExportArtifact(exportPath, bytes, expectedSha256) {
  requireAbsolutePath(exportPath, 'MIGRATION_EXPORT_PATH_INVALID');
  requireSha256(expectedSha256, 'MIGRATION_EXPORT_INVALID');
  if (!Buffer.isBuffer(bytes) || sha256(bytes) !== expectedSha256) {
    fail('MIGRATION_EXPORT_INVALID');
  }
  const directoryPath = path.dirname(exportPath);
  const directoryStat = requireSafeDirectory(directoryPath);
  try {
    const existing = readSafeFileSnapshot(exportPath, {
      maximumBytes: MAX_JSON_BYTES,
      mode0600: true,
    });
    if (existing.sha256 !== expectedSha256) fail('MIGRATION_EXPORT_CONFLICT');
    return deepFreeze({ changed: false, exportPath, exportSha256: existing.sha256 });
  } catch (error) {
    if (!(error instanceof NotificationAuthorityMigrationError)
      || error.cause?.code !== 'ENOENT') {
      if (error?.code !== 'MIGRATION_FILE_UNSAFE') throw error;
      try {
        fs.lstatSync(exportPath);
        throw error;
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw error;
      }
    }
  }

  const tempPath = path.join(
    directoryPath,
    `.${path.basename(exportPath)}.notification-export-${process.pid}-${randomBytes(12).toString('hex')}.tmp`,
  );
  let tempCreated = false;
  let published = false;
  let tempIdentityStat;
  let tempWrittenStat;
  try {
    const descriptor = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | requireOpenFlags(),
      0o600,
    );
    tempCreated = true;
    try {
      tempIdentityStat = fs.fstatSync(descriptor, { bigint: true });
      requireSafeFileStat(tempIdentityStat, { maximumBytes: MAX_JSON_BYTES, mode0600: true });
      fs.writeFileSync(descriptor, bytes);
      fs.fchmodSync(descriptor, 0o600);
      fs.fsyncSync(descriptor);
      tempWrittenStat = fs.fstatSync(descriptor, { bigint: true });
      requireSafeFileStat(tempWrittenStat, { maximumBytes: MAX_JSON_BYTES, mode0600: true });
      if (!sameIdentity(tempIdentityStat, tempWrittenStat)
        || tempWrittenStat.size !== BigInt(bytes.length)) {
        fail('MIGRATION_EXPORT_WRITE_FAILED');
      }
    } finally {
      fs.closeSync(descriptor);
    }
    readExactFileIdentity(tempPath, tempWrittenStat, bytes, {
      maximumBytes: MAX_JSON_BYTES,
      mode0600: true,
    });
    try {
      fs.lstatSync(exportPath);
      fail('MIGRATION_EXPORT_CONFLICT');
    } catch (error) {
      if (error instanceof NotificationAuthorityMigrationError) throw error;
      if (error?.code !== 'ENOENT') fail('MIGRATION_EXPORT_WRITE_FAILED', error);
    }
    const beforePublishDirectory = requireSafeDirectory(directoryPath);
    if (!sameIdentity(directoryStat, beforePublishDirectory)) {
      fail('MIGRATION_DIRECTORY_UNSAFE');
    }
    readExactFileIdentity(tempPath, tempWrittenStat, bytes, {
      maximumBytes: MAX_JSON_BYTES,
      mode0600: true,
    });
    fs.linkSync(tempPath, exportPath);
    published = true;
    fs.unlinkSync(tempPath);
    tempCreated = false;
    fsyncDirectory(directoryPath);
    const readback = readSafeFileSnapshot(exportPath, {
      maximumBytes: MAX_JSON_BYTES,
      mode0600: true,
    });
    const finalDirectory = requireSafeDirectory(directoryPath);
    if (readback.sha256 !== expectedSha256
      || !readback.bytes.equals(bytes)
      || readback.identity !== `${tempWrittenStat.dev}:${tempWrittenStat.ino}`
      || !sameIdentity(directoryStat, finalDirectory)) {
      fail('MIGRATION_EXPORT_PUBLICATION_UNKNOWN');
    }
    return deepFreeze({ changed: true, exportPath, exportSha256: expectedSha256 });
  } catch (error) {
    if (tempCreated) {
      cleanupExactTemporaryFile(tempPath, tempIdentityStat, {
        maximumBytes: MAX_JSON_BYTES,
        mode0600: true,
      });
    }
    if (published) fail('MIGRATION_EXPORT_PUBLICATION_UNKNOWN', error);
    if (error?.code === 'EEXIST') fail('MIGRATION_EXPORT_CONFLICT', error);
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_EXPORT_WRITE_FAILED', error);
  }
}

function requireExactKeys(value, keys, code) {
  if (!isPlainObject(value)) fail(code);
  const actual = Reflect.ownKeys(value);
  if (actual.some(key => typeof key !== 'string')) fail(code);
  const sorted = [...actual].sort();
  const expected = [...keys].sort();
  if (sorted.length !== expected.length
    || sorted.some((key, index) => key !== expected[index])) fail(code);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
  }
  return value;
}

function parseManifestBytes(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(decodeFatalUtf8(bytes));
  } catch (error) {
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_MANIFEST_INVALID', error);
  }
  requireExactKeys(manifest, [
    'schema',
    'censusSha256',
    'databasePath',
    'dataDir',
    'historicalEnvironmentPaths',
    'paiassInputPath',
    'sources',
    'targets',
    'actions',
    'paiassReceipts',
  ], 'MIGRATION_MANIFEST_INVALID');
  if (manifest.schema !== NOTIFICATION_AUTHORITY_MANIFEST_SCHEMA) {
    fail('MIGRATION_MANIFEST_INVALID');
  }
  requireSha256(manifest.censusSha256, 'MIGRATION_MANIFEST_INVALID');
  requireAbsolutePath(manifest.databasePath, 'MIGRATION_MANIFEST_INVALID');
  requireAbsolutePath(manifest.dataDir, 'MIGRATION_MANIFEST_INVALID');
  normalizeHistoricalEnvironmentPaths(manifest.historicalEnvironmentPaths);
  if (manifest.paiassInputPath !== null) {
    requireAbsolutePath(manifest.paiassInputPath, 'MIGRATION_MANIFEST_INVALID');
  }
  if (!Array.isArray(manifest.sources) || !Array.isArray(manifest.actions)) {
    fail('MIGRATION_MANIFEST_INVALID');
  }
  validateManifestTargets(manifest.targets);
  let previousSourceId = null;
  const parsedSourceMap = new Map();
  for (const source of manifest.sources) {
    const sourceKeys = source?.kind === 'ENV'
      ? [
        'sourceId', 'kind', 'role', 'locator', 'exists', 'identity',
        'preimageSha256', 'postimageSha256', 'foreignBytesSha256', 'revision',
      ]
      : [
        'sourceId', 'kind', 'locator', 'exists', 'identity',
        'preimageSha256', 'postimageSha256', 'revision',
      ];
    requireExactKeys(source, sourceKeys, 'MIGRATION_MANIFEST_INVALID');
    if (!isPlainObject(source)
      || typeof source.sourceId !== 'string'
      || typeof source.kind !== 'string'
      || typeof source.locator !== 'string') fail('MIGRATION_MANIFEST_INVALID');
    if (!['DB', 'SETUP', 'ENV', 'PROCESS_ENV', 'PAIASS_SETTINGS'].includes(source.kind)
      || typeof source.exists !== 'boolean'
      || (source.identity !== null && typeof source.identity !== 'string')) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    if (source.kind === 'PROCESS_ENV') {
      if (source.locator !== 'PROCESS_ENV' || source.sourceId !== 'PROCESS_ENV') {
        fail('MIGRATION_MANIFEST_INVALID');
      }
    } else {
      requireAbsolutePath(source.locator, 'MIGRATION_MANIFEST_INVALID');
    }
    if (source.kind === 'DB') {
      if (!Number.isSafeInteger(source.revision) || source.revision < 1) {
        fail('MIGRATION_MANIFEST_INVALID');
      }
    } else if (source.revision !== null) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    requireSha256(source.preimageSha256, 'MIGRATION_MANIFEST_INVALID');
    requireSha256(source.postimageSha256, 'MIGRATION_MANIFEST_INVALID');
    if (source.kind === 'ENV') {
      requireSha256(source.foreignBytesSha256, 'MIGRATION_MANIFEST_INVALID');
      if (!['ROOT', 'DATA_DIR', 'HISTORICAL'].includes(source.role)) {
        fail('MIGRATION_MANIFEST_INVALID');
      }
    }
    if (previousSourceId !== null && previousSourceId >= source.sourceId) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    previousSourceId = source.sourceId;
    parsedSourceMap.set(source.sourceId, source);
  }
  let previous = null;
  const exportPaths = new Set();
  for (const action of manifest.actions) {
    const numericFinding = action?.classification === 'NUMERIC_SMTP_PORT';
    const numericOverride = numericFinding && action?.action === MIGRATION_ACTION.TRANSFER;
    requireExactKeys(
      action,
      action?.action === MIGRATION_ACTION.EXPORT
        ? [
          'sourceId', 'path', 'valueSha256', 'classification',
          'targetKey', 'action', 'exportPath',
        ]
        : numericOverride
          ? [
            'sourceId', 'path', 'valueSha256', 'classification',
            'targetKey', 'action', 'canonicalValue', 'canonicalValueSha256',
          ]
        : [
          'sourceId', 'path', 'valueSha256', 'classification',
          'targetKey', 'action',
        ],
      'MIGRATION_MANIFEST_INVALID',
    );
    if (!isPlainObject(action)
      || typeof action.sourceId !== 'string'
      || typeof action.path !== 'string'
      || typeof action.classification !== 'string'
      || !Object.values(MIGRATION_ACTION).includes(action.action)) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    const actionSource = parsedSourceMap.get(action.sourceId);
    const allowedPaths = actionSource?.kind === 'DB'
      ? LEGACY_NOTIFICATION_USER_SETTING_PATHS
      : actionSource?.kind === 'SETUP'
        ? SETUP_NOTIFICATION_PATHS
        : actionSource?.kind === 'PAIASS_SETTINGS'
          ? PAIASS_NOTIFICATION_PATHS
          : actionSource?.kind === 'PROCESS_ENV'
            ? LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS
            : actionSource?.kind === 'ENV'
              ? actionSource.role === 'ROOT'
                ? LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS
                : [...NOTIFICATION_ENV_OWNED_KEYS, ...LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS]
              : [];
    if (!allowedPaths.includes(action.path)) fail('MIGRATION_MANIFEST_INVALID');
    requireSha256(action.valueSha256, 'MIGRATION_MANIFEST_INVALID');
    if (![
      'DIRECT_STRING',
      'NUMERIC_SMTP_PORT',
      'UNMAPPABLE',
      'NON_STRING',
    ].includes(action.classification)) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    if (numericFinding) {
      if (actionSource?.kind !== 'DB'
        || action.path !== 'c3.notif.smtpPort'
        || action.targetKey !== 'C3_SMTP_PORT') {
        fail('MIGRATION_MANIFEST_INVALID');
      }
    }
    if (numericOverride) {
      const numericValue = Number(action.canonicalValue);
      if (!Number.isSafeInteger(numericValue)
        || numericValue < 1
        || numericValue > 65535
        || String(numericValue) !== action.canonicalValue
        || requireSha256(action.canonicalValueSha256, 'MIGRATION_MANIFEST_INVALID')
          !== valueSha256(action.canonicalValue)) {
        fail('MIGRATION_MANIFEST_INVALID');
      }
    }
    if ((action.classification === 'DIRECT_STRING' || numericFinding)
      !== NOTIFICATION_ENV_OWNED_KEYS.includes(action.targetKey)) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    if (action.action === MIGRATION_ACTION.TRANSFER
      && (!['DIRECT_STRING', 'NUMERIC_SMTP_PORT'].includes(action.classification)
        || !NOTIFICATION_ENV_OWNED_KEYS.includes(action.targetKey))) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    if (action.action === MIGRATION_ACTION.EXPORT) {
      requireAbsolutePath(action.exportPath, 'MIGRATION_MANIFEST_INVALID');
      if (exportPaths.has(action.exportPath)) fail('MIGRATION_MANIFEST_INVALID');
      exportPaths.add(action.exportPath);
    } else if (Object.hasOwn(action, 'exportPath')) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    const sortKey = `${action.sourceId}\0${action.path}`;
    if (previous !== null && previous >= sortKey) fail('MIGRATION_MANIFEST_INVALID');
    previous = sortKey;
  }
  validateManifestPaiassReceiptPlan(manifest, parsedSourceMap);
  return deepFreeze(manifest);
}

function privateValue(census, action) {
  const state = CENSUS_PRIVATE.get(census);
  const source = state?.allSources.find(candidate => (
    candidate.publicSource.sourceId === action.sourceId
  ));
  if (!source || !source.privateValues.has(action.path)) return undefined;
  return structuredClone(source.privateValues.get(action.path));
}

function transferActionDigest(action) {
  return action.classification === 'NUMERIC_SMTP_PORT'
    ? action.canonicalValueSha256
    : action.valueSha256;
}

function transferDigestMap(manifest) {
  const digests = new Map();
  for (const action of manifest.actions.filter(entry => entry.action === MIGRATION_ACTION.TRANSFER)) {
    const targetDigest = transferActionDigest(action);
    if (digests.has(action.targetKey) && digests.get(action.targetKey) !== targetDigest) {
      fail('MIGRATION_CANONICAL_CONFLICT');
    }
    digests.set(action.targetKey, targetDigest);
  }
  return digests;
}

function validateTargetAuthorityState(manifest, census) {
  const transferDigests = transferDigestMap(manifest);
  for (let index = 0; index < manifest.targets.length; index++) {
    const approved = manifest.targets[index];
    const current = census.targets[index];
    if (!current || current.key !== approved.key
      || current.processPresent !== approved.processPresent
      || current.processValueSha256 !== approved.processValueSha256) {
      fail('MIGRATION_CANONICAL_AMBIENT_SHADOW');
    }
    const transferDigest = transferDigests.get(approved.key);
    if (!transferDigest) {
      if (current.rootPresent !== approved.rootPresent
        || current.rootValueSha256 !== approved.rootValueSha256) {
        fail('MIGRATION_CANONICAL_CONFLICT');
      }
      continue;
    }
    const rootIsApprovedPreimage = current.rootPresent === approved.rootPresent
      && current.rootValueSha256 === approved.rootValueSha256;
    const rootIsApprovedPostimage = current.rootPresent
      && current.rootValueSha256 === transferDigest;
    if (!rootIsApprovedPreimage && !rootIsApprovedPostimage) {
      fail('MIGRATION_CANONICAL_CONFLICT');
    }
  }
}

function validateManifestAgainstCensus(manifest, census) {
  const sourceMap = new Map(census.sources.map(source => [source.sourceId, source]));
  const manifestSourceMap = new Map(manifest.sources.map(source => [source.sourceId, source]));
  if (manifestSourceMap.size !== manifest.sources.length) fail('MIGRATION_MANIFEST_INVALID');
  if (sourceMap.size !== manifestSourceMap.size
    || [...sourceMap.keys()].some(sourceIdValue => !manifestSourceMap.has(sourceIdValue))) {
    fail('MIGRATION_SOURCE_CHANGED');
  }
  const actionMap = new Map(manifest.actions.map(action => [
    `${action.sourceId}\0${action.path}`,
    action,
  ]));
  if (actionMap.size !== manifest.actions.length) fail('MIGRATION_MANIFEST_INVALID');

  let everySourceAtPreimage = true;
  for (const source of manifest.sources) {
    const current = sourceMap.get(source.sourceId);
    if (!current || current.kind !== source.kind || current.locator !== source.locator) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    const exactPreimage = current.preimageSha256 === source.preimageSha256;
    const exactPostimage = current.preimageSha256 === source.postimageSha256;
    const rootEnvIntermediate = source.kind === 'ENV' && source.role === 'ROOT'
      && current.foreignBytesSha256 === source.foreignBytesSha256;
    if (!exactPreimage && !exactPostimage && !rootEnvIntermediate) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    if (!exactPreimage) everySourceAtPreimage = false;
  }
  if (everySourceAtPreimage && census.censusSha256 !== manifest.censusSha256) {
    fail('MIGRATION_SOURCE_CHANGED');
  }
  validateTargetAuthorityState(manifest, census);
  for (const finding of census.findings) {
    const action = actionMap.get(`${finding.sourceId}\0${finding.path}`);
    if (!action || action.valueSha256 !== finding.valueSha256
      || action.classification !== finding.classification
      || action.targetKey !== finding.targetKey) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
  }
  for (const action of manifest.actions) {
    const source = sourceMap.get(action.sourceId);
    const currentFinding = census.findings.find(finding => (
      finding.sourceId === action.sourceId && finding.path === action.path
    ));
    if (!currentFinding && source.preimageSha256 !== manifestSourceMap.get(action.sourceId).postimageSha256) {
      const rootCompleted = source.kind === 'ENV' && source.role === 'ROOT'
        && source.foreignBytesSha256 === manifestSourceMap.get(action.sourceId).foreignBytesSha256;
      if (!rootCompleted) fail('MIGRATION_SOURCE_CHANGED');
    }
  }
  return { actionMap, manifestSourceMap, sourceMap };
}

function ensureExportArtifact(census, action) {
  const value = privateValue(census, action);
  if (value === undefined) {
    const existing = readSafeFileSnapshot(action.exportPath, {
      maximumBytes: MAX_JSON_BYTES,
      mode0600: true,
    });
    if (existing.sha256 !== action.valueSha256) fail('MIGRATION_EXPORT_RECOVERY_REQUIRED');
    return deepFreeze({
      changed: false,
      exportPath: action.exportPath,
      exportSha256: existing.sha256,
      sourceId: action.sourceId,
      path: action.path,
    });
  }
  const bytes = jsonBytes(value);
  if (sha256(bytes) !== action.valueSha256) fail('MIGRATION_SOURCE_CHANGED');
  const published = publishExportArtifact(action.exportPath, bytes, action.valueSha256);
  return deepFreeze({ ...published, sourceId: action.sourceId, path: action.path });
}

function ensureCanonicalTransfers(census, manifest, processEnvironment) {
  const desired = new Map();
  for (const action of manifest.actions.filter(entry => entry.action === MIGRATION_ACTION.TRANSFER)) {
    const sourceValue = privateValue(census, action);
    const targetDigest = transferActionDigest(action);
    let target = desired.get(action.targetKey);
    if (!target) {
      target = { digest: targetDigest, rawValue: undefined };
      desired.set(action.targetKey, target);
    } else if (target.digest !== targetDigest) {
      fail('MIGRATION_CANONICAL_CONFLICT');
    }
    if (sourceValue !== undefined) {
      if (valueSha256(sourceValue) !== action.valueSha256) {
        fail('MIGRATION_SOURCE_CHANGED');
      }
      const targetValue = action.classification === 'NUMERIC_SMTP_PORT'
        ? numericSmtpPort(sourceValue)
        : sourceValue;
      if (typeof targetValue !== 'string'
        || valueSha256(targetValue) !== targetDigest
        || (action.classification === 'NUMERIC_SMTP_PORT'
          && targetValue !== action.canonicalValue)) {
        fail('MIGRATION_SOURCE_CHANGED');
      }
      if (target.rawValue !== undefined && target.rawValue !== targetValue) {
        fail('MIGRATION_CANONICAL_CONFLICT');
      }
      target.rawValue = targetValue;
    }
  }

  const root = readRootEnvironmentFile({
    projectRoot: MODULE_PROJECT_ROOT,
    owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
  });
  const valuesToPatch = {};
  const approvedTargets = new Map(manifest.targets.map(target => [target.key, target]));
  for (const [key, target] of desired) {
    const approved = approvedTargets.get(key);
    const processPresent = Object.hasOwn(processEnvironment, key);
    if (!approved || processPresent !== approved.processPresent) {
      fail('MIGRATION_CANONICAL_AMBIENT_SHADOW');
    }
    if (processPresent) {
      if (typeof processEnvironment[key] !== 'string'
        || valueSha256(processEnvironment[key]) !== target.digest) {
        fail('MIGRATION_CANONICAL_CONFLICT');
      }
      if (root.has(key) && valueSha256(root.value(key)) !== target.digest) {
        fail('MIGRATION_CANONICAL_CONFLICT');
      }
      continue;
    }
    if (root.has(key)) {
      if (valueSha256(root.value(key)) !== target.digest) {
        fail('MIGRATION_CANONICAL_CONFLICT');
      }
      continue;
    }
    if (target.rawValue === undefined) fail('MIGRATION_TRANSFER_RECOVERY_REQUIRED');
    valuesToPatch[key] = target.rawValue;
  }
  let changed = false;
  if (Object.keys(valuesToPatch).length > 0) {
    changed = patchRootEnvironmentFile({
      projectRoot: MODULE_PROJECT_ROOT,
      owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
      values: valuesToPatch,
    }).changed;
  }
  const readback = readRootEnvironmentFile({
    projectRoot: MODULE_PROJECT_ROOT,
    owner: ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
  });
  for (const [key, target] of desired) {
    const processPresent = Object.hasOwn(processEnvironment, key);
    if (processPresent) {
      if (typeof processEnvironment[key] !== 'string'
        || valueSha256(processEnvironment[key]) !== target.digest
        || (readback.has(key) && valueSha256(readback.value(key)) !== target.digest)) {
        fail('MIGRATION_CANONICAL_CONFLICT');
      }
    } else if (!readback.has(key) || valueSha256(readback.value(key)) !== target.digest) {
      fail('MIGRATION_CANONICAL_READBACK_FAILED');
    }
  }
  return deepFreeze({ changed, keys: deepFreeze([...desired.keys()].sort()) });
}

function sourcePrivateState(census, sourceIdValue) {
  const state = CENSUS_PRIVATE.get(census);
  return state?.allSources.find(source => source.publicSource.sourceId === sourceIdValue) || null;
}

function requireSelectedPathsAbsent(manifest, census, source, code) {
  const selectedPaths = new Set(
    manifest.actions
      .filter(action => action.sourceId === source.sourceId)
      .map(action => action.path),
  );
  if (census.findings.some(finding => (
    finding.sourceId === source.sourceId && selectedPaths.has(finding.path)
  ))) {
    fail(code);
  }
}

function scrubDatabaseSource(manifest, census) {
  const source = manifest.sources.find(candidate => candidate.kind === 'DB');
  if (!source) fail('MIGRATION_MANIFEST_INVALID');
  const current = census.sources.find(candidate => candidate.sourceId === source.sourceId);
  if (!current) fail('MIGRATION_SOURCE_CHANGED');
  const pathDigests = manifest.actions
    .filter(action => action.sourceId === source.sourceId)
    .map(action => deepFreeze({ path: action.path, valueSha256: action.valueSha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (pathDigests.length === 0) return deepFreeze({ kind: 'DB', status: 'NO_FINDINGS' });
  if (current.preimageSha256 === source.postimageSha256) {
    requireSelectedPathsAbsent(manifest, census, source, 'MIGRATION_DATABASE_POSTIMAGE_STALE');
    return deepFreeze({ kind: 'DB', status: 'ALREADY_APPLIED' });
  }
  if (current.preimageSha256 !== source.preimageSha256) fail('MIGRATION_SOURCE_CHANGED');
  let db;
  try {
    requireSafeDirectory(path.dirname(manifest.databasePath));
    const beforeOpen = fs.lstatSync(manifest.databasePath, { bigint: true });
    requireSafeFileStat(beforeOpen);
    if (`${beforeOpen.dev}:${beforeOpen.ino}` !== source.identity) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    db = new Database(manifest.databasePath, { fileMustExist: true });
    const afterOpen = fs.lstatSync(manifest.databasePath, { bigint: true });
    requireSafeFileStat(afterOpen);
    if (!sameIdentity(beforeOpen, afterOpen)) fail('MIGRATION_SOURCE_CHANGED');
    const result = db.transaction(() => scrubLegacyNotificationUserSettingsInTransaction(db, {
      expectedRevision: source.revision,
      pathDigests,
      postimageSha256: source.postimageSha256,
      preimageSha256: source.preimageSha256,
    })).immediate();
    return deepFreeze({ kind: 'DB', status: result.status, revision: result.revision });
  } catch (error) {
    fail('MIGRATION_DATABASE_SCRUB_FAILED', error);
  } finally {
    if (db) db.close();
  }
}

function scrubSetupSource(manifest, census) {
  const source = manifest.sources.find(candidate => candidate.kind === 'SETUP');
  if (!source) fail('MIGRATION_MANIFEST_INVALID');
  const current = census.sources.find(candidate => candidate.sourceId === source.sourceId);
  if (!current) fail('MIGRATION_SOURCE_CHANGED');
  const actions = manifest.actions.filter(action => action.sourceId === source.sourceId);
  if (actions.length === 0) return deepFreeze({ kind: 'SETUP', status: 'NO_FINDINGS' });
  if (current.preimageSha256 === source.postimageSha256) {
    requireSelectedPathsAbsent(manifest, census, source, 'MIGRATION_SETUP_POSTIMAGE_STALE');
    return deepFreeze({ kind: 'SETUP', status: 'ALREADY_APPLIED' });
  }
  if (current.preimageSha256 !== source.preimageSha256) fail('MIGRATION_SOURCE_CHANGED');
  const privateSource = sourcePrivateState(census, source.sourceId);
  if (!privateSource?.snapshot?.exists || !privateSource.document) fail('MIGRATION_SOURCE_CHANGED');
  const next = structuredClone(privateSource.document);
  for (const action of actions) {
    const state = getDottedPath(privateSource.document, action.path);
    if (!state.present || valueSha256(state.value) !== action.valueSha256) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    deleteDottedPath(next, action.path);
  }
  const nextBytes = jsonBytes(next);
  if (sha256(nextBytes) !== source.postimageSha256) fail('MIGRATION_POSTIMAGE_MISMATCH');
  const result = atomicReplaceFile(privateSource.snapshot, nextBytes, { mode0600: false });
  return deepFreeze({ kind: 'SETUP', status: result.changed ? 'APPLIED' : 'ALREADY_APPLIED' });
}

function verifyEnvironmentActionValues(environment, actions) {
  for (const action of actions) {
    const value = NOTIFICATION_ENV_OWNED_KEYS.includes(action.path)
      ? environment.canonicalValues.get(action.path)
      : environment.legacyValues.get(action.path);
    const present = NOTIFICATION_ENV_OWNED_KEYS.includes(action.path)
      ? environment.canonicalValues.has(action.path)
      : environment.legacyValues.has(action.path);
    if (!present || valueSha256(value) !== action.valueSha256) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
  }
}

function scrubEnvironmentSource(manifest, source) {
  const actions = manifest.actions.filter(action => action.sourceId === source.sourceId);
  if (actions.length === 0) {
    return deepFreeze({ kind: 'ENV', sourceId: source.sourceId, status: 'NO_FINDINGS' });
  }
  const role = source.role;
  const environment = readEnvironmentSource(source.locator, {
    allowAbsent: role === 'ROOT' || role === 'DATA_DIR',
    kind: 'ENV',
    locator: source.locator,
  });
  const remaining = actions.filter(action => (
    NOTIFICATION_ENV_OWNED_KEYS.includes(action.path)
      ? environment.canonicalValues.has(action.path)
      : environment.legacyValues.has(action.path)
  ));
  if (remaining.length === 0) {
    const foreignSha = sha256(renderExactEnvDeletion(
      environment.snapshot.bytes,
      [...NOTIFICATION_ENV_OWNED_KEYS, ...LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS],
    ));
    if (role !== 'ROOT' && environment.snapshot.sha256 !== source.postimageSha256) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    if (role === 'ROOT' && foreignSha !== source.foreignBytesSha256) {
      fail('MIGRATION_SOURCE_CHANGED');
    }
    return deepFreeze({ kind: 'ENV', sourceId: source.sourceId, status: 'ALREADY_APPLIED' });
  }
  if (remaining.length !== actions.length) fail('MIGRATION_SOURCE_CHANGED');
  verifyEnvironmentActionValues(environment, actions);
  if (role === 'ROOT') {
    if (actions.some(action => !LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS.includes(action.path))) {
      fail('MIGRATION_MANIFEST_INVALID');
    }
    const foreignSha = sha256(renderExactEnvDeletion(
      environment.snapshot.bytes,
      [...NOTIFICATION_ENV_OWNED_KEYS, ...LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS],
    ));
    if (foreignSha !== source.foreignBytesSha256) fail('MIGRATION_SOURCE_CHANGED');
    const result = patchRootEnvironmentFile({
      projectRoot: MODULE_PROJECT_ROOT,
      owner: ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB,
      deleteKeys: actions.map(action => action.path),
    });
    return deepFreeze({
      kind: 'ENV',
      sourceId: source.sourceId,
      status: result.changed ? 'APPLIED' : 'ALREADY_APPLIED',
    });
  }
  if (environment.snapshot.sha256 !== source.preimageSha256) {
    fail('MIGRATION_SOURCE_CHANGED');
  }
  const nextBytes = renderExactEnvDeletion(
    environment.snapshot.bytes,
    actions.map(action => action.path),
  );
  if (sha256(nextBytes) !== source.postimageSha256) fail('MIGRATION_POSTIMAGE_MISMATCH');
  const result = atomicReplaceFile(environment.snapshot, nextBytes, { mode0600: true });
  return deepFreeze({
    kind: 'ENV',
    sourceId: source.sourceId,
    status: result.changed ? 'APPLIED' : 'ALREADY_APPLIED',
  });
}

function resolvePaiassReceipts(manifest, census, exportResults) {
  const source = manifest.sources.find(candidate => candidate.kind === 'PAIASS_SETTINGS');
  if (!source) return deepFreeze({ status: 'NO_SOURCE', receipts: deepFreeze([]) });
  const privateSource = sourcePrivateState(census, source.sourceId);
  if (!privateSource?.snapshot?.exists || !privateSource.document) {
    fail('MIGRATION_SOURCE_CHANGED');
  }
  const actions = manifest.actions
    .filter(action => action.sourceId === source.sourceId)
    .sort((left, right) => left.path.localeCompare(right.path));
  const exportActions = actions.filter(entry => entry.action === MIGRATION_ACTION.EXPORT);
  for (const action of exportActions) {
    const exportResult = exportResults.find(result => (
      result.sourceId === action.sourceId && result.path === action.path
    ));
    if (!exportResult || exportResult.exportSha256 !== action.valueSha256) {
      fail('MIGRATION_EXPORT_RECOVERY_REQUIRED');
    }
  }
  if (privateSource.snapshot.sha256 === source.postimageSha256) {
    requireSelectedPathsAbsent(manifest, census, source, 'MIGRATION_PAIASS_POSTIMAGE_STALE');
    return deepFreeze({
      status: actions.length > 0 ? 'ALREADY_APPLIED' : 'NO_FINDINGS',
      receipts: manifest.paiassReceipts,
    });
  }
  if (privateSource.snapshot.sha256 !== source.preimageSha256) {
    fail('MIGRATION_SOURCE_CHANGED');
  }
  const recomputed = createPaiassReceiptSequence(
    privateSource.snapshot.bytes,
    privateSource.document,
    actions,
  );
  if (!jsonBytes(recomputed).equals(jsonBytes(manifest.paiassReceipts))) {
    fail('MIGRATION_RECEIPT_INVALID');
  }
  return deepFreeze({
    status: recomputed.length > 0 ? 'RECEIPTS_READY' : 'NO_FINDINGS',
    receipts: manifest.paiassReceipts,
  });
}

function createApplyStagePlan(manifest) {
  const plan = [{ kind: 'CANONICAL_TRANSFER' }];
  for (const action of manifest.actions.filter(entry => entry.action === MIGRATION_ACTION.EXPORT)) {
    plan.push({ kind: 'EXPORT', sourceId: action.sourceId, path: action.path });
  }
  plan.push({ kind: 'PROCESS_ENV' });
  for (const kind of ['DB', 'SETUP']) {
    const source = manifest.sources.find(candidate => candidate.kind === kind);
    if (!source) fail('MIGRATION_MANIFEST_INVALID');
    plan.push({ kind, sourceId: source.sourceId });
  }
  for (const source of manifest.sources.filter(candidate => candidate.kind === 'ENV')) {
    plan.push({ kind: 'ENV', sourceId: source.sourceId });
  }
  const paiass = manifest.sources.find(candidate => candidate.kind === 'PAIASS_SETTINGS');
  plan.push({
    kind: 'PAIASS_RECEIPTS',
    ...(paiass ? { sourceId: paiass.sourceId } : {}),
  });
  return deepFreeze(plan);
}

function appendStageEvent(ledger, descriptor, status, metadata = {}) {
  const event = deepFreeze({
    sequence: ledger.length + 1,
    ...descriptor,
    status,
    ...metadata,
  });
  ledger.push(event);
  return event;
}

function createApplyReport({
  status,
  stagePlan,
  ledger,
  remainingStart,
  transfers,
  exports,
  receipts,
  paiassStatus,
}) {
  return deepFreeze({
    schema: 'INTENTSMITH_NOTIFICATION_AUTHORITY_APPLY_REPORT/V1',
    status,
    transfers,
    exports: deepFreeze([...exports]),
    stages: deepFreeze([...ledger]),
    remainingStages: deepFreeze(stagePlan.slice(remainingStart)),
    receipts,
    paiassStatus,
  });
}

function applyFailureStatus(error) {
  return typeof error?.code === 'string' && error.code.includes('PUBLICATION_UNKNOWN')
    ? 'PUBLICATION_UNKNOWN'
    : 'FAILED';
}

function throwApplyStageFailure(error, context, stageIndex) {
  const descriptor = context.stagePlan[stageIndex];
  appendStageEvent(context.ledger, descriptor, applyFailureStatus(error));
  const report = createApplyReport({
    status: 'FAILED',
    stagePlan: context.stagePlan,
    ledger: context.ledger,
    remainingStart: stageIndex,
    transfers: context.transfers,
    exports: context.exports,
    receipts: context.receipts,
    paiassStatus: context.paiassStatus,
  });
  const code = typeof error?.code === 'string'
    ? error.code
    : 'MIGRATION_UNEXPECTED_FAILURE';
  throw new NotificationAuthorityMigrationError(code, { cause: error, report });
}

export function applyNotificationAuthorityManifest({
  manifestPath,
  manifestSha256,
  attestServerStopped,
  attestWorkersStopped,
  expectedDatabasePath,
  expectedDataDir,
  expectedHistoricalEnvironmentPaths = [],
  expectedPaiassInputPath = null,
} = {}) {
  if (attestServerStopped !== true || attestWorkersStopped !== true) {
    fail('MIGRATION_QUIESCENCE_ATTESTATION_REQUIRED');
  }
  requireAbsolutePath(manifestPath, 'MIGRATION_MANIFEST_PATH_INVALID');
  requireSha256(manifestSha256, 'MIGRATION_MANIFEST_SHA256_INVALID');
  const manifestSnapshot = readSafeFileSnapshot(manifestPath, {
    maximumBytes: MAX_JSON_BYTES,
    mode0600: true,
  });
  if (manifestSnapshot.sha256 !== manifestSha256) fail('MIGRATION_MANIFEST_DIGEST_MISMATCH');
  const manifest = parseManifestBytes(manifestSnapshot.bytes);
  if (manifest.databasePath !== expectedDatabasePath
    || manifest.dataDir !== expectedDataDir
    || JSON.stringify(manifest.historicalEnvironmentPaths)
      !== JSON.stringify(expectedHistoricalEnvironmentPaths)
    || manifest.paiassInputPath !== expectedPaiassInputPath) {
    fail('MIGRATION_MANIFEST_PATH_MISMATCH');
  }
  const protectedInputPaths = new Set([
    manifestPath,
    manifest.databasePath,
    path.join(manifest.dataDir, 'c3-setup.json'),
    path.join(manifest.dataDir, '.env'),
    path.join(MODULE_PROJECT_ROOT, '.env'),
    ...manifest.historicalEnvironmentPaths,
    ...(manifest.paiassInputPath === null ? [] : [manifest.paiassInputPath]),
  ]);
  if (manifest.actions.some(action => (
    action.action === MIGRATION_ACTION.EXPORT && protectedInputPaths.has(action.exportPath)
  ))) {
    fail('MIGRATION_EXPORT_PATH_INVALID');
  }
  const census = censusNotificationAuthority({
    databasePath: manifest.databasePath,
    dataDir: manifest.dataDir,
    historicalEnvironmentPaths: manifest.historicalEnvironmentPaths,
    paiassInputPath: manifest.paiassInputPath,
    processEnvironment: process.env,
  });
  validateManifestAgainstCensus(manifest, census);

  const stagePlan = createApplyStagePlan(manifest);
  const context = {
    stagePlan,
    ledger: [],
    transfers: null,
    exports: [],
    receipts: deepFreeze([]),
    paiassStatus: 'PENDING',
  };
  let stageIndex = 0;
  try {
    context.transfers = ensureCanonicalTransfers(census, manifest, process.env);
    appendStageEvent(
      context.ledger,
      stagePlan[stageIndex],
      context.transfers.keys.length === 0
        ? 'NO_FINDINGS'
        : context.transfers.changed ? 'APPLIED' : 'ALREADY_APPLIED',
      { changed: context.transfers.changed, keys: context.transfers.keys },
    );
    stageIndex += 1;
  } catch (error) {
    throwApplyStageFailure(error, context, stageIndex);
  }

  const exportActions = manifest.actions.filter(entry => entry.action === MIGRATION_ACTION.EXPORT);
  for (const action of exportActions) {
    try {
      const result = ensureExportArtifact(census, action);
      context.exports.push(result);
      appendStageEvent(
        context.ledger,
        stagePlan[stageIndex],
        result.changed ? 'APPLIED' : 'ALREADY_APPLIED',
        {
          changed: result.changed,
          exportPath: result.exportPath,
          exportSha256: result.exportSha256,
        },
      );
      stageIndex += 1;
    } catch (error) {
      throwApplyStageFailure(error, context, stageIndex);
    }
  }

  const processActions = manifest.actions.filter(action => action.sourceId === 'PROCESS_ENV');
  const processStillPresent = processActions.some(action => Object.hasOwn(process.env, action.path));
  if (processStillPresent) {
    appendStageEvent(context.ledger, stagePlan[stageIndex], 'BLOCKED_RESTART_REQUIRED');
    return createApplyReport({
      status: 'BLOCKED_RESTART_REQUIRED',
      stagePlan,
      ledger: context.ledger,
      remainingStart: stageIndex,
      transfers: context.transfers,
      exports: context.exports,
      receipts: context.receipts,
      paiassStatus: 'PENDING',
    });
  }
  appendStageEvent(context.ledger, stagePlan[stageIndex], 'ABSENCE_CONFIRMED');
  stageIndex += 1;

  try {
    const result = scrubDatabaseSource(manifest, census);
    appendStageEvent(
      context.ledger,
      stagePlan[stageIndex],
      result.status,
      result.revision === undefined ? {} : { revision: result.revision },
    );
    stageIndex += 1;
  } catch (error) {
    throwApplyStageFailure(error, context, stageIndex);
  }

  try {
    const result = scrubSetupSource(manifest, census);
    appendStageEvent(context.ledger, stagePlan[stageIndex], result.status);
    stageIndex += 1;
  } catch (error) {
    throwApplyStageFailure(error, context, stageIndex);
  }

  for (const source of manifest.sources.filter(candidate => candidate.kind === 'ENV')) {
    try {
      const result = scrubEnvironmentSource(manifest, source);
      appendStageEvent(context.ledger, stagePlan[stageIndex], result.status);
      stageIndex += 1;
    } catch (error) {
      throwApplyStageFailure(error, context, stageIndex);
    }
  }

  try {
    const paiass = resolvePaiassReceipts(manifest, census, context.exports);
    context.receipts = paiass.receipts;
    context.paiassStatus = paiass.status;
    appendStageEvent(context.ledger, stagePlan[stageIndex], paiass.status);
    stageIndex += 1;
  } catch (error) {
    throwApplyStageFailure(error, context, stageIndex);
  }

  return createApplyReport({
    status: context.paiassStatus === 'RECEIPTS_READY' ? 'RECEIPTS_READY' : 'APPLIED',
    stagePlan,
    ledger: context.ledger,
    remainingStart: stagePlan.length,
    transfers: context.transfers,
    exports: context.exports,
    receipts: context.receipts,
    paiassStatus: context.paiassStatus,
  });
}

function parseDecisionsBytes(bytes) {
  let decisions;
  try {
    decisions = JSON.parse(decodeFatalUtf8(bytes));
  } catch (error) {
    if (error instanceof NotificationAuthorityMigrationError) throw error;
    fail('MIGRATION_DECISIONS_INVALID', error);
  }
  requireExactKeys(
    decisions,
    ['schema', 'censusSha256', 'actions'],
    'MIGRATION_DECISIONS_INVALID',
  );
  if (decisions.schema !== NOTIFICATION_AUTHORITY_DECISIONS_SCHEMA
    || !Array.isArray(decisions.actions)) {
    fail('MIGRATION_DECISIONS_INVALID');
  }
  requireSha256(decisions.censusSha256, 'MIGRATION_DECISIONS_INVALID');
  let previous = null;
  for (const action of decisions.actions) {
    exactActionSelection(action);
    const sortKey = `${action.sourceId}\0${action.path}`;
    if (previous !== null && previous >= sortKey) fail('MIGRATION_DECISIONS_INVALID');
    previous = sortKey;
  }
  return deepFreeze(decisions);
}

export function finalizeNotificationAuthorityPlan({
  decisionsPath,
  decisionsSha256,
  manifestPath,
  databasePath,
  dataDir,
  historicalEnvironmentPaths = [],
  paiassInputPath = null,
  processEnvironment = process.env,
} = {}) {
  requireAbsolutePath(decisionsPath, 'MIGRATION_DECISIONS_PATH_INVALID');
  requireSha256(decisionsSha256, 'MIGRATION_DECISIONS_SHA256_INVALID');
  requireAbsolutePath(manifestPath, 'MIGRATION_MANIFEST_PATH_INVALID');
  const decisionsSnapshot = readSafeFileSnapshot(decisionsPath, {
    maximumBytes: MAX_JSON_BYTES,
    mode0600: true,
  });
  if (decisionsSnapshot.sha256 !== decisionsSha256) {
    fail('MIGRATION_DECISIONS_DIGEST_MISMATCH');
  }
  const decisions = parseDecisionsBytes(decisionsSnapshot.bytes);
  const census = censusNotificationAuthority({
    databasePath,
    dataDir,
    historicalEnvironmentPaths,
    paiassInputPath,
    processEnvironment,
  });
  if (decisions.censusSha256 !== census.censusSha256) fail('MIGRATION_CENSUS_DRIFT');
  const manifest = createNotificationAuthorityManifest(census, decisions.actions);
  const protectedPaths = new Set([
    decisionsPath,
    databasePath,
    path.join(dataDir, 'c3-setup.json'),
    path.join(dataDir, '.env'),
    path.join(MODULE_PROJECT_ROOT, '.env'),
    ...historicalEnvironmentPaths,
    ...(paiassInputPath === null ? [] : [paiassInputPath]),
  ]);
  if (protectedPaths.has(manifestPath)
    || manifest.actions.some(action => (
      action.action === MIGRATION_ACTION.EXPORT
      && (protectedPaths.has(action.exportPath) || action.exportPath === manifestPath)
    ))) {
    fail('MIGRATION_MANIFEST_PATH_INVALID');
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const manifestSha256 = sha256(manifestBytes);
  publishExportArtifact(manifestPath, manifestBytes, manifestSha256);
  const actionCounts = Object.freeze({
    TRANSFER: manifest.actions.filter(action => action.action === MIGRATION_ACTION.TRANSFER).length,
    EXPORT: manifest.actions.filter(action => action.action === MIGRATION_ACTION.EXPORT).length,
    PURGE: manifest.actions.filter(action => action.action === MIGRATION_ACTION.PURGE).length,
  });
  return deepFreeze({
    schema: NOTIFICATION_AUTHORITY_PLAN_REPORT_SCHEMA,
    status: 'MANIFEST_READY',
    censusSha256: census.censusSha256,
    decisionsSha256,
    manifestPath,
    manifestSha256,
    actionCounts,
    receiptCount: manifest.paiassReceipts.length,
  });
}

function takeArgument(argv, index, code) {
  if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) fail(code);
  return argv[index + 1];
}

export function parseMigrationCliArguments(argv) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== 'string')) {
    fail('MIGRATION_CLI_INVALID');
  }
  const options = {
    mode: null,
    databasePath: null,
    dataDir: null,
    historicalEnvironmentPaths: [],
    paiassInputPath: null,
    manifestPath: null,
    manifestSha256: null,
    decisionsPath: null,
    decisionsSha256: null,
    attestServerStopped: false,
    attestWorkersStopped: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--census' || argument === '--plan' || argument === '--apply') {
      if (options.mode !== null) fail('MIGRATION_CLI_INVALID');
      options.mode = argument.slice(2).toUpperCase();
      continue;
    }
    if (argument === '--attest-server-stopped') {
      if (options.attestServerStopped) fail('MIGRATION_CLI_INVALID');
      options.attestServerStopped = true;
      continue;
    }
    if (argument === '--attest-workers-stopped') {
      if (options.attestWorkersStopped) fail('MIGRATION_CLI_INVALID');
      options.attestWorkersStopped = true;
      continue;
    }
    const flagMap = {
      '--db': 'databasePath',
      '--data-dir': 'dataDir',
      '--paiass-input': 'paiassInputPath',
      '--manifest': 'manifestPath',
      '--manifest-sha256': 'manifestSha256',
      '--decisions': 'decisionsPath',
      '--decisions-sha256': 'decisionsSha256',
    };
    if (argument === '--historical-env') {
      const value = takeArgument(argv, index, 'MIGRATION_CLI_INVALID');
      options.historicalEnvironmentPaths.push(value);
      index += 1;
      continue;
    }
    const field = flagMap[argument];
    if (!field || options[field] !== null) fail('MIGRATION_CLI_INVALID');
    options[field] = takeArgument(argv, index, 'MIGRATION_CLI_INVALID');
    index += 1;
  }
  if (!options.mode || !options.databasePath || !options.dataDir) fail('MIGRATION_CLI_INVALID');
  requireAbsolutePath(options.databasePath, 'MIGRATION_DATABASE_PATH_INVALID');
  requireAbsolutePath(options.dataDir, 'MIGRATION_DATA_DIR_INVALID');
  options.historicalEnvironmentPaths = normalizeHistoricalEnvironmentPaths(
    options.historicalEnvironmentPaths,
  );
  if (options.paiassInputPath !== null) {
    requireAbsolutePath(options.paiassInputPath, 'MIGRATION_PAIASS_PATH_INVALID');
  }
  if (options.mode === 'CENSUS') {
    if (options.manifestPath !== null || options.manifestSha256 !== null
      || options.decisionsPath !== null || options.decisionsSha256 !== null
      || options.attestServerStopped || options.attestWorkersStopped) {
      fail('MIGRATION_CLI_INVALID');
    }
  } else if (options.mode === 'PLAN') {
    if (!options.manifestPath || !options.decisionsPath || !options.decisionsSha256
      || options.manifestSha256 !== null
      || options.attestServerStopped || options.attestWorkersStopped) {
      fail('MIGRATION_CLI_INVALID');
    }
    requireAbsolutePath(options.manifestPath, 'MIGRATION_MANIFEST_PATH_INVALID');
    requireAbsolutePath(options.decisionsPath, 'MIGRATION_DECISIONS_PATH_INVALID');
    requireSha256(options.decisionsSha256, 'MIGRATION_DECISIONS_SHA256_INVALID');
  } else {
    if (!options.manifestPath || !options.manifestSha256
      || options.decisionsPath !== null || options.decisionsSha256 !== null
      || !options.attestServerStopped || !options.attestWorkersStopped) {
      fail('MIGRATION_QUIESCENCE_ATTESTATION_REQUIRED');
    }
    requireAbsolutePath(options.manifestPath, 'MIGRATION_MANIFEST_PATH_INVALID');
    requireSha256(options.manifestSha256, 'MIGRATION_MANIFEST_SHA256_INVALID');
  }
  return deepFreeze(options);
}

export function runNotificationAuthorityMigration(options) {
  if (options.mode === 'CENSUS') {
    return censusNotificationAuthority({
      databasePath: options.databasePath,
      dataDir: options.dataDir,
      historicalEnvironmentPaths: options.historicalEnvironmentPaths,
      paiassInputPath: options.paiassInputPath,
    });
  }
  if (options.mode === 'PLAN') {
    return finalizeNotificationAuthorityPlan({
      decisionsPath: options.decisionsPath,
      decisionsSha256: options.decisionsSha256,
      manifestPath: options.manifestPath,
      databasePath: options.databasePath,
      dataDir: options.dataDir,
      historicalEnvironmentPaths: options.historicalEnvironmentPaths,
      paiassInputPath: options.paiassInputPath,
    });
  }
  return applyNotificationAuthorityManifest({
    manifestPath: options.manifestPath,
    manifestSha256: options.manifestSha256,
    attestServerStopped: options.attestServerStopped,
    attestWorkersStopped: options.attestWorkersStopped,
    expectedDatabasePath: options.databasePath,
    expectedDataDir: options.dataDir,
    expectedHistoricalEnvironmentPaths: options.historicalEnvironmentPaths,
    expectedPaiassInputPath: options.paiassInputPath,
  });
}

export function main(argv = process.argv.slice(2)) {
  const options = parseMigrationCliArguments(argv);
  const result = runNotificationAuthorityMigration(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    main();
  } catch (error) {
    const code = error instanceof NotificationAuthorityMigrationError
      ? error.code
      : 'MIGRATION_UNEXPECTED_FAILURE';
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code,
      ...(error instanceof NotificationAuthorityMigrationError && error.report
        ? { report: error.report }
        : {}),
    })}\n`);
    process.exitCode = 1;
  }
}
