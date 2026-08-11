// Canonical project-root .env authority.
//
// This module is the only synchronous filesystem seam allowed to read or
// patch the install-root .env. Callers select one hard-coded owner; they cannot
// supply an arbitrary key allowlist.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse as parseDotenv } from 'dotenv';

export const SETUP_ENV_TARGET_OUT_OF_SCOPE = 'SETUP_ENV_TARGET_OUT_OF_SCOPE';
export const SETUP_ENV_TARGET_UNSAFE = 'SETUP_ENV_TARGET_UNSAFE';
export const SETUP_ENV_DUPLICATE_OWNED_KEY = 'SETUP_ENV_DUPLICATE_OWNED_KEY';
export const SETUP_ENV_VALUE_INVALID = 'SETUP_ENV_VALUE_INVALID';
export const SETUP_ENV_WRITE_FAILED = 'SETUP_ENV_WRITE_FAILED';
export const SETUP_ENV_PUBLICATION_UNKNOWN = 'SETUP_ENV_PUBLICATION_UNKNOWN';

export const ROOT_ENVIRONMENT_MAX_BYTES = 1024 * 1024;

export const SETUP_ENV_OWNED_KEYS = Object.freeze([
  'OLLAMA_URL',
  'C3_LANG',
  'C3_DB_PATH',
  'C3_LICENSE_KEY',
]);

export const NOTIFICATION_ENV_OWNED_KEYS = Object.freeze([
  'C3_SMTP_HOST',
  'C3_SMTP_PORT',
  'C3_SMTP_USER',
  'C3_SMTP_PASS',
  'C3_SMTP_FROM',
  'C3_TELEGRAM_BOT_TOKEN',
  'C3_TELEGRAM_CHAT_ID',
  'C3_NTFY_SERVER',
  'C3_NTFY_TOPIC',
  'C3_NTFY_TOKEN',
  'C3_WEBHOOK_URL',
  'C3_WEBHOOK_SECRET',
]);

export const LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS = Object.freeze([
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'NTFY_SERVER',
  'NTFY_TOPIC',
  'EMAIL_FROM',
  'SMTP_URL',
  'EMAIL_TO',
  'C3_NTFY_URL',
]);

export const ROOT_ENVIRONMENT_OWNER = Object.freeze({
  SETUP: 'SETUP',
  NOTIFICATION: 'NOTIFICATION',
  LEGACY_NOTIFICATION_SCRUB: 'LEGACY_NOTIFICATION_SCRUB',
});

const OWNER_RULES = new Map([
  [ROOT_ENVIRONMENT_OWNER.SETUP, Object.freeze({
    keys: SETUP_ENV_OWNED_KEYS,
    exactSet: true,
    deleteOnly: false,
  })],
  [ROOT_ENVIRONMENT_OWNER.NOTIFICATION, Object.freeze({
    keys: NOTIFICATION_ENV_OWNED_KEYS,
    exactSet: false,
    deleteOnly: false,
  })],
  [ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB, Object.freeze({
    keys: LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS,
    exactSet: false,
    deleteOnly: true,
  })],
]);

const OWNER_KEY_SETS = new Map(
  [...OWNER_RULES].map(([owner, rule]) => [owner, new Set(rule.keys)]),
);
const NON_AMBIENT_NOTIFICATION_KEY_SET = new Set([
  ...NOTIFICATION_ENV_OWNED_KEYS,
  ...LEGACY_NOTIFICATION_ENV_DELETE_ONLY_KEYS,
]);
const ENV_ASSIGNMENT_PATTERN = /^(\uFEFF?[^\S\r\n]*(?:export[^\S\r\n]+)?)([\w.-]+)(?:[^\S\r\n]*=[^\S\r\n]*|:[^\S\r\n]+)/u;
// Structurally mirrors dotenv@17.3.1's assignment matcher, with captures
// around spans that must never cross a physical CR/LF record.
const DOTENV_ASSIGNMENT_SPAN_PATTERN = /^(\s*)(?:export(\s+))?([\w.-]+)(\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?$/gm;
const READ_CHUNK_BYTES = 64 * 1024;
const brandedRootEnvironmentReads = new WeakSet();
const brandedRootEnvironmentBootstraps = new WeakSet();

export class RootEnvironmentFileError extends Error {
  constructor(code) {
    super(code);
    // Preserve the P0 externally observable error identity while moving the
    // implementation behind the shared authority seam.
    this.name = 'SetupEnvironmentError';
    this.code = code;
  }
}

export const SetupEnvironmentError = RootEnvironmentFileError;

function rootEnvironmentError(code) {
  return new RootEnvironmentFileError(code);
}

function currentUid() {
  if (typeof process.geteuid !== 'function') {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  return BigInt(process.geteuid());
}

function numericStatField(value) {
  return typeof value === 'bigint' ? value : BigInt(value);
}

export function requireSafeRootEnvironmentTarget(stat, expectedUid = currentUid()) {
  let ownerMatches = false;
  let singleLink = false;
  let exactMode = false;
  let boundedSize = true;
  try {
    const normalizedExpectedUid = numericStatField(expectedUid);
    ownerMatches = numericStatField(stat?.uid) === normalizedExpectedUid;
    singleLink = numericStatField(stat?.nlink) === 1n;
    exactMode = (numericStatField(stat?.mode) & 0o7777n) === 0o600n;
    if (stat?.size !== undefined) {
      const size = numericStatField(stat.size);
      boundedSize = size >= 0n && size <= BigInt(ROOT_ENVIRONMENT_MAX_BYTES);
    }
  } catch {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  const isRegular = stat && typeof stat.isFile === 'function' && stat.isFile();
  const isSymlink = typeof stat?.isSymbolicLink === 'function' && stat.isSymbolicLink();
  if (!isRegular || isSymlink || !ownerMatches || !singleLink || !exactMode || !boundedSize) {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  return stat;
}

function requireSafeOpenFlags() {
  const { O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  if (!Number.isInteger(O_NOFOLLOW) || O_NOFOLLOW === 0
    || !Number.isInteger(O_NONBLOCK) || O_NONBLOCK === 0) {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  return O_NOFOLLOW | O_NONBLOCK;
}

function requireOwnerRule(owner) {
  const rule = OWNER_RULES.get(owner);
  if (!rule) throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
  return rule;
}

export function requireCanonicalRootEnvironmentProjectRoot(projectRoot) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)
    || path.resolve(projectRoot) !== projectRoot) {
    throw rootEnvironmentError(SETUP_ENV_TARGET_OUT_OF_SCOPE);
  }
  return projectRoot;
}

function requireOwnedCanonicalDirectory(directoryPath) {
  try {
    const stat = fs.lstatSync(directoryPath, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()
      || stat.uid !== currentUid()
      || fs.realpathSync(directoryPath) !== directoryPath) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
    return stat;
  } catch (error) {
    if (error instanceof RootEnvironmentFileError) throw error;
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
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

function recheckCanonicalDirectory(directoryPath, snapshot) {
  try {
    const current = fs.lstatSync(directoryPath, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink()
      || current.uid !== currentUid()
      || !sameFileIdentity(current, snapshot)
      || fs.realpathSync(directoryPath) !== directoryPath) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
  } catch (error) {
    if (error instanceof RootEnvironmentFileError) throw error;
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function readBounded(descriptor) {
  const chunks = [];
  let total = 0;
  while (total <= ROOT_ENVIRONMENT_MAX_BYTES) {
    const remaining = (ROOT_ENVIRONMENT_MAX_BYTES + 1) - total;
    if (remaining === 0) break;
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
  }
  if (total > ROOT_ENVIRONMENT_MAX_BYTES) {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  return Buffer.concat(chunks, total);
}

function splitLinesWithEndings(text) {
  const lines = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\r' && text[index] !== '\n') continue;
    const end = text[index] === '\r' && text[index + 1] === '\n'
      ? index + 2
      : index + 1;
    lines.push(text.slice(start, end));
    start = end;
    if (end === index + 2) index += 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function envLineEnding(line) {
  if (line.endsWith('\r\n')) return '\r\n';
  if (line.endsWith('\n')) return '\n';
  return line.endsWith('\r') ? '\r' : '';
}

function stripEnvLineEnding(line) {
  if (line.endsWith('\r\n')) return line.slice(0, -2);
  if (line.endsWith('\r') || line.endsWith('\n')) return line.slice(0, -1);
  return line;
}

function assertNoMultilineDotenvAssignments(lines) {
  for (const line of lines) {
    const content = stripEnvLineEnding(line);
    const match = ENV_ASSIGNMENT_PATTERN.exec(content);
    if (!match) continue;
    const quote = content[match[0].length];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    let closed = false;
    for (let index = match[0].length + 1; index < content.length; index++) {
      if (content[index] === quote && content[index - 1] !== '\\') {
        closed = true;
        break;
      }
    }
    if (!closed) throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function assertNoCrossLineDotenvAssignments(text) {
  // JavaScript multiline anchors, and therefore dotenv's pinned parser, treat
  // U+2028/U+2029 as line terminators. This writer preserves CR/LF records, so
  // a second parser-visible record authority must fail closed.
  if (/[\0\u2028\u2029]/u.test(text)) {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  const normalized = text.replace(/\r\n?/g, '\n');
  DOTENV_ASSIGNMENT_SPAN_PATTERN.lastIndex = 0;
  let match;
  while ((match = DOTENV_ASSIGNMENT_SPAN_PATTERN.exec(normalized)) !== null) {
    const crossLineSpan = [match[2], match[4], match[5]]
      .some(value => typeof value === 'string' && value.includes('\n'));
    if (crossLineSpan) throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function decodeEnvironment(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > ROOT_ENVIRONMENT_MAX_BYTES) {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function parseEnvironment(bytes) {
  try {
    const parsed = parseDotenv(bytes);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
    return parsed;
  } catch (error) {
    if (error instanceof RootEnvironmentFileError) throw error;
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function inspectEnvironment(bytes, owner) {
  const text = decodeEnvironment(bytes);
  const lines = splitLinesWithEndings(text);
  assertNoCrossLineDotenvAssignments(text);
  assertNoMultilineDotenvAssignments(lines);

  const ownedKeySet = OWNER_KEY_SETS.get(owner);
  const ownedIndexes = new Map();
  for (let index = 0; index < lines.length; index++) {
    const content = stripEnvLineEnding(lines[index]);
    const match = ENV_ASSIGNMENT_PATTERN.exec(content);
    if (!match || !ownedKeySet.has(match[2])) continue;
    if (ownedIndexes.has(match[2])) {
      throw rootEnvironmentError(SETUP_ENV_DUPLICATE_OWNED_KEY);
    }
    ownedIndexes.set(match[2], index);
  }

  const parsed = parseEnvironment(bytes);
  for (const key of OWNER_RULES.get(owner).keys) {
    const physicallyPresent = ownedIndexes.has(key);
    const parsedPresent = Object.hasOwn(parsed, key);
    if (physicallyPresent !== parsedPresent
      || (parsedPresent && (typeof parsed[key] !== 'string'
        || /[\r\n\0\u2028\u2029]/u.test(parsed[key])))) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
  }

  return Object.freeze({
    lines: Object.freeze(lines),
    ownedIndexes,
    parsed,
  });
}

function readSafeExistingTarget(targetPath, directoryPath, directorySnapshot, owner) {
  let pathStat;
  try {
    pathStat = fs.lstatSync(targetPath, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      recheckCanonicalDirectory(directoryPath, directorySnapshot);
      return null;
    }
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  requireSafeRootEnvironmentTarget(pathStat);

  let descriptor;
  try {
    descriptor = fs.openSync(
      targetPath,
      fs.constants.O_RDONLY | requireSafeOpenFlags(),
    );
    const openedStat = fs.fstatSync(descriptor, { bigint: true });
    requireSafeRootEnvironmentTarget(openedStat);
    if (!sameStableFile(pathStat, openedStat)) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }

    const bytes = readBounded(descriptor);
    const afterReadStat = fs.fstatSync(descriptor, { bigint: true });
    requireSafeRootEnvironmentTarget(afterReadStat);
    if (!sameStableFile(openedStat, afterReadStat)
      || afterReadStat.size !== BigInt(bytes.length)) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }

    const finalPathStat = fs.lstatSync(targetPath, { bigint: true });
    requireSafeRootEnvironmentTarget(finalPathStat);
    if (!sameStableFile(afterReadStat, finalPathStat)) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
    recheckCanonicalDirectory(directoryPath, directorySnapshot);
    const inspected = inspectEnvironment(bytes, owner);
    return Object.freeze({
      bytes,
      dev: afterReadStat.dev,
      ino: afterReadStat.ino,
      size: afterReadStat.size,
      mtimeNs: afterReadStat.mtimeNs,
      ctimeNs: afterReadStat.ctimeNs,
      parsed: inspected.parsed,
    });
  } catch (error) {
    if (error instanceof RootEnvironmentFileError) throw error;
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
      }
    }
  }
}

function recheckExistingTarget(targetPath, snapshot) {
  try {
    const stat = fs.lstatSync(targetPath, { bigint: true });
    requireSafeRootEnvironmentTarget(stat);
    if (!sameStableFile(stat, snapshot)) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
  } catch (error) {
    if (error instanceof RootEnvironmentFileError) throw error;
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
}

function requireRecord(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function normalizeMutation(owner, values, deleteKeys) {
  const rule = requireOwnerRule(owner);
  const ownedKeySet = OWNER_KEY_SETS.get(owner);
  const providedValues = values === undefined ? Object.create(null) : values;
  const providedDeletes = deleteKeys === undefined ? [] : deleteKeys;
  if (!requireRecord(providedValues)
    || Reflect.ownKeys(providedValues).some(key => typeof key !== 'string')
    || !Array.isArray(providedDeletes)
    || providedDeletes.some(key => typeof key !== 'string')) {
    throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
  }

  const valueKeys = Object.keys(providedValues);
  if (valueKeys.some(key => !ownedKeySet.has(key))
    || providedDeletes.some(key => !ownedKeySet.has(key))
    || new Set(providedDeletes).size !== providedDeletes.length) {
    throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
  }

  if (rule.deleteOnly) {
    if (valueKeys.length !== 0 || providedDeletes.length === 0) {
      throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
    }
  } else {
    if (providedDeletes.length !== 0
      || (rule.exactSet
        ? valueKeys.length !== rule.keys.length
          || rule.keys.some(key => !Object.hasOwn(providedValues, key))
        : valueKeys.length === 0)) {
      throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
    }
  }

  const setValues = new Map();
  const deletedKeys = new Set(providedDeletes);
  for (const key of rule.keys) {
    if (!Object.hasOwn(providedValues, key)) continue;
    const value = providedValues[key];
    if (typeof value !== 'string' || /[\r\n\0\u2028\u2029]/u.test(value)) {
      throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
    }
    if (owner === ROOT_ENVIRONMENT_OWNER.SETUP
      && key === 'C3_LICENSE_KEY'
      && value === '') {
      deletedKeys.add(key);
    } else {
      setValues.set(key, value);
    }
  }

  return Object.freeze({
    rule,
    setValues,
    deletedKeys,
  });
}

function encodeEnvValue(value) {
  const candidates = [];
  if (value.trim() === value && !value.includes('#')) candidates.push(value);
  if (!value.includes("'")) candidates.push(`'${value}'`);
  if (!value.includes('`')) candidates.push(`\`${value}\``);
  if (!value.includes('"')) candidates.push(`"${value}"`);

  for (const candidate of candidates) {
    const parsed = parseEnvironment(Buffer.from(`C3_ROOT_ENV_VALUE=${candidate}\n`, 'utf8'));
    if (parsed.C3_ROOT_ENV_VALUE === value) return candidate;
  }
  throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
}

function assertRenderedEnvironment(existingBytes, nextBytes, setValues, deletedKeys) {
  const before = parseEnvironment(existingBytes);
  const after = parseEnvironment(nextBytes);
  const parsedKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of parsedKeys) {
    if (setValues.has(key)) {
      if (!Object.hasOwn(after, key) || after[key] !== setValues.get(key)) {
        throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
      }
      continue;
    }
    if (deletedKeys.has(key)) {
      if (Object.hasOwn(after, key)) {
        throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
      }
      continue;
    }
    if (Object.hasOwn(before, key) !== Object.hasOwn(after, key)
      || before[key] !== after[key]) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
  }
  for (const [key, value] of setValues) {
    if (!Object.hasOwn(after, key) || after[key] !== value) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
  }
}

export function renderRootEnvironment(existingBytes, {
  owner,
  values,
  deleteKeys,
}) {
  const { rule, setValues, deletedKeys } = normalizeMutation(owner, values, deleteKeys);
  const { lines, ownedIndexes } = inspectEnvironment(existingBytes, owner);
  const renderedLines = [...lines];
  const fileBom = renderedLines[0]?.startsWith('\uFEFF') ? '\uFEFF' : '';
  if (fileBom) renderedLines[0] = renderedLines[0].slice(1);
  const removedIndexes = new Set();
  const modifiedIndexes = new Set();

  for (const key of rule.keys) {
    const index = ownedIndexes.get(key);
    if (index === undefined) continue;
    if (deletedKeys.has(key)) {
      removedIndexes.add(index);
      continue;
    }
    if (!setValues.has(key)) continue;
    const content = stripEnvLineEnding(renderedLines[index]);
    const match = ENV_ASSIGNMENT_PATTERN.exec(content);
    renderedLines[index] = `${match[1]}${key}=${encodeEnvValue(setValues.get(key))}${envLineEnding(renderedLines[index])}`;
    modifiedIndexes.add(index);
  }

  const retainedLines = renderedLines
    .map((line, index) => ({ index, line }))
    .filter(({ index }) => !removedIndexes.has(index));
  let rendered = retainedLines.map(({ line }) => line).join('');
  const appended = [];
  for (const key of rule.keys) {
    if (!setValues.has(key) || ownedIndexes.has(key)) continue;
    appended.push(`${key}=${encodeEnvValue(setValues.get(key))}\n`);
  }
  if (appended.length > 0) {
    const appendedText = appended.join('');
    const finalLine = retainedLines.at(-1);
    const finalLineIsUnterminated = finalLine
      && !finalLine.line.endsWith('\n')
      && !finalLine.line.endsWith('\r');
    if (finalLineIsUnterminated && !modifiedIndexes.has(finalLine.index)) {
      const prefix = retainedLines.slice(0, -1).map(({ line }) => line).join('');
      rendered = `${prefix}${appendedText}${finalLine.line}`;
    } else {
      if (rendered.length > 0 && !rendered.endsWith('\n') && !rendered.endsWith('\r')) {
        rendered += '\n';
      }
      rendered += appendedText;
    }
  }
  rendered = `${fileBom}${rendered}`;

  const nextBytes = Buffer.from(rendered, 'utf8');
  if (nextBytes.length > ROOT_ENVIRONMENT_MAX_BYTES) {
    throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
  }
  assertRenderedEnvironment(existingBytes, nextBytes, setValues, deletedKeys);
  return nextBytes;
}

function fsyncDirectory(directoryPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(
      directoryPath,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY || 0)
        | requireSafeOpenFlags(),
    );
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function createOpaqueOwnerRead(owner, exists, parsed) {
  const rule = requireOwnerRule(owner);
  const ownedKeySet = OWNER_KEY_SETS.get(owner);
  const capturedValues = new Map(
    rule.keys
      .filter(key => Object.hasOwn(parsed, key))
      .map(key => [key, parsed[key]]),
  );
  const presentKeys = Object.freeze([...capturedValues.keys()]);
  const requireOwnedKey = key => {
    if (typeof key !== 'string' || !ownedKeySet.has(key)) {
      throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
    }
  };

  const read = Object.create(null);
  Object.defineProperties(read, {
    exists: {
      enumerable: false,
      value: () => exists,
    },
    keys: {
      enumerable: false,
      value: () => presentKeys,
    },
    has: {
      enumerable: false,
      value: key => {
        requireOwnedKey(key);
        return capturedValues.has(key);
      },
    },
    value: {
      enumerable: false,
      value: key => {
        requireOwnedKey(key);
        return capturedValues.get(key);
      },
    },
  });
  Object.freeze(read);
  brandedRootEnvironmentReads.add(read);
  return read;
}

export function readRootEnvironmentFile({ projectRoot, owner }) {
  requireOwnerRule(owner);
  const directoryPath = requireCanonicalRootEnvironmentProjectRoot(projectRoot);
  const directorySnapshot = requireOwnedCanonicalDirectory(directoryPath);
  const targetPath = path.join(directoryPath, '.env');
  const snapshot = readSafeExistingTarget(
    targetPath,
    directoryPath,
    directorySnapshot,
    owner,
  );
  return createOpaqueOwnerRead(owner, snapshot !== null, snapshot?.parsed || {});
}

export function requireRootEnvironmentFileRead(value) {
  if ((typeof value !== 'object' && typeof value !== 'function')
    || value === null
    || !Object.isFrozen(value)
    || !brandedRootEnvironmentReads.has(value)) {
    throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
  }
  return value;
}

// Runtime bootstrap needs the ordinary dotenv projection as well as the exact
// notification file projection from one verified read. The two sensitive
// owner sets are never included in ambientValues, and both are validated for
// duplicates/expanded controls before anything is returned. Properties are
// deliberately non-enumerable so accidental serialization yields no raw data.
export function readRootEnvironmentBootstrap({ projectRoot }) {
  const directoryPath = requireCanonicalRootEnvironmentProjectRoot(projectRoot);
  const directorySnapshot = requireOwnedCanonicalDirectory(directoryPath);
  const targetPath = path.join(directoryPath, '.env');
  const snapshot = readSafeExistingTarget(
    targetPath,
    directoryPath,
    directorySnapshot,
    ROOT_ENVIRONMENT_OWNER.NOTIFICATION,
  );
  if (snapshot) {
    inspectEnvironment(snapshot.bytes, ROOT_ENVIRONMENT_OWNER.LEGACY_NOTIFICATION_SCRUB);
  }

  const notificationValues = new Map();
  const ambientValues = new Map();
  for (const [key, value] of Object.entries(snapshot?.parsed || {})) {
    if (OWNER_KEY_SETS.get(ROOT_ENVIRONMENT_OWNER.NOTIFICATION).has(key)) {
      notificationValues.set(key, value);
    } else if (!NON_AMBIENT_NOTIFICATION_KEY_SET.has(key)) {
      ambientValues.set(key, value);
    }
  }
  const notificationKeys = Object.freeze([...notificationValues.keys()]);
  const ambientKeys = Object.freeze([...ambientValues.keys()]);
  const notificationKeySet = OWNER_KEY_SETS.get(ROOT_ENVIRONMENT_OWNER.NOTIFICATION);

  const bootstrap = Object.create(null);
  Object.defineProperties(bootstrap, {
    exists: {
      enumerable: false,
      value: () => snapshot !== null,
    },
    notificationKeys: {
      enumerable: false,
      value: () => notificationKeys,
    },
    notificationValue: {
      enumerable: false,
      value: key => {
        if (typeof key !== 'string' || !notificationKeySet.has(key)) {
          throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
        }
        return notificationValues.get(key);
      },
    },
    ambientKeys: {
      enumerable: false,
      value: () => ambientKeys,
    },
    forEachAmbient: {
      enumerable: false,
      value: visitor => {
        if (typeof visitor !== 'function') {
          throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
        }
        for (const [key, value] of ambientValues) visitor(key, value);
        return ambientValues.size;
      },
    },
  });
  Object.freeze(bootstrap);
  brandedRootEnvironmentBootstraps.add(bootstrap);
  return bootstrap;
}

export function requireRootEnvironmentBootstrap(value) {
  if ((typeof value !== 'object' && typeof value !== 'function')
    || value === null
    || !Object.isFrozen(value)
    || !brandedRootEnvironmentBootstraps.has(value)) {
    throw rootEnvironmentError(SETUP_ENV_VALUE_INVALID);
  }
  return value;
}

export function patchRootEnvironmentFile({
  projectRoot,
  owner,
  values,
  deleteKeys,
}) {
  // Validate the complete mutation before touching the filesystem.
  normalizeMutation(owner, values, deleteKeys);
  const directoryPath = requireCanonicalRootEnvironmentProjectRoot(projectRoot);
  const directorySnapshot = requireOwnedCanonicalDirectory(directoryPath);
  const targetPath = path.join(directoryPath, '.env');
  const snapshot = readSafeExistingTarget(
    targetPath,
    directoryPath,
    directorySnapshot,
    owner,
  );
  const nextBytes = renderRootEnvironment(snapshot?.bytes || Buffer.alloc(0), {
    owner,
    values,
    deleteKeys,
  });
  if ((snapshot && snapshot.bytes.equals(nextBytes))
    || (!snapshot && nextBytes.length === 0)) {
    return Object.freeze({ path: targetPath, changed: false });
  }
  const tempPath = path.join(
    directoryPath,
    `.env.c3-root-${process.pid}-${randomBytes(12).toString('hex')}.tmp`,
  );
  let tempCreated = false;
  let published = false;
  try {
    const tempDescriptor = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | requireSafeOpenFlags(),
      0o600,
    );
    tempCreated = true;
    let tempWrittenStat;
    try {
      fs.writeFileSync(tempDescriptor, nextBytes);
      fs.fchmodSync(tempDescriptor, 0o600);
      fs.fsyncSync(tempDescriptor);
      tempWrittenStat = fs.fstatSync(tempDescriptor, { bigint: true });
      requireSafeRootEnvironmentTarget(tempWrittenStat);
      if (tempWrittenStat.size !== BigInt(nextBytes.length)) {
        throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
      }
    } finally {
      fs.closeSync(tempDescriptor);
    }

    const tempPathStat = fs.lstatSync(tempPath, { bigint: true });
    requireSafeRootEnvironmentTarget(tempPathStat);
    if (!sameStableFile(tempWrittenStat, tempPathStat)) {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
    const tempReadDescriptor = fs.openSync(
      tempPath,
      fs.constants.O_RDONLY | requireSafeOpenFlags(),
    );
    try {
      const tempOpenedStat = fs.fstatSync(tempReadDescriptor, { bigint: true });
      requireSafeRootEnvironmentTarget(tempOpenedStat);
      if (!sameStableFile(tempWrittenStat, tempOpenedStat)) {
        throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
      }
      const tempReadback = readBounded(tempReadDescriptor);
      const tempAfterReadStat = fs.fstatSync(tempReadDescriptor, { bigint: true });
      requireSafeRootEnvironmentTarget(tempAfterReadStat);
      if (!sameStableFile(tempOpenedStat, tempAfterReadStat)
        || !tempReadback.equals(nextBytes)) {
        throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
      }
      const tempFinalPathStat = fs.lstatSync(tempPath, { bigint: true });
      requireSafeRootEnvironmentTarget(tempFinalPathStat);
      if (!sameStableFile(tempAfterReadStat, tempFinalPathStat)) {
        throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
      }
    } finally {
      fs.closeSync(tempReadDescriptor);
    }

    recheckCanonicalDirectory(directoryPath, directorySnapshot);
    if (snapshot) {
      recheckExistingTarget(targetPath, snapshot);
      recheckExistingTarget(tempPath, tempWrittenStat);
      fs.renameSync(tempPath, targetPath);
      tempCreated = false;
      published = true;
    } else {
      recheckExistingTarget(tempPath, tempWrittenStat);
      fs.linkSync(tempPath, targetPath);
      published = true;
      fs.unlinkSync(tempPath);
      tempCreated = false;
    }

    fsyncDirectory(directoryPath);
    const publishedSnapshot = readSafeExistingTarget(
      targetPath,
      directoryPath,
      directorySnapshot,
      owner,
    );
    if (!publishedSnapshot || !publishedSnapshot.bytes.equals(nextBytes)) {
      throw rootEnvironmentError(SETUP_ENV_PUBLICATION_UNKNOWN);
    }
    return Object.freeze({ path: targetPath, changed: !snapshot?.bytes.equals(nextBytes) });
  } catch (error) {
    if (tempCreated) {
      try { fs.unlinkSync(tempPath); } catch { /* best-effort temp cleanup */ }
    }
    if (published) {
      throw rootEnvironmentError(SETUP_ENV_PUBLICATION_UNKNOWN);
    }
    if (error instanceof RootEnvironmentFileError) throw error;
    if (error?.code === 'EEXIST' || error?.code === 'ELOOP') {
      throw rootEnvironmentError(SETUP_ENV_TARGET_UNSAFE);
    }
    throw rootEnvironmentError(SETUP_ENV_WRITE_FAILED);
  }
}
