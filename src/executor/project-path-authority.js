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
 * Atomically replace one in-project file after revalidating the read/preflight
 * target.  Existing mode bits are retained.  Temp data is fsync'd before the
 * rename; any failed attempt removes only its own unique temp file. Parent
 * directories are never created implicitly: Node does not expose a portable
 * openat2/dirfd mkdir primitive, so recursive path-based mkdir would introduce
 * an effect before a post-check could detect a symlink swap.
 */
export function writeProjectFileAtomic(projectRoot, filePath, content, {
  expectedTarget = null,
  fileSystem = fs,
} = {}) {
  const before = resolveProjectTarget(projectRoot, filePath, { fileSystem });
  if (expectedTarget && !sameTarget(expectedTarget, before)) {
    throw changedTargetError(expectedTarget, before, filePath);
  }

  const directory = path.dirname(before.real);
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
  }

  const tempPath = `${current.real}.intentsmith-${process.pid}-${randomUUID()}.tmp`;
  let descriptor = null;
  let directoryDescriptor = null;
  let renamed = false;
  try {
    descriptor = fileSystem.openSync(tempPath, 'wx', mode);
    // `open` applies the process umask.  Existing target permissions are an
    // invariant, so restore the exact observed mode on the already-open temp.
    if (preserveMode && typeof fileSystem.fchmodSync === 'function') {
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

export default {
  ProjectPathError,
  ProjectWriteDurabilityError,
  isProjectPathError,
  resolveProjectTarget,
  revalidateProjectTarget,
  readProjectFile,
  writeProjectFileAtomic,
};
