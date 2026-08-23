import { constants as fsConstants } from 'node:fs';
import {
  lstat as defaultLstat,
  open as defaultOpen,
  readdir as defaultReaddir,
  realpath as defaultRealpath,
  stat as defaultStat,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  PROJECT_CONTEXT_ERROR_CODE,
  canonicalizeProjectContextValue,
  isProjectContextProjectId,
} from '../../contracts/m2/project-context-v1.js';

export const PROJECT_CONTEXT_SOURCE_SET = 'ContextSourceSet@1';
export const PROJECT_CONTEXT_MANIFEST_VERSION = 1;

const MAX_REGULAR_FILE_BYTES = 1_048_576;
const MAX_DIRECTORY_DEPTH = 64;
const MAX_SCANNED_ENTRIES = 10_000;
const MAX_HASHED_BYTES = 512 * 1024 * 1024;

const IGNORED_DIRECTORIES = Object.freeze([
  '.cache',
  '.c3',
  '.git',
  '.intentsmith-artifacts',
  '.next',
  '.nuxt',
  '.tox',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'env',
  'node_modules',
  'target',
  'vendor',
  'venv',
]);

const INCLUDED_EXTENSIONS = Object.freeze([
  '.bash', '.c', '.cc', '.cjs', '.cpp', '.cs', '.css', '.go', '.h', '.hpp',
  '.html', '.java', '.js', '.json', '.jsx', '.kt', '.md', '.mjs', '.php',
  '.py', '.pyw', '.rb', '.rs', '.scala', '.scss', '.sh', '.sql', '.svelte',
  '.swift', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml',
]);

const INCLUDED_BASENAMES = Object.freeze([
  '.dockerignore', '.gitignore', 'Dockerfile', 'Jenkinsfile', 'LICENSE',
  'Makefile', 'Procfile', 'README',
]);

const ignoredDirectorySet = new Set(IGNORED_DIRECTORIES);
const includedExtensionSet = new Set(INCLUDED_EXTENSIONS);
const includedBasenameSet = new Set(INCLUDED_BASENAMES);
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export const PROJECT_CONTEXT_FILE_POLICY = Object.freeze({
  id: 'ContextFilePolicy@1',
  maxRegularFileBytes: MAX_REGULAR_FILE_BYTES,
  maxDirectoryDepth: MAX_DIRECTORY_DEPTH,
  maxScannedEntries: MAX_SCANNED_ENTRIES,
  maxHashedBytes: MAX_HASHED_BYTES,
  ignoredDirectories: IGNORED_DIRECTORIES,
  includedExtensions: INCLUDED_EXTENSIONS,
  includedBasenames: INCLUDED_BASENAMES,
  binaryDetector: 'utf8-fatal-or-nul@1',
  symlinkPolicy: 'internal-sentinel-external-error@1',
});

function manifestError(code, reason, options = {}) {
  return new ProjectContextManifestError(code, reason, options);
}

export class ProjectContextManifestError extends Error {
  constructor(code, reason, options = {}) {
    super('Project context source manifest could not be observed safely.', options);
    this.name = 'ProjectContextManifestError';
    this.code = code;
    this.reason = reason;
  }
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isCanonicalAbsoluteRoot(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\0')
    && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value;
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function toRelativePosix(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (
    relative.length === 0
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'path-outside-root');
  }
  const normalized = relative.split(path.sep).join('/');
  if (
    normalized.includes('\0')
    || path.posix.isAbsolute(normalized)
    || path.posix.normalize(normalized) !== normalized
  ) {
    throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INTERNAL, 'noncanonical-relative-path');
  }
  return normalized;
}

function isIncludedFile(name) {
  return includedBasenameSet.has(name)
    || includedExtensionSet.has(path.extname(name).toLowerCase());
}

function checkInvocation(invocationContext, now) {
  const { signal, deadlineAt } = invocationContext;
  if (signal?.aborted) {
    const timeout = signal.reason?.abortSource === 'timeout'
      || signal.reason?.name === 'TimeoutError';
    throw manifestError(
      timeout
        ? PROJECT_CONTEXT_ERROR_CODE.TIMEOUT
        : PROJECT_CONTEXT_ERROR_CODE.CANCELLED,
      timeout ? 'deadline-aborted' : 'caller-aborted',
    );
  }
  if (deadlineAt !== undefined) {
    if (!Number.isFinite(deadlineAt)) {
      throw new TypeError('project-context-manifest:invalid-deadlineAt');
    }
    if (now() >= deadlineAt) {
      throw manifestError(PROJECT_CONTEXT_ERROR_CODE.TIMEOUT, 'deadline-elapsed');
    }
  }
}

function mapOperationError(error, invocationContext, now, reason) {
  if (error instanceof ProjectContextManifestError) return error;
  try {
    checkInvocation(invocationContext, now);
  } catch (controlError) {
    return controlError;
  }
  return manifestError(PROJECT_CONTEXT_ERROR_CODE.INTERNAL, reason, { cause: error });
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function verifyExactRealpath(absolutePath, root, operations, invocationContext, now) {
  checkInvocation(invocationContext, now);
  let resolved;
  try {
    resolved = await operations.realpath(absolutePath);
  } catch (error) {
    throw mapOperationError(error, invocationContext, now, 'realpath-failed');
  }
  checkInvocation(invocationContext, now);
  if (!isInsideRoot(root, resolved)) {
    throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'path-resolves-outside-root');
  }
  if (resolved !== absolutePath) {
    throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'noncanonical-path-component');
  }
  return resolved;
}

async function readStableRegularFile(
  absolutePath,
  initialStat,
  root,
  operations,
  invocationContext,
  now,
) {
  await verifyExactRealpath(absolutePath, root, operations, invocationContext, now);

  let handle;
  try {
    handle = await operations.open(
      absolutePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const openedStat = await handle.stat();
    const currentPathStat = await operations.stat(absolutePath);
    await verifyExactRealpath(absolutePath, root, operations, invocationContext, now);
    if (
      !openedStat.isFile()
      || !Number.isSafeInteger(openedStat.size)
      || openedStat.size < 0
      || !sameFileIdentity(initialStat, openedStat)
      || !sameFileIdentity(openedStat, currentPathStat)
    ) {
      throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INTERNAL, 'file-changed-before-read');
    }

    if (openedStat.size > MAX_REGULAR_FILE_BYTES) {
      return Object.freeze({
        kind: 'oversize@1',
        size: openedStat.size,
        sentinel: `max-bytes:${MAX_REGULAR_FILE_BYTES}`,
      });
    }

    checkInvocation(invocationContext, now);
    const bytes = await handle.readFile({ signal: invocationContext.signal });
    checkInvocation(invocationContext, now);
    const finalStat = await handle.stat();
    if (
      !sameFileIdentity(openedStat, finalStat)
      || finalStat.size !== openedStat.size
      || bytes.length !== openedStat.size
    ) {
      throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INTERNAL, 'file-changed-during-read');
    }

    const contentDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    let binary = bytes.includes(0);
    if (!binary) {
      try {
        utf8Decoder.decode(bytes);
      } catch {
        binary = true;
      }
    }
    if (binary) {
      return Object.freeze({
        kind: 'binary@1',
        size: bytes.length,
        sentinel: PROJECT_CONTEXT_FILE_POLICY.binaryDetector,
      });
    }
    return Object.freeze({ kind: 'regular@1', size: bytes.length, contentDigest });
  } catch (error) {
    throw mapOperationError(error, invocationContext, now, 'file-read-failed');
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function describeSymlink(
  absolutePath,
  relativePath,
  root,
  operations,
  invocationContext,
  now,
) {
  checkInvocation(invocationContext, now);
  let target;
  try {
    target = await operations.realpath(absolutePath);
  } catch (error) {
    throw mapOperationError(error, invocationContext, now, 'symlink-unresolvable');
  }
  checkInvocation(invocationContext, now);
  if (!isInsideRoot(root, target)) {
    throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'symlink-outside-root');
  }
  const targetPath = path.relative(root, target).split(path.sep).join('/') || '@root';
  return Object.freeze({
    path: relativePath,
    kind: 'symlink-excluded@1',
    size: 0,
    sentinel: targetPath,
  });
}

function appendLengthPrefixed(chunks, value) {
  const bytes = Buffer.from(String(value), 'utf8');
  chunks.push(Buffer.from(`${bytes.length}:`, 'ascii'), bytes, Buffer.from(';', 'ascii'));
}

export function computeProjectContextWorkspaceRevision(projectId, entries) {
  if (!isProjectContextProjectId(projectId) || !Array.isArray(entries)) {
    throw new TypeError('project-context-manifest:invalid-revision-input');
  }
  const chunks = [];
  appendLengthPrefixed(chunks, PROJECT_CONTEXT_SOURCE_SET);
  appendLengthPrefixed(chunks, PROJECT_CONTEXT_MANIFEST_VERSION);
  appendLengthPrefixed(chunks, canonicalizeProjectContextValue(PROJECT_CONTEXT_FILE_POLICY));
  appendLengthPrefixed(chunks, projectId);
  appendLengthPrefixed(chunks, entries.length);
  for (const entry of entries) {
    appendLengthPrefixed(chunks, entry.path);
    appendLengthPrefixed(chunks, entry.kind);
    appendLengthPrefixed(chunks, entry.size);
    appendLengthPrefixed(chunks, entry.contentDigest ?? entry.sentinel);
  }
  return `wsr1:${createHash('sha256').update(Buffer.concat(chunks)).digest('hex')}`;
}

export async function buildProjectContextManifest(
  scope,
  invocationContext = {},
  dependencies = {},
) {
  if (!isProjectContextProjectId(scope?.projectId)) {
    throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'invalid-project-id');
  }
  if (!isCanonicalAbsoluteRoot(scope?.canonicalRoot)) {
    throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'noncanonical-root');
  }
  if (invocationContext === null || typeof invocationContext !== 'object') {
    throw new TypeError('project-context-manifest:invalid-invocation-context');
  }

  const operations = {
    lstat: dependencies.lstat ?? defaultLstat,
    open: dependencies.open ?? defaultOpen,
    readdir: dependencies.readdir ?? defaultReaddir,
    realpath: dependencies.realpath ?? defaultRealpath,
    stat: dependencies.stat ?? defaultStat,
  };
  const now = dependencies.now ?? Date.now;
  if (Object.values(operations).some(operation => typeof operation !== 'function')) {
    throw new TypeError('project-context-manifest:invalid-filesystem-dependency');
  }
  if (typeof now !== 'function') {
    throw new TypeError('project-context-manifest:invalid-now-dependency');
  }

  const root = scope.canonicalRoot;
  await verifyExactRealpath(root, root, operations, invocationContext, now);
  let rootStat;
  try {
    rootStat = await operations.lstat(root);
  } catch (error) {
    throw mapOperationError(error, invocationContext, now, 'root-stat-failed');
  }
  if (!rootStat.isDirectory()) {
    throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INVALID_SCOPE, 'root-not-directory');
  }

  const entries = [];
  const counters = { scannedEntries: 0, hashedBytes: 0 };

  async function walk(directory, depth) {
    checkInvocation(invocationContext, now);
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw manifestError(PROJECT_CONTEXT_ERROR_CODE.SCAN_LIMIT, 'directory-depth-exceeded');
    }
    await verifyExactRealpath(directory, root, operations, invocationContext, now);

    let children;
    try {
      children = await operations.readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw mapOperationError(error, invocationContext, now, 'directory-read-failed');
    }
    children.sort((left, right) => compareUtf8(left.name, right.name));

    for (const child of children) {
      checkInvocation(invocationContext, now);
      counters.scannedEntries += 1;
      if (counters.scannedEntries > MAX_SCANNED_ENTRIES) {
        throw manifestError(PROJECT_CONTEXT_ERROR_CODE.SCAN_LIMIT, 'entry-count-exceeded');
      }
      if (
        typeof child.name !== 'string'
        || child.name.length === 0
        || child.name.includes('\0')
        || child.name.includes('/')
      ) {
        throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INTERNAL, 'invalid-directory-entry-name');
      }

      const absolutePath = path.join(directory, child.name);
      const relativePath = toRelativePosix(root, absolutePath);
      let entryStat;
      try {
        entryStat = await operations.lstat(absolutePath);
      } catch (error) {
        throw mapOperationError(error, invocationContext, now, 'entry-stat-failed');
      }

      if (entryStat.isSymbolicLink()) {
        entries.push(await describeSymlink(
          absolutePath,
          relativePath,
          root,
          operations,
          invocationContext,
          now,
        ));
      } else if (entryStat.isDirectory()) {
        if (!ignoredDirectorySet.has(child.name)) {
          await walk(absolutePath, depth + 1);
        }
      } else if (entryStat.isFile()) {
        if (!isIncludedFile(child.name)) continue;
        const description = await readStableRegularFile(
          absolutePath,
          entryStat,
          root,
          operations,
          invocationContext,
          now,
        );
        if (description.kind === 'regular@1') {
          counters.hashedBytes += description.size;
          if (counters.hashedBytes > MAX_HASHED_BYTES) {
            throw manifestError(PROJECT_CONTEXT_ERROR_CODE.SCAN_LIMIT, 'hashed-bytes-exceeded');
          }
        }
        entries.push(Object.freeze({ path: relativePath, ...description }));
      } else {
        throw manifestError(PROJECT_CONTEXT_ERROR_CODE.INTERNAL, 'unsupported-entry-type');
      }
    }
  }

  await walk(root, 0);
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  const frozenEntries = Object.freeze(entries);
  const revision = computeProjectContextWorkspaceRevision(scope.projectId, frozenEntries);
  return Object.freeze({
    sourceSet: PROJECT_CONTEXT_SOURCE_SET,
    manifestVersion: PROJECT_CONTEXT_MANIFEST_VERSION,
    filePolicy: PROJECT_CONTEXT_FILE_POLICY.id,
    projectId: scope.projectId,
    revision,
    entries: frozenEntries,
    stats: Object.freeze({ ...counters, observableEntries: frozenEntries.length }),
  });
}
