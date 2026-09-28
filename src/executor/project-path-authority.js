// M2 project-path authority
// =============================================================================
//
// Existing patch and lifecycle writers historically accepted a path and joined
// it to `projectRoot`.  That is not authority: absolute paths replace the root,
// `..` walks out of it and a symlink can redirect an otherwise innocent name.
//
// This module is the narrow, internal foundation for WP-M2-EFFECT.  It does not
// publish EffectRequest/Result or ApprovalGrant v1; those remain a separate
// connector decision.  It gives current filesystem paths one fail-closed rule:
// caller input is project-relative, the canonical target stays below the
// canonical root, reads are descriptor-pinned, and the target is checked again
// immediately before an atomic replacement.
//
// A hostile ABA rename between the final check and `rename(2)` cannot be closed
// portably with Node path APIs.  The full broker needs a dirfd/openat2-backed
// primitive for that threat model.  A hardlink created inside the project can
// also expose bytes from an inode that has another name outside the project;
// atomic replacement stays inside, but descriptor-pinned reads cannot infer
// the ownership of every hardlink.  Both limitations are explicit rather than
// being mistaken for a complete effect authority.
// =============================================================================

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class ProjectPathError extends Error {
  constructor(reason, detail = {}) {
    super(`PROJECT_PATH_VIOLATION:${reason}`);
    this.name = 'ProjectPathError';
    this.code = 'PROJECT_PATH_VIOLATION';
    this.reason = reason;
    this.detail = detail;
  }
}

export class ProjectWriteDurabilityError extends Error {
  constructor(filePath, directory, cause) {
    super('Project file was replaced but parent-directory durability was not confirmed', {
      cause,
    });
    this.name = 'ProjectWriteDurabilityError';
    this.code = 'PROJECT_WRITE_DURABILITY_UNCONFIRMED';
    this.effectApplied = true;
    this.detail = { filePath, directory, ioCode: cause?.code || 'EUNKNOWN' };
  }
}

export class ProjectDeleteDurabilityError extends Error {
  constructor(filePath, directory, cause) {
    super('Project file was removed but parent-directory durability was not confirmed', {
      cause,
    });
    this.name = 'ProjectDeleteDurabilityError';
    this.code = 'PROJECT_DELETE_DURABILITY_UNCONFIRMED';
    this.effectApplied = true;
    this.detail = { filePath, directory, ioCode: cause?.code || 'EUNKNOWN' };
  }
}

export function isProjectPathError(error) {
  return error instanceof ProjectPathError
    || error?.code === 'PROJECT_PATH_VIOLATION';
}

function canonicalRoot(projectRoot, fileSystem) {
  if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
    throw new ProjectPathError('project_root_required');
  }

  try {
    return fileSystem.realpathSync(projectRoot);
  } catch (error) {
    throw new ProjectPathError('project_root_unavailable', {
      projectRoot: path.resolve(projectRoot),
      ioCode: error?.code || 'EUNKNOWN',
    });
  }
}

function rejectInvalidInput(filePath, projectRoot) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new ProjectPathError('path_required', { projectRoot });
  }
  if (filePath.includes('\0')) {
    throw new ProjectPathError('nul_byte', { input: filePath, projectRoot });
  }

  // Reject both native and foreign-platform absolute spellings.  A Windows
  // path must not become a surprising relative filename when the core runs on
  // Linux, nor vice versa.
  if (path.isAbsolute(filePath)
    || path.posix.isAbsolute(filePath)
    || path.win32.isAbsolute(filePath)) {
    throw new ProjectPathError('absolute_path', {
      input: filePath,
      projectRoot,
      target: path.resolve(projectRoot, filePath),
    });
  }

  // Authority is a relative name, not a navigation program.  Reject even a
  // traversal that normalizes back inside (`a/../b`) so all callers share one
  // unambiguous rule.
  if (filePath.split(/[\\/]+/).some((segment) => segment === '..')) {
    throw new ProjectPathError('traversal', {
      input: filePath,
      projectRoot,
      target: path.resolve(projectRoot, filePath),
    });
  }
}

function resolveThroughNearestAncestor(absolute, fileSystem) {
  const missing = [];
  let candidate = absolute;

  for (;;) {
    try {
      return path.join(fileSystem.realpathSync(candidate), ...missing);
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) return absolute;
    missing.unshift(path.basename(candidate));
    candidate = parent;
  }
}

/**
 * Resolve one caller-supplied project-relative path to its canonical target.
 */
export function resolveProjectTarget(projectRoot, filePath, {
  allowRoot = false,
  fileSystem = fs,
} = {}) {
  const root = canonicalRoot(projectRoot, fileSystem);
  rejectInvalidInput(filePath, root);

  let real;
  try {
    real = resolveThroughNearestAncestor(path.resolve(root, filePath), fileSystem);
  } catch (error) {
    if (error?.code === 'ELOOP') {
      throw new ProjectPathError('symlink_loop', {
        input: filePath,
        projectRoot: root,
      });
    }
    throw error;
  }

  const relativePath = path.relative(root, real);
  const outside = relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath);

  if (outside) {
    throw new ProjectPathError('outside_project', {
      input: filePath,
      projectRoot: root,
      target: real,
    });
  }
  if (!allowRoot && relativePath === '') {
    throw new ProjectPathError('project_root_target', {
      input: filePath,
      projectRoot: root,
      target: real,
    });
  }

  // The caller authorizes the declared project-relative name, not merely any
  // canonical inode that happens to stay below the project root.  Following an
  // in-project symlink would otherwise let `allowed.js` mutate `secret.js`
  // while scope, backup and evidence continue to name `allowed.js`.
  const declaredRelativePath = path.relative(root, path.resolve(root, filePath));
  if (relativePath !== declaredRelativePath) {
    throw new ProjectPathError('canonical_target_mismatch', {
      input: filePath,
      projectRoot: root,
      target: real,
      declaredTarget: path.resolve(root, filePath),
    });
  }

  return {
    input: filePath,
    projectRoot: root,
    relativePath,
    real,
  };
}

function changedTargetError(before, after, filePath) {
  return new ProjectPathError('resolved_target_changed', {
    input: filePath,
    projectRoot: after?.projectRoot || before.projectRoot,
    target: after?.real || null,
    expectedTarget: before.real,
  });
}

function sameTarget(before, after) {
  return before.projectRoot === after.projectRoot && before.real === after.real;
}

/**
 * Re-resolve a name and prove it still denotes the preflight target.
 */
export function revalidateProjectTarget(projectRoot, filePath, expected, {
  fileSystem = fs,
} = {}) {
  let current;
  try {
    current = resolveProjectTarget(projectRoot, filePath, { fileSystem });
  } catch (error) {
    if (!isProjectPathError(error)) throw error;
    current = {
      projectRoot: error?.detail?.projectRoot || expected.projectRoot,
      real: error?.detail?.target || null,
    };
    throw changedTargetError(expected, current, filePath);
  }

  if (!sameTarget(expected, current)) {
    throw changedTargetError(expected, current, filePath);
  }
  return current;
}

/**
 * Read through an opened descriptor, then prove the project-relative name and
 * the opened inode still identify the same in-project file before returning
 * any bytes to the caller.
 */
export function readProjectFile(projectRoot, filePath, {
  fileSystem = fs,
} = {}) {
  const before = resolveProjectTarget(projectRoot, filePath, { fileSystem });
  const noFollow = fileSystem.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0;
  const readOnly = fileSystem.constants?.O_RDONLY ?? fs.constants.O_RDONLY;
  let descriptor;

  try {
    descriptor = fileSystem.openSync(before.real, readOnly | noFollow);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;

    const afterMissing = revalidateProjectTarget(
      projectRoot,
      filePath,
      before,
      { fileSystem },
    );
    if (fileSystem.existsSync(afterMissing.real)) {
      throw changedTargetError(before, afterMissing, filePath);
    }
    return { target: afterMissing, exists: false, content: '' };
  }

  try {
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile()) {
      throw new ProjectPathError('not_regular_file', {
        input: filePath,
        projectRoot: before.projectRoot,
        target: before.real,
      });
    }

    const content = fileSystem.readFileSync(descriptor, 'utf8');
    const after = revalidateProjectTarget(
      projectRoot,
      filePath,
      before,
      { fileSystem },
    );

    let current;
    try {
      current = fileSystem.statSync(after.real);
    } catch {
      throw changedTargetError(before, after, filePath);
    }
    if (opened.dev !== current.dev || opened.ino !== current.ino) {
      throw changedTargetError(before, after, filePath);
    }

    return { target: after, exists: true, content };
  } finally {
    fileSystem.closeSync(descriptor);
  }
}

/**
 * Descriptor-pinned binary counterpart used by durable execution journals.
 * Keeping bytes lossless is required to restore a pre-existing file exactly;
 * the planner separately decides whether those bytes are valid UTF-8 source.
 */
export function readProjectFileBytes(projectRoot, filePath, {
  fileSystem = fs,
  maxBytes = null,
  rejectHardlinks = false,
  requireCanonicalTarget = false,
  signal = null,
} = {}) {
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
    throw new TypeError('maxBytes must be a non-negative safe integer');
  }
  const checkCancellation = () => {
    if (signal?.aborted) {
      throw Object.assign(new Error('Effect cancelled during filesystem read'), {
        code: 'EFFECT_CANCELLED',
      });
    }
  };
  const checkReadStat = (stat) => {
    if (rejectHardlinks && stat.nlink === 0) {
      throw new ProjectPathError('read_target_changed', { input: filePath, projectRoot });
    }
    if (rejectHardlinks && stat.nlink !== 1) {
      throw Object.assign(new Error('Filesystem read target has multiple hardlinks'), {
        code: 'EFFECT_FS_HARDLINK_REJECTED',
      });
    }
    if (maxBytes !== null && stat.size > maxBytes) {
      throw Object.assign(new Error('Filesystem read exceeds its exact byte limit'), {
        code: 'EFFECT_FS_READ_TOO_LARGE',
      });
    }
  };
  checkCancellation();
  const before = resolveProjectTarget(projectRoot, filePath, { fileSystem });
  if (requireCanonicalTarget && (before.projectRoot !== projectRoot
    || before.relativePath !== filePath)) {
    throw new ProjectPathError('canonical_target_changed', { input: filePath, projectRoot });
  }
  const noFollow = fileSystem.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0;
  const readOnly = fileSystem.constants?.O_RDONLY ?? fs.constants.O_RDONLY;
  let descriptor;

  try {
    const nonBlock = maxBytes === null ? 0 : (fileSystem.constants?.O_NONBLOCK ?? fs.constants.O_NONBLOCK ?? 0);
    descriptor = fileSystem.openSync(before.real, readOnly | noFollow | nonBlock);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const afterMissing = revalidateProjectTarget(projectRoot, filePath, before, { fileSystem });
    if (fileSystem.existsSync(afterMissing.real)) {
      throw changedTargetError(before, afterMissing, filePath);
    }
    return { target: afterMissing, exists: false, bytes: Buffer.alloc(0), mode: null };
  }

  try {
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile()) {
      throw new ProjectPathError('not_regular_file', {
        input: filePath,
        projectRoot: before.projectRoot,
        target: before.real,
      });
    }
    checkReadStat(opened);
    let bytes;
    if (maxBytes === null) {
      bytes = fileSystem.readFileSync(descriptor);
    } else {
      // Bound allocation and reads even if the file grows after fstat. The
      // extra byte distinguishes an exact-limit file from an oversized one.
      const chunks = [];
      let length = 0;
      for (;;) {
        checkCancellation();
        const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - length + 1));
        const count = fileSystem.readSync(descriptor, chunk, 0, chunk.length, null);
        if (count === 0) break;
        length += count;
        if (length > maxBytes) {
          throw Object.assign(new Error('Filesystem read exceeds its exact byte limit'), {
            code: 'EFFECT_FS_READ_TOO_LARGE',
          });
        }
        chunks.push(chunk.subarray(0, count));
      }
      bytes = Buffer.concat(chunks, length);
      const completed = fileSystem.fstatSync(descriptor);
      checkReadStat(completed);
      if (opened.size !== completed.size || completed.size !== length
        || opened.mtimeMs !== completed.mtimeMs || opened.ctimeMs !== completed.ctimeMs) {
        throw new ProjectPathError('read_target_changed', { input: filePath, projectRoot });
      }
    }
    checkCancellation();
    const after = revalidateProjectTarget(projectRoot, filePath, before, { fileSystem });
    const current = fileSystem.statSync(after.real);
    checkReadStat(current);
    if (opened.dev !== current.dev || opened.ino !== current.ino) {
      throw changedTargetError(before, after, filePath);
    }
    return {
      target: after,
      exists: true,
      bytes: Buffer.from(bytes),
      mode: opened.mode & 0o777,
      linkCount: opened.nlink,
    };
  } finally {
    fileSystem.closeSync(descriptor);
  }
}

/**
 * Atomically replace one in-project file after revalidating the read/preflight
 * target.  Existing mode bits are retained.  Temp data is fsync'd before the
 * rename; any failed attempt removes only its own unique temp file.
 */
export function writeProjectFileAtomic(projectRoot, filePath, content, {
  expectedTarget = null,
  fileSystem = fs,
  createParents = true,
  desiredMode = null,
} = {}) {
  const before = resolveProjectTarget(projectRoot, filePath, { fileSystem });
  if (expectedTarget && !sameTarget(expectedTarget, before)) {
    throw changedTargetError(expectedTarget, before, filePath);
  }

  const directory = path.dirname(before.real);
  if (createParents) {
    fileSystem.mkdirSync(directory, { recursive: true });
  } else {
    // Authority-bearing callers must not acquire directory-creation authority
    // through a shared legacy writer. In this mode mkdir is never invoked: a
    // missing/non-directory parent is a terminal pre-effect rejection.
    try {
      const directoryStat = fileSystem.statSync(directory);
      if (!directoryStat.isDirectory()) {
        throw new ProjectPathError('parent_not_directory', {
          input: filePath,
          projectRoot: before.projectRoot,
          target: directory,
        });
      }
    } catch (error) {
      if (isProjectPathError(error)) throw error;
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw new ProjectPathError('parent_directory_missing', {
          input: filePath,
          projectRoot: before.projectRoot,
          target: directory,
        });
      }
      throw error;
    }
  }
  const current = revalidateProjectTarget(
    projectRoot,
    filePath,
    expectedTarget || before,
    { fileSystem },
  );

  let mode = 0o666;
  let preserveMode = false;
  try {
    mode = fileSystem.statSync(current.real).mode & 0o777;
    preserveMode = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    if (desiredMode !== null) {
      if (!Number.isSafeInteger(desiredMode) || desiredMode < 0 || desiredMode > 0o777) {
        throw new TypeError('desiredMode must be a POSIX permission mode');
      }
      mode = desiredMode;
    }
  }

  const tempPath = `${current.real}.intentsmith-${process.pid}-${randomUUID()}.tmp`;
  let descriptor = null;
  let directoryDescriptor = null;
  let renamed = false;
  try {
    descriptor = fileSystem.openSync(tempPath, 'wx', mode);
    // `open` applies the process umask.  Existing target permissions are an
    // invariant, so restore the exact observed mode on the already-open temp.
    if ((preserveMode || desiredMode !== null) && typeof fileSystem.fchmodSync === 'function') {
      fileSystem.fchmodSync(descriptor, mode);
    }
    fileSystem.writeFileSync(descriptor, content, 'utf8');
    if (typeof fileSystem.fsyncSync === 'function') fileSystem.fsyncSync(descriptor);
    fileSystem.closeSync(descriptor);
    descriptor = null;

    // A simple parent/symlink swap is detected before the effect becomes
    // visible.  The documented hostile ABA interval remains for the broker.
    revalidateProjectTarget(projectRoot, filePath, current, { fileSystem });
    fileSystem.renameSync(tempPath, current.real);
    renamed = true;

    // A successful rename is not yet a durable directory entry.  The broker
    // may publish success only after both the file data and its parent entry
    // have crossed an fsync boundary.
    if (typeof fileSystem.fsyncSync !== 'function') {
      const unsupported = new Error('Filesystem does not expose fsyncSync');
      unsupported.code = 'ENOTSUP';
      throw unsupported;
    }
    const readOnly = fileSystem.constants?.O_RDONLY ?? fs.constants.O_RDONLY;
    const directoryOnly = fileSystem.constants?.O_DIRECTORY ?? fs.constants.O_DIRECTORY ?? 0;
    directoryDescriptor = fileSystem.openSync(directory, readOnly | directoryOnly);
    fileSystem.fsyncSync(directoryDescriptor);
    fileSystem.closeSync(directoryDescriptor);
    directoryDescriptor = null;
  } catch (error) {
    if (descriptor !== null) {
      try { fileSystem.closeSync(descriptor); } catch { /* best effort */ }
    }
    if (directoryDescriptor !== null) {
      try { fileSystem.closeSync(directoryDescriptor); } catch { /* best effort */ }
    }
    try { fileSystem.unlinkSync(tempPath); } catch { /* best effort */ }
    if (renamed) throw new ProjectWriteDurabilityError(filePath, directory, error);
    throw error;
  }

  return current;
}

/**
 * Durably remove one exact in-project regular file. This is intentionally not
 * a recursive delete and never creates authority over a parent directory. It
 * exists for compensation of a project-change file that was absent before the
 * transaction began.
 */
export function deleteProjectFileDurable(projectRoot, filePath, {
  expectedTarget = null,
  fileSystem = fs,
} = {}) {
  const before = resolveProjectTarget(projectRoot, filePath, { fileSystem });
  if (expectedTarget && !sameTarget(expectedTarget, before)) {
    throw changedTargetError(expectedTarget, before, filePath);
  }
  const noFollow = fileSystem.constants?.O_NOFOLLOW ?? fs.constants.O_NOFOLLOW ?? 0;
  const readOnly = fileSystem.constants?.O_RDONLY ?? fs.constants.O_RDONLY;
  let descriptor;
  try {
    descriptor = fileSystem.openSync(before.real, readOnly | noFollow);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ProjectPathError('target_missing', {
        input: filePath,
        projectRoot: before.projectRoot,
        target: before.real,
      });
    }
    throw error;
  }

  try {
    const opened = fileSystem.fstatSync(descriptor);
    if (!opened.isFile()) {
      throw new ProjectPathError('not_regular_file', {
        input: filePath,
        projectRoot: before.projectRoot,
        target: before.real,
      });
    }
    const current = revalidateProjectTarget(
      projectRoot,
      filePath,
      expectedTarget || before,
      { fileSystem },
    );
    const named = fileSystem.statSync(current.real);
    if (opened.dev !== named.dev || opened.ino !== named.ino) {
      throw changedTargetError(before, current, filePath);
    }
  } finally {
    fileSystem.closeSync(descriptor);
  }

  const directory = path.dirname(before.real);
  let removed = false;
  let directoryDescriptor = null;
  try {
    revalidateProjectTarget(projectRoot, filePath, expectedTarget || before, { fileSystem });
    fileSystem.unlinkSync(before.real);
    removed = true;
    if (typeof fileSystem.fsyncSync !== 'function') {
      const unsupported = new Error('Filesystem does not expose fsyncSync');
      unsupported.code = 'ENOTSUP';
      throw unsupported;
    }
    const directoryOnly = fileSystem.constants?.O_DIRECTORY ?? fs.constants.O_DIRECTORY ?? 0;
    directoryDescriptor = fileSystem.openSync(directory, readOnly | directoryOnly);
    fileSystem.fsyncSync(directoryDescriptor);
    fileSystem.closeSync(directoryDescriptor);
    directoryDescriptor = null;
  } catch (error) {
    if (directoryDescriptor !== null) {
      try { fileSystem.closeSync(directoryDescriptor); } catch { /* best effort */ }
    }
    if (removed) throw new ProjectDeleteDurabilityError(filePath, directory, error);
    throw error;
  }
  return before;
}

export default {
  ProjectPathError,
  ProjectDeleteDurabilityError,
  ProjectWriteDurabilityError,
  deleteProjectFileDurable,
  isProjectPathError,
  resolveProjectTarget,
  revalidateProjectTarget,
  readProjectFile,
  readProjectFileBytes,
  writeProjectFileAtomic,
};
