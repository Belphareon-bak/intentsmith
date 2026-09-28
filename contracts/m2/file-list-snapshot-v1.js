import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalStringify } from './effect-v1.js';

// A representation for one approved root-directory observation. These pure
// helpers do not grant authority or make the legacy unavailable tool runnable.
export const M2_FILE_LIST_MAX_ENTRIES = 10_000;
export const M2_FILE_LIST_MAX_BYTES = 1_048_576;
export const M2_FILE_LIST_SNAPSHOT_SCHEMA = 'intentsmith.effect.file-list-snapshot@1';
export const M2_FILE_LIST_TARGET_TYPE = 'project-root-list@1';
export const M2_FILE_LIST_SCOPE = Object.freeze({
  kind: 'fs.read', requiredCapability: 'project.fs.list', riskClass: 'read',
});
const ENTRY_TYPES = Object.freeze(['file', 'directory', 'symlink', 'special']);

function reject(reason) {
  throw Object.assign(new TypeError(`Invalid root listing: ${reason}`), {
    code: 'EFFECT_FILE_LIST_INVALID',
  });
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

export function validateM2FileListTarget(value) {
  return exactKeys(value, ['type', 'canonicalRoot', 'relativePath', 'resolvedRealpath'])
    && value.type === M2_FILE_LIST_TARGET_TYPE
    && typeof value.canonicalRoot === 'string' && value.canonicalRoot.length > 0
    && !value.canonicalRoot.includes('\0') && path.isAbsolute(value.canonicalRoot)
    && path.normalize(value.canonicalRoot) === value.canonicalRoot
    && value.relativePath === '.' && value.resolvedRealpath === value.canonicalRoot;
}

export function createM2FileListTarget(canonicalRoot) {
  const target = { type: M2_FILE_LIST_TARGET_TYPE, canonicalRoot,
    relativePath: '.', resolvedRealpath: canonicalRoot };
  if (!validateM2FileListTarget(target)) reject('exact root target');
  return Object.freeze(target);
}

export function createM2FileListPolicyPayload({
  maxEntries = M2_FILE_LIST_MAX_ENTRIES, maxOutputBytes = M2_FILE_LIST_MAX_BYTES,
} = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > M2_FILE_LIST_MAX_ENTRIES
    || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > M2_FILE_LIST_MAX_BYTES) {
    reject('resource ceilings');
  }
  return Buffer.from(canonicalStringify({ format: 'root-entries@1', recursive: false,
    maxEntries, maxOutputBytes }), 'utf8');
}

export function parseM2FileListPolicyPayload(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 256) reject('policy bytes');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { reject('policy JSON'); }
  if (!exactKeys(value, ['format', 'recursive', 'maxEntries', 'maxOutputBytes'])
    || value.format !== 'root-entries@1' || value.recursive !== false
    || !createM2FileListPolicyPayload(value).equals(bytes)) reject('canonical policy');
  return Object.freeze(value);
}

// POSIX names are byte strings. Base64 avoids NFC changes and replacement of
// invalid UTF-8; a renderer must separately escape names instead of trusting them.
export function createM2FileListEntry(nameBytes, type) {
  if (!Buffer.isBuffer(nameBytes) || nameBytes.length < 1 || nameBytes.length > 255
    || nameBytes.includes(0) || nameBytes.includes(47)
    || nameBytes.equals(Buffer.from('.')) || nameBytes.equals(Buffer.from('..'))
    || !ENTRY_TYPES.includes(type)) reject('direct-child entry');
  return Object.freeze({ nameBase64: nameBytes.toString('base64'), type });
}

function entryName(entry) {
  if (!exactKeys(entry, ['nameBase64', 'type']) || typeof entry.nameBase64 !== 'string'
    || entry.nameBase64.length > 340) reject('entry shape');
  const bytes = Buffer.from(entry.nameBase64, 'base64');
  if (canonicalStringify(createM2FileListEntry(bytes, entry.type)) !== canonicalStringify(entry)) {
    reject('entry encoding');
  }
  return bytes;
}

export function createM2FileListSnapshot(entries, policyBytes = createM2FileListPolicyPayload()) {
  const policy = parseM2FileListPolicyPayload(policyBytes);
  if (!Array.isArray(entries) || entries.length > policy.maxEntries) reject('entry ceiling');
  const pairs = entries.map(entry => ({ name: entryName(entry),
    entry: createM2FileListEntry(Buffer.from(entry.nameBase64, 'base64'), entry.type) }));
  pairs.sort((a, b) => Buffer.compare(a.name, b.name));
  for (let index = 1; index < pairs.length; index++) {
    if (pairs[index - 1].name.equals(pairs[index].name)) reject('duplicate name');
  }
  const value = Object.freeze({ schema: M2_FILE_LIST_SNAPSHOT_SCHEMA, path: '.',
    complete: true, entries: Object.freeze(pairs.map(pair => pair.entry)) });
  const bytes = Buffer.from(canonicalStringify(value), 'utf8');
  if (bytes.length > policy.maxOutputBytes) reject('output byte ceiling');
  return Object.freeze({ value, bytes,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` });
}

export function parseM2FileListSnapshot(bytes, policyBytes = createM2FileListPolicyPayload()) {
  const policy = parseM2FileListPolicyPayload(policyBytes);
  if (!Buffer.isBuffer(bytes) || bytes.length > policy.maxOutputBytes) reject('snapshot bytes');
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { reject('snapshot JSON'); }
  if (!exactKeys(value, ['schema', 'path', 'complete', 'entries'])
    || value.schema !== M2_FILE_LIST_SNAPSHOT_SCHEMA || value.path !== '.'
    || value.complete !== true) reject('snapshot shape');
  const snapshot = createM2FileListSnapshot(value.entries, policyBytes);
  if (!snapshot.bytes.equals(bytes)) reject('snapshot canonical ordering');
  return snapshot;
}
