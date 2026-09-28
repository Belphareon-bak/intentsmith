import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';

import {
  M6_RELEASE_ARTIFACT_CONTRACT,
  M6_RELEASE_ARTIFACT_REQUIRED_FILES,
  M6_RELEASE_ARTIFACT_VERSION,
} from '../../contracts/m6/release-artifact-v1.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\\')
    && !value.includes('\0')
    && !path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && value !== '..'
    && !value.startsWith('../');
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertRegularContainedFile(root, relativePath, label) {
  if (!safeRelativePath(relativePath)) throw new Error(`${label}:unsafe-path`);
  const rootReal = await realpath(root);
  const target = path.join(root, relativePath);
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error(`${label}:not-nonempty-regular-file`);
  }
  const targetReal = await realpath(target);
  const relative = path.relative(rootReal, targetReal);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`${label}:outside-root`);
  }
  return { target, metadata };
}

export async function captureM6ReleaseArtifact({
  sourceRoot,
  outputRoot,
  candidateSha,
  sourceTreeClean,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!SHA_PATTERN.test(candidateSha || '')) throw new TypeError('m6-artifact:invalid-candidate');
  if (sourceTreeClean !== true) throw new Error('m6-artifact:dirty-source');
  if (!Number.isFinite(Date.parse(generatedAt))) throw new TypeError('m6-artifact:invalid-time');
  const outputRelative = path.relative(sourceRoot, outputRoot).split(path.sep).join('/');
  if (!safeRelativePath(outputRelative)) throw new Error('m6-artifact:output-outside-source');
  await mkdir(path.dirname(outputRoot), { recursive: true, mode: 0o700 });
  await mkdir(outputRoot, { recursive: false, mode: 0o700 });
  const outputReal = await realpath(outputRoot);
  const sourceReal = await realpath(sourceRoot);
  const outputContainment = path.relative(sourceReal, outputReal);
  if (outputContainment === '' || outputContainment.startsWith(`..${path.sep}`)) {
    throw new Error('m6-artifact:output-outside-source');
  }

  const files = [];
  for (const definition of M6_RELEASE_ARTIFACT_REQUIRED_FILES) {
    const source = await assertRegularContainedFile(
      sourceRoot,
      definition.sourcePath,
      definition.role,
    );
    const sourceBytes = await readFile(source.target);
    const destinationRelative = `${outputRelative}/files/${definition.role}`;
    const destination = path.join(sourceRoot, destinationRelative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(source.target, destination);
    const mode = definition.executable ? 0o700 : 0o600;
    await chmod(destination, mode);
    const copied = await readFile(destination);
    if (digest(copied) !== digest(sourceBytes)) {
      throw new Error(`${definition.role}:copy-digest-mismatch`);
    }
    files.push({
      role: definition.role,
      sourcePath: definition.sourcePath,
      artifactPath: destinationRelative,
      bytes: copied.length,
      sha256: digest(copied),
      mode,
    });
  }
  return deepFreeze({
    contract: M6_RELEASE_ARTIFACT_CONTRACT,
    version: M6_RELEASE_ARTIFACT_VERSION,
    candidateSha,
    generatedAt,
    buildProfile: 'linux-x64-studio-production',
    installProfile: 'core-minimal-offline',
    files,
  });
}

export async function validateM6ReleaseArtifact(artifact, {
  root,
  candidateSha,
  sourceTreeClean,
} = {}) {
  const errors = [];
  if (artifact?.contract !== M6_RELEASE_ARTIFACT_CONTRACT) errors.push('artifact:contract');
  if (artifact?.version !== M6_RELEASE_ARTIFACT_VERSION) errors.push('artifact:version');
  if (artifact?.candidateSha !== candidateSha || !SHA_PATTERN.test(artifact?.candidateSha || '')) {
    errors.push('artifact:candidate');
  }
  if (sourceTreeClean !== true) errors.push('artifact:dirty-source');
  if (!Number.isFinite(Date.parse(artifact?.generatedAt))) errors.push('artifact:generatedAt');
  if (artifact?.buildProfile !== 'linux-x64-studio-production') errors.push('artifact:build-profile');
  if (artifact?.installProfile !== 'core-minimal-offline') errors.push('artifact:install-profile');
  const expected = new Map(M6_RELEASE_ARTIFACT_REQUIRED_FILES.map(item => [item.role, item]));
  if (!Array.isArray(artifact?.files) || artifact.files.length !== expected.size) {
    errors.push('artifact:exact-files');
  }
  const seen = new Set();
  for (const [index, file] of (artifact?.files || []).entries()) {
    const label = `artifact.files[${index}]`;
    if (seen.has(file?.role)) errors.push(`${label}:duplicate-role`);
    seen.add(file?.role);
    const definition = expected.get(file?.role);
    if (!definition) {
      errors.push(`${label}:unknown-role`);
      continue;
    }
    if (file.sourcePath !== definition.sourcePath) errors.push(`${label}:source-path`);
    if (!safeRelativePath(file.artifactPath)) errors.push(`${label}:artifact-path`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) errors.push(`${label}:bytes`);
    if (!SHA256_PATTERN.test(file.sha256 || '')) errors.push(`${label}:sha256`);
    const expectedMode = definition.executable ? 0o700 : 0o600;
    if (file.mode !== expectedMode) errors.push(`${label}:mode`);
    if (!safeRelativePath(file.artifactPath)) continue;
    try {
      const target = await assertRegularContainedFile(root, file.artifactPath, label);
      const bytes = await readFile(target.target);
      if (bytes.length !== file.bytes) errors.push(`${label}:byte-mismatch`);
      if (digest(bytes) !== file.sha256) errors.push(`${label}:digest-mismatch`);
      if ((target.metadata.mode & 0o777) !== expectedMode) errors.push(`${label}:disk-mode`);
    } catch (error) {
      errors.push(`${label}:${error.code === 'ENOENT' ? 'missing' : 'unreadable'}`);
    }
  }
  for (const role of expected.keys()) {
    if (!seen.has(role)) errors.push(`artifact:missing-role:${role}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}

export async function validateM6ReleaseArtifactGitBlobs(artifact, {
  candidateSha,
  readGitArtifact,
} = {}) {
  const errors = [];
  if (artifact?.contract !== M6_RELEASE_ARTIFACT_CONTRACT) errors.push('artifact:contract');
  if (artifact?.version !== M6_RELEASE_ARTIFACT_VERSION) errors.push('artifact:version');
  if (artifact?.candidateSha !== candidateSha || !SHA_PATTERN.test(artifact?.candidateSha || '')) {
    errors.push('artifact:candidate');
  }
  if (!Number.isFinite(Date.parse(artifact?.generatedAt))) errors.push('artifact:generatedAt');
  if (artifact?.buildProfile !== 'linux-x64-studio-production') errors.push('artifact:build-profile');
  if (artifact?.installProfile !== 'core-minimal-offline') errors.push('artifact:install-profile');
  if (typeof readGitArtifact !== 'function') errors.push('artifact:git-reader');
  const expected = new Map(M6_RELEASE_ARTIFACT_REQUIRED_FILES.map(item => [item.role, item]));
  if (!Array.isArray(artifact?.files) || artifact.files.length !== expected.size) {
    errors.push('artifact:exact-files');
  }
  const seen = new Set();
  for (const [index, file] of (artifact?.files || []).entries()) {
    const label = `artifact.files[${index}]`;
    if (seen.has(file?.role)) errors.push(`${label}:duplicate-role`);
    seen.add(file?.role);
    const definition = expected.get(file?.role);
    if (!definition) {
      errors.push(`${label}:unknown-role`);
      continue;
    }
    if (file.sourcePath !== definition.sourcePath) errors.push(`${label}:source-path`);
    if (!safeRelativePath(file.artifactPath)) errors.push(`${label}:artifact-path`);
    if (
      safeRelativePath(file.artifactPath)
      && !file.artifactPath.startsWith('docs/execution/runs/m6/')
    ) errors.push(`${label}:artifact-outside-git-evidence`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) errors.push(`${label}:bytes`);
    if (!SHA256_PATTERN.test(file.sha256 || '')) errors.push(`${label}:sha256`);
    const expectedMode = definition.executable ? 0o700 : 0o600;
    if (file.mode !== expectedMode) errors.push(`${label}:mode`);
    if (typeof readGitArtifact !== 'function' || !safeRelativePath(file.artifactPath)) continue;
    try {
      const gitArtifact = await readGitArtifact(file.artifactPath);
      if (!Buffer.isBuffer(gitArtifact?.bytes) || typeof gitArtifact?.executable !== 'boolean') {
        throw new Error('invalid-git-artifact');
      }
      if (gitArtifact.bytes.length !== file.bytes) errors.push(`${label}:byte-mismatch`);
      if (digest(gitArtifact.bytes) !== file.sha256) errors.push(`${label}:digest-mismatch`);
      if (gitArtifact.executable !== definition.executable) errors.push(`${label}:git-mode`);
    } catch {
      errors.push(`${label}:missing-or-unreadable-git-blob`);
    }
  }
  for (const role of expected.keys()) {
    if (!seen.has(role)) errors.push(`artifact:missing-role:${role}`);
  }
  return deepFreeze({ valid: errors.length === 0, errors });
}
