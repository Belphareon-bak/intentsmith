// tests/e2e/_e2e-state.js — Persistent state for multi-phase E2E suites
// ══════════════════════════════════════════════════════════════════════════════
// State is stored only below the runner-owned INTENTSMITH_TEST_ARTIFACT_DIR.
// Atomic writes (exclusive tmp + fsync + rename) prevent corruption on crash.
// ══════════════════════════════════════════════════════════════════════════════

import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const ARTIFACT_ROOT_ENV = 'INTENTSMITH_TEST_ARTIFACT_DIR';
const SOURCE_REVISION_ENV = 'INTENTSMITH_TEST_SOURCE_REVISION';
const PRIVATE_ROOT_COMPONENT = '.intentsmith-artifacts';
const SUITE_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;
const SOURCE_REVISION_RE = /^[a-f0-9]{40}$/;
const STATE_SCHEMA_VERSION = 1;

function assertSuiteId(suiteId) {
  if (typeof suiteId !== 'string' || !SUITE_ID_RE.test(suiteId)) {
    throw new Error(`Unsafe E2E suite id: ${String(suiteId)}`);
  }
}

function sourceRevision() {
  const revision = process.env[SOURCE_REVISION_ENV];
  if (!SOURCE_REVISION_RE.test(revision || '')) {
    throw new Error(`${SOURCE_REVISION_ENV} must be the exact 40-character source SHA`);
  }
  return revision;
}

function assertPrivateArtifactRoot(configuredRoot) {
  if (!configuredRoot) {
    throw new Error(`${ARTIFACT_ROOT_ENV} is required for persistent E2E state`);
  }
  if (!isAbsolute(configuredRoot)) {
    throw new Error(`${ARTIFACT_ROOT_ENV} must be an absolute path`);
  }

  const artifactRoot = resolve(configuredRoot);
  const parts = artifactRoot.split(sep).filter(Boolean);
  const markerIndex = parts.indexOf(PRIVATE_ROOT_COMPONENT);
  if (markerIndex === -1) {
    throw new Error(
      `${ARTIFACT_ROOT_ENV} must be inside a ${PRIVATE_ROOT_COMPONENT} directory: ${artifactRoot}`,
    );
  }

  return { artifactRoot, parts, markerIndex };
}

function assertNoSymlinkFromPrivateMarker(artifactRoot, parts, markerIndex) {
  let current = artifactRoot.startsWith(sep) ? sep : '';
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    if (index < markerIndex) continue;
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`E2E artifact path must not contain symlinks: ${current}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`E2E artifact path component is not a directory: ${current}`);
    }
  }
}

function resolveStateDir() {
  const root = assertPrivateArtifactRoot(process.env[ARTIFACT_ROOT_ENV]);
  assertNoSymlinkFromPrivateMarker(root.artifactRoot, root.parts, root.markerIndex);
  mkdirSync(root.artifactRoot, { recursive: true, mode: 0o700 });
  chmodSync(root.artifactRoot, 0o700);
  assertNoSymlinkFromPrivateMarker(root.artifactRoot, root.parts, root.markerIndex);

  const stateDir = join(root.artifactRoot, 'e2e-state');
  const stateRelative = relative(root.artifactRoot, stateDir);
  if (!stateRelative || stateRelative.startsWith('..') || isAbsolute(stateRelative)) {
    throw new Error(`E2E state directory escaped the artifact root: ${stateDir}`);
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const stateStat = lstatSync(stateDir);
  if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) {
    throw new Error(`Unsafe E2E state directory: ${stateDir}`);
  }
  chmodSync(stateDir, 0o700);
  return stateDir;
}

function statePath(suiteId) {
  assertSuiteId(suiteId);
  return join(resolveStateDir(), `${suiteId}.json`);
}

function assertRegularStateFile(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe E2E state file: ${path}`);
  }
  return true;
}

/** Load persisted state for a suite. Returns parsed JSON or null. */
export function loadState(suiteId) {
  const path = statePath(suiteId);
  if (!assertRegularStateFile(path)) return null;
  let state;
  try {
    state = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Corrupt E2E state JSON for ${suiteId}: ${error.message}`);
    }
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  validateState(suiteId, state);
  return state;
}

function removeTempFile(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

/** Save state atomically (exclusive write + fsync + rename). */
export function saveState(suiteId, state) {
  validateState(suiteId, state);
  const json = JSON.stringify(state, null, 2);
  if (json === undefined) {
    throw new TypeError('E2E state must be JSON-serializable');
  }
  const serialized = `${json}\n`;
  const path = statePath(suiteId);
  assertRegularStateFile(path);
  const tmp = join(
    resolveStateDir(),
    `.${suiteId}.${process.pid}.${randomUUID()}.tmp`,
  );
  let fd;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    writeFileSync(fd, serialized, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    chmodSync(path, 0o600);
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
    removeTempFile(tmp);
    throw error;
  }
}

/** Remove state file entirely. */
export function clearState(suiteId) {
  const path = statePath(suiteId);
  if (!assertRegularStateFile(path)) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

/** Remove all persisted E2E state below the runner-owned artifact root. */
export function cleanupAllStates() {
  const stateDir = resolveStateDir();
  rmSync(stateDir, { recursive: true, force: true });
}

/** Invalidate phase N and all subsequent phases.
 *  If phase 1 is cleared, also resets convId/projectId (next P1 creates fresh). */
export function clearPhase(suiteId, phaseNum) {
  const state = loadState(suiteId);
  if (!state) return;
  for (let i = phaseNum; i <= 10; i++) {
    delete state.phases[`p${i}`];
  }
  if (phaseNum === 1) {
    state.convId = null;
    state.projectId = null;
    state.projectPath = null;
  }
  saveState(suiteId, state);
}

/** Check if a specific phase completed successfully. */
export function isPhaseComplete(suiteId, phaseNum) {
  const state = loadState(suiteId);
  return state?.phases?.[`p${phaseNum}`]?.completed === true;
}

/** Create initial state for a new suite run. */
export function initState(suiteId) {
  const state = {
    schemaVersion: STATE_SCHEMA_VERSION,
    suiteId,
    sourceRevision: sourceRevision(),
    convId: null,
    projectId: null,
    projectPath: null,
    startedAt: new Date().toISOString(),
    phases: {},
    codeBlocks: [],
    planText: '',
    context: '',
  };
  saveState(suiteId, state);
  return state;
}

function validateState(suiteId, state) {
  assertSuiteId(suiteId);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error(`Invalid E2E state object for ${suiteId}`);
  }
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported E2E state schema for ${suiteId}`);
  }
  if (state.suiteId !== suiteId) {
    throw new Error(`E2E state suite mismatch: ${String(state.suiteId)} !== ${suiteId}`);
  }
  const currentRevision = sourceRevision();
  if (state.sourceRevision !== currentRevision) {
    throw new Error(
      `E2E state source revision mismatch: ${String(state.sourceRevision)} !== ${currentRevision}`,
    );
  }
  if (!state.phases || typeof state.phases !== 'object' || Array.isArray(state.phases)) {
    throw new Error(`Invalid E2E phase state for ${suiteId}`);
  }

  const completed = [];
  for (const [phase, value] of Object.entries(state.phases)) {
    const match = phase.match(/^p([1-9]|10)$/);
    if (!match || !value || typeof value !== 'object' || value.completed !== true) {
      throw new Error(`Invalid completed phase record ${phase} for ${suiteId}`);
    }
    completed.push(Number(match[1]));
  }
  completed.sort((left, right) => left - right);
  for (let index = 0; index < completed.length; index++) {
    if (completed[index] !== index + 1) {
      throw new Error(`E2E phase chain is not contiguous for ${suiteId}`);
    }
  }
}
