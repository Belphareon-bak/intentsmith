import fs from 'node:fs';
import {
  createM2FileListEntry, createM2FileListPolicyPayload, createM2FileListSnapshot,
  validateM2FileListTarget, parseM2FileListPolicyPayload,
} from '../../contracts/m2/file-list-snapshot-v1.js';

function fail(code) {
  throw Object.assign(new Error('Project root listing could not be observed safely'), { code });
}

function stableIdentity(left, right) {
  return ['dev', 'ino', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].every(key => left[key] === right[key]);
}

function entryType(entry) {
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'directory';
  if (entry.isSymbolicLink()) return 'symlink';
  if (entry.isSocket() || entry.isFIFO() || entry.isBlockDevice() || entry.isCharacterDevice()) return 'special';
  fail('EFFECT_FILE_LIST_UNKNOWN_TYPE');
}

/**
 * Bounded Linux directory metadata observation; never opens a child or follows
 * its symlink. The future Effect broker must verify project/revision/approval
 * before calling this leaf and publish a durable snapshot before any consumer.
 */
export function observeProjectRootListing(target, {
  policyBytes = createM2FileListPolicyPayload(), signal = null, fileSystem = fs,
} = {}) {
  if (process.platform !== 'linux') fail('EFFECT_FILE_LIST_PLATFORM_UNSUPPORTED');
  if (!validateM2FileListTarget(target)) fail('EFFECT_FILE_LIST_TARGET_INVALID');
  const policy = parseM2FileListPolicyPayload(policyBytes);
  const check = () => { if (signal?.aborted) fail('EFFECT_CANCELLED'); };
  const root = target.canonicalRoot;
  check();
  if (fileSystem.realpathSync(root) !== root) fail('EFFECT_FILE_LIST_ROOT_CHANGED');
  const before = fileSystem.lstatSync(root, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) fail('EFFECT_FILE_LIST_NOT_DIRECTORY');
  const constants = fileSystem.constants || fs.constants;
  if (![constants.O_DIRECTORY, constants.O_NOFOLLOW, constants.O_NONBLOCK].every(Number.isInteger)) {
    fail('EFFECT_FILE_LIST_PLATFORM_UNSUPPORTED');
  }
  let fd;
  let directory;
  try {
    fd = fileSystem.openSync(root, constants.O_RDONLY | constants.O_DIRECTORY
      | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fileSystem.fstatSync(fd, { bigint: true });
    if (!opened.isDirectory() || !stableIdentity(before, opened)) fail('EFFECT_FILE_LIST_ROOT_CHANGED');
    const descriptorPath = `/proc/self/fd/${fd}`;
    if (fileSystem.realpathSync(descriptorPath) !== root) fail('EFFECT_FILE_LIST_ROOT_CHANGED');
    // opendir does not accept a descriptor. This process-owned fd path keeps
    // enumeration on the opened inode if the project pathname is replaced.
    directory = fileSystem.opendirSync(descriptorPath, { encoding: 'buffer', bufferSize: 32 });
    const entries = [];
    for (;;) {
      check();
      const entry = directory.readSync();
      if (entry === null) break;
      if (entries.length === policy.maxEntries) fail('EFFECT_FILE_LIST_ENTRY_LIMIT');
      entries.push(createM2FileListEntry(entry.name, entryType(entry)));
    }
    check();
    const ended = fileSystem.fstatSync(fd, { bigint: true });
    const current = fileSystem.lstatSync(root, { bigint: true });
    if (!stableIdentity(opened, ended) || !stableIdentity(opened, current)
      || fileSystem.realpathSync(root) !== root
      || fileSystem.realpathSync(descriptorPath) !== root) fail('EFFECT_FILE_LIST_ROOT_CHANGED');
    const snapshot = createM2FileListSnapshot(entries, policyBytes);
    check();
    return snapshot;
  } finally {
    try { directory?.closeSync(); } finally { if (fd !== undefined) fileSystem.closeSync(fd); }
  }
}
