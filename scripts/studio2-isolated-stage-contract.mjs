// Pure filesystem preflight for the isolated Studio 2 staging runner.
// Importing this module cannot start a provider, service, or database writer.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
export const PRESERVED_TABLES = Object.freeze([
  'conversations', 'messages', 'projects', 'expertises',
  'model_overrides', 'model_evaluation_runs',
]);
const REQUIRED_PACKAGE_FILES = Object.freeze([
  'SOURCE.json',
  'IntentSmith-Studio2.AppImage',
  'runtime/bin/node',
  'source/src/server.js',
  'source/scripts/studio2-copy-user-data.cjs',
  'source/scripts/studio2-isolated-stage.mjs',
  'source/intentsmith-ide/applications/electron/intentsmith-local-access.js',
]);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function absolute(value, code) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) fail(code);
  return value;
}

function statRegular(file, code) {
  let stat;
  try { stat = fs.lstatSync(file); } catch { fail(code); }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) fail(code);
  return stat;
}

function statDirectory(dir, code) {
  let stat;
  try { stat = fs.lstatSync(dir); } catch { fail(code); }
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(dir) !== dir) fail(code);
  return stat;
}

function inside(parent, candidate) {
  return candidate === parent || candidate.startsWith(parent + path.sep);
}

function pathExistsIncludingDanglingSymlink(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function listFiles(folder, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(folder, prefix), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) result.push(...listFiles(folder, relative));
    else if (entry.isFile()) result.push(relative);
    else fail('PACKAGE_NONPORTABLE_ENTRY');
  }
  return result;
}

function digest(file) {
  // Staging packages are sealed by the packager. A synchronous streaming
  // digest keeps the preflight bounded in memory even for a large AppImage.
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

export function parseStageArgs(argv) {
  const options = { mode: 'preflight', gpuAuthorized: false };
  const names = new Map([
    ['--package', 'packageDir'], ['--db', 'sourceDb'],
    ['--trial-root', 'trialRoot'], ['--legacy-source', 'legacySource'],
    ['--legacy-node', 'legacyNode'], ['--expected-source', 'expectedSource'],
    ['--expected-appimage', 'expectedAppImage'], ['--expected-legacy', 'expectedLegacy'],
    ['--min-free-vram-mib', 'minFreeVramMiB'],
  ]);
  const seen = new Set();
  for (const arg of argv) {
    if (arg === '--help') return { help: true };
    if (arg === '--live' && !seen.has('--live')) { options.mode = 'live'; seen.add('--live'); continue; }
    if (arg === '--gpu-authorized' && !seen.has('--gpu-authorized')) {
      options.gpuAuthorized = true; seen.add('--gpu-authorized'); continue;
    }
    const equals = arg.indexOf('=');
    const key = equals > 0 ? arg.slice(0, equals) : arg;
    if (!names.has(key) || seen.has(key) || equals < 0 || !arg.slice(equals + 1)) fail('STAGE_ARGUMENT_INVALID');
    seen.add(key);
    options[names.get(key)] = arg.slice(equals + 1);
  }
  if (options.mode === 'live' && !options.gpuAuthorized) fail('GPU_AUTHORIZATION_REQUIRED');
  if (options.mode !== 'live' && options.gpuAuthorized) fail('GPU_AUTHORIZATION_REQUIRES_LIVE');
  for (const field of names.values()) {
    if (field !== 'minFreeVramMiB' && !options[field]) fail('STAGE_ARGUMENT_MISSING');
  }
  if (options.mode === 'live') {
    if (!/^[1-9][0-9]*$/.test(options.minFreeVramMiB || '')) fail('VRAM_THRESHOLD_REQUIRED');
    options.minFreeVramMiB = Number(options.minFreeVramMiB);
    if (!Number.isSafeInteger(options.minFreeVramMiB) || options.minFreeVramMiB < 1024) fail('VRAM_THRESHOLD_INVALID');
  } else if (options.minFreeVramMiB !== undefined) fail('VRAM_THRESHOLD_REQUIRES_LIVE');
  if (!SHA40.test(options.expectedSource) || !SHA40.test(options.expectedLegacy)
    || !SHA64.test(options.expectedAppImage)) fail('STAGE_DIGEST_INVALID');
  return options;
}

export async function preflightStage(options) {
  const packageDir = absolute(options.packageDir, 'PACKAGE_PATH_INVALID');
  const sourceDb = absolute(options.sourceDb, 'SOURCE_DB_PATH_INVALID');
  const trialRoot = absolute(options.trialRoot, 'TRIAL_ROOT_PATH_INVALID');
  if (Buffer.byteLength(path.join(trialRoot, 'tmp')) > 72) fail('TRIAL_ROOT_TOO_LONG_FOR_CHROMIUM');
  const legacySource = absolute(options.legacySource, 'LEGACY_SOURCE_PATH_INVALID');
  const legacyNode = absolute(options.legacyNode, 'LEGACY_NODE_PATH_INVALID');
  if (!SHA40.test(options.expectedSource || '') || !SHA40.test(options.expectedLegacy || '')
    || !SHA64.test(options.expectedAppImage || '')) fail('STAGE_DIGEST_INVALID');
  const pkgStat = statDirectory(packageDir, 'PACKAGE_DIRECTORY_INVALID');
  if (pkgStat.uid !== process.getuid() || (pkgStat.mode & 0o077)) fail('PACKAGE_DIRECTORY_UNSAFE');
  statDirectory(legacySource, 'LEGACY_SOURCE_INVALID');
  statRegular(path.join(legacySource, 'intentsmith-ide/applications/electron/scripts/launch.js'), 'LEGACY_LAUNCH_MISSING');
  statRegular(path.join(legacySource, 'intentsmith-ide/applications/electron/lib/frontend/index.html'),
    'LEGACY_FRONTEND_MISSING');
  const legacyNodeStat = statRegular(legacyNode, 'LEGACY_NODE_INVALID');
  if (!(legacyNodeStat.mode & 0o111)) fail('LEGACY_NODE_INVALID');
  let legacyRevision, legacyDirty, legacyBranch;
  try {
    const cleanGitEnvironment = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !key.startsWith('GIT_')));
    cleanGitEnvironment.GIT_CONFIG_NOSYSTEM = '1';
    cleanGitEnvironment.GIT_CONFIG_GLOBAL = '/dev/null';
    const gitOptions = { encoding: 'utf8', env: cleanGitEnvironment, timeout: 15_000 };
    legacyRevision = execFileSync('git', ['-C', legacySource, 'rev-parse', 'HEAD'], gitOptions).trim();
    legacyDirty = execFileSync('git', ['-C', legacySource, 'status', '--porcelain'], gitOptions).trim();
    legacyBranch = execFileSync('git', ['-C', legacySource, 'branch', '--show-current'], gitOptions).trim();
  } catch { fail('LEGACY_SOURCE_UNATTESTED'); }
  if (legacyRevision !== options.expectedLegacy || legacyDirty || legacyBranch) fail('LEGACY_SOURCE_UNATTESTED');
  statRegular(sourceDb, 'SOURCE_DB_SYMLINK');
  if (fs.realpathSync(sourceDb) !== sourceDb) fail('SOURCE_DB_SYMLINK');
  const header = Buffer.alloc(16);
  const fd = fs.openSync(sourceDb, 'r');
  try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
  if (header.toString('binary') !== 'SQLite format 3\0') fail('SOURCE_DB_INVALID');
  if (pathExistsIncludingDanglingSymlink(trialRoot)) fail('TRIAL_ROOT_EXISTS');
  if (inside(packageDir, trialRoot) || inside(legacySource, trialRoot)
    || inside(path.dirname(sourceDb), trialRoot)) fail('TRIAL_ROOT_UNSAFE');
  const trialParent = path.dirname(trialRoot);
  const parentStat = statDirectory(trialParent, 'TRIAL_PARENT_SYMLINK');
  if (parentStat.uid !== process.getuid() || (parentStat.mode & 0o022)) fail('TRIAL_PARENT_UNSAFE');
  const sumsPath = path.join(packageDir, 'SHA256SUMS');
  const rows = fs.readFileSync(sumsPath, 'utf8').trimEnd().split('\n');
  const entries = new Map();
  for (const row of rows) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(row);
    if (!match) fail('PACKAGE_MANIFEST_INVALID');
    const relative = match[2];
    if (relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')
      || relative === 'SHA256SUMS' || entries.has(relative)) fail('PACKAGE_MANIFEST_INVALID');
    entries.set(relative, match[1]);
  }
  for (const required of REQUIRED_PACKAGE_FILES) if (!entries.has(required)) fail('PACKAGE_MANIFEST_INCOMPLETE');
  const actual = listFiles(packageDir).filter(file => file !== 'SHA256SUMS');
  if (actual.length !== entries.size || actual.some(file => !entries.has(file))) fail('PACKAGE_UNLISTED_FILE');
  for (const [relative, expected] of entries) {
    const file = path.join(packageDir, relative);
    if (digest(file) !== expected) fail('PACKAGE_DIGEST_MISMATCH');
  }
  const source = JSON.parse(fs.readFileSync(path.join(packageDir, 'SOURCE.json'), 'utf8'));
  if (source.sourceRevision !== options.expectedSource
    || !Number.isSafeInteger(source.trackedFilesVerified) || source.trackedFilesVerified <= 0
    || !String(source.node).startsWith('24.')) fail('SOURCE_REVISION_MISMATCH');
  const appImageSha256 = entries.get('IntentSmith-Studio2.AppImage');
  if (appImageSha256 !== options.expectedAppImage) fail('APPIMAGE_DIGEST_MISMATCH');
  const appImage = path.join(packageDir, 'IntentSmith-Studio2.AppImage');
  if (!(fs.statSync(appImage).mode & 0o111)) fail('APPIMAGE_NOT_EXECUTABLE');
  const runtimeNode = path.join(packageDir, 'runtime/bin/node');
  if (!(fs.statSync(runtimeNode).mode & 0o111)) fail('RUNTIME_NODE_NOT_EXECUTABLE');
  return Object.freeze({
    mode: options.mode || 'preflight', sourceRevision: source.sourceRevision,
    appImageSha256, legacyRevision, packageDir, sourceDb, trialRoot,
    legacySource, legacyNode, runtimeNode, appImage, fileCount: entries.size,
  });
}

export function assertIsolatedProjectPath({ trialRoot, projectPath }) {
  const expectedParent = path.join(trialRoot, 'home', 'projects');
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)
    || path.dirname(projectPath) !== expectedParent) fail('PROJECT_PATH_OUTSIDE_TRIAL');
  const real = fs.realpathSync(projectPath);
  if (real !== projectPath || fs.lstatSync(projectPath).isSymbolicLink()) fail('PROJECT_PATH_SYMLINK');
  if (!fs.lstatSync(projectPath).isDirectory()) fail('PROJECT_PATH_INVALID');
  return projectPath;
}

function stableRows(rows, table, { allowVerificationChange = false, originalKeys = null } = {}) {
  return rows.map(row => {
    let stable;
    if (table === 'projects') {
      const { last_active, ...rest } = row;
      stable = rest;
    } else if (table === 'model_overrides' && allowVerificationChange) {
      const { verification_status, verified, ...rest } = row;
      stable = rest;
    } else {
      stable = row;
    }
    if (!originalKeys) return stable;
    for (const key of originalKeys) {
      if (!Object.hasOwn(stable, key)) fail('PRESERVED_COLUMN_MISSING');
    }
    return Object.fromEntries(originalKeys.map(key => [key, stable[key]]));
  });
}

export function assertPreserved(before, after, { allowNew = false, allowVerificationChange = false } = {}) {
  const counts = {};
  for (const table of PRESERVED_TABLES) {
    if (!Array.isArray(before?.[table]) || !Array.isArray(after?.[table])) fail('PRESERVED_TABLE_MISSING');
    const original = stableRows(before[table], table, { allowVerificationChange });
    const keys = [...new Set(original.flatMap(row => Object.keys(row)))];
    const current = stableRows(after[table], table, { allowVerificationChange, originalKeys: keys });
    if (!allowNew && current.length !== original.length) fail('PRESERVED_ROW_COUNT_CHANGED');
    const present = new Map();
    for (const row of current) {
      const key = JSON.stringify(row);
      present.set(key, (present.get(key) || 0) + 1);
    }
    for (const row of original) {
      const key = JSON.stringify(row), remaining = present.get(key) || 0;
      if (remaining <= 0) fail('PRESERVED_ROW_CHANGED');
      present.set(key, remaining - 1);
    }
    counts[table] = { before: original.length, after: current.length };
  }
  return counts;
}

// A copied production database still names original project directories. The
// backend's startup and periodic recovery loops must have no imported work to
// execute before we allow the private backend to start.
export function assertNoImportedStartupEffects(db) {
  let automaticScmPolicies, recoverableM2Operations, outstandingModelPulls;
  try {
    automaticScmPolicies = db.prepare(`SELECT count(*) AS n FROM scm_project_policy
      WHERE fetch_mode = 'automatic' OR pull_mode = 'automatic'`).get().n;
    recoverableM2Operations = db.prepare(`SELECT count(*) AS n FROM m2_lifecycle_operations operation
      LEFT JOIN m2_lifecycle_terminals terminal USING (lifecycle_id)
      WHERE terminal.lifecycle_id IS NULL`).get().n;
    outstandingModelPulls = db.prepare(`SELECT count(*) AS n FROM m6_model_artifact_operations operation
      LEFT JOIN m6_model_artifact_events initial
        ON initial.operation_id = operation.operation_id AND initial.sequence = 1
      LEFT JOIN m6_model_artifact_events settled
        ON settled.operation_id = operation.operation_id AND settled.sequence = 2
      WHERE operation.kind = 'PULL' AND (initial.event_id IS NULL
        OR (initial.status = 'ORPHANED' AND settled.event_id IS NULL))`).get().n;
  } catch { fail('COPIED_DB_STARTUP_GUARD_UNAVAILABLE'); }
  if (automaticScmPolicies) fail('IMPORTED_SCM_AUTOMATION_UNSAFE');
  if (recoverableM2Operations) fail('IMPORTED_M2_RECOVERY_UNSAFE');
  if (outstandingModelPulls) fail('IMPORTED_MODEL_PULL_UNSAFE');
  return { automaticScmPolicies, recoverableM2Operations, outstandingModelPulls };
}

export function assertDurableStageChat(db, { conversationId, projectId, prompt, answer, marker }) {
  if (typeof conversationId !== 'string' || !Number.isSafeInteger(projectId) || projectId <= 0
    || typeof prompt !== 'string' || typeof answer !== 'string' || typeof marker !== 'string'
    || !marker || !prompt.includes(marker) || !answer.includes(marker)) fail('MODEL_CHAT_NOT_DURABLE');
  const conversation = db.prepare('SELECT project_id FROM conversations WHERE id = ?').get(conversationId);
  if (conversation?.project_id !== projectId) fail('MODEL_CHAT_NOT_DURABLE');
  const turns = db.prepare(`SELECT id, role, content FROM messages
    WHERE conversation_id = ? ORDER BY id ASC`).all(conversationId);
  const user = turns.find(turn => turn.role === 'user' && turn.content === prompt);
  const assistant = user && turns.find(turn => turn.id > user.id
    && turn.role === 'assistant' && turn.content === answer);
  if (!assistant) fail('MODEL_CHAT_NOT_DURABLE');
  return { userTurnId: user.id, assistantTurnId: assistant.id };
}
