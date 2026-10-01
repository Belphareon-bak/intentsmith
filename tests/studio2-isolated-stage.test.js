import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

import {
  parseStageArgs,
  preflightStage,
  assertIsolatedProjectPath,
  PRESERVED_TABLES,
  assertPreserved,
  assertNoImportedStartupEffects,
  assertDurableStageChat,
} from '../scripts/studio2-isolated-stage-contract.mjs';

const SOURCE = 'a'.repeat(40);
const LEGACY = 'b'.repeat(40);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio2-stage-contract-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pkg = path.join(root, 'package');
  const legacySource = path.join(root, 'legacy');
  const db = path.join(root, 'production-data', 'production.sqlite');
  const trialRoot = path.join(root, 'trial');
  const node = path.join(pkg, 'runtime', 'bin', 'node');
  const appImage = path.join(pkg, 'IntentSmith-Studio2.AppImage');
  const files = {
    'SOURCE.json': JSON.stringify({ sourceRevision: SOURCE, trackedFilesVerified: 123, node: '24.21.0' }) + '\n',
    'IntentSmith-Studio2.AppImage': 'fixture AppImage bytes\n',
    'runtime/bin/node': 'fixture Node 24\n',
    'source/src/server.js': 'fixture server\n',
    'source/scripts/studio2-copy-user-data.cjs': 'fixture backup helper\n',
    'source/scripts/studio2-isolated-stage.mjs': 'fixture stage runner\n',
    'source/intentsmith-ide/applications/electron/intentsmith-local-access.js': 'fixture local access\n',
  };
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(pkg, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  }
  fs.chmodSync(pkg, 0o700);
  fs.chmodSync(node, 0o755);
  fs.chmodSync(appImage, 0o755);
  const sums = Object.entries(files).map(([relative, content]) =>
    `${sha256(content)}  ${relative}`).join('\n') + '\n';
  fs.writeFileSync(path.join(pkg, 'SHA256SUMS'), sums);
  fs.mkdirSync(path.join(legacySource, 'intentsmith-ide', 'applications', 'electron', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(legacySource, 'intentsmith-ide', 'applications', 'electron', 'scripts', 'launch.js'), 'fixture');
  fs.mkdirSync(path.join(legacySource, 'intentsmith-ide', 'applications', 'electron', 'lib', 'frontend'),
    { recursive: true });
  fs.writeFileSync(path.join(legacySource, 'intentsmith-ide', 'applications', 'electron', 'lib',
    'frontend', 'index.html'), '<html>Legacy fixture</html>\n');
  execFileSync('git', ['-C', legacySource, 'init', '-q']);
  execFileSync('git', ['-C', legacySource, 'add', '.']);
  execFileSync('git', ['-C', legacySource, '-c', 'user.name=stage test', '-c', 'user.email=stage@test.local', 'commit', '-qm', 'fixture']);
  execFileSync('git', ['-C', legacySource, 'checkout', '--detach', '-q', 'HEAD']);
  const legacyRevision = execFileSync('git', ['-C', legacySource, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.mkdirSync(path.dirname(db));
  fs.writeFileSync(db, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(128)]));
  return {
    root, pkg, db, trialRoot, legacySource,
    options: {
      packageDir: pkg, sourceDb: db, trialRoot, legacySource,
      legacyNode: process.execPath, expectedSource: SOURCE,
      expectedLegacy: legacyRevision,
      expectedAppImage: sha256(files['IntentSmith-Studio2.AppImage']),
    },
  };
}

test('CLI defaults to preflight and rejects a live run without explicit GPU authorization', () => {
  assert.equal(parseStageArgs([
    '--package=/private/pkg', '--db=/private/data.sqlite',
    '--trial-root=/private/trial', '--legacy-source=/private/legacy',
    '--legacy-node=/private/node', `--expected-source=${SOURCE}`,
    `--expected-legacy=${LEGACY}`,
    `--expected-appimage=${'c'.repeat(64)}`,
  ]).mode, 'preflight');
  assert.throws(() => parseStageArgs([
    '--live', '--package=/private/pkg', '--db=/private/data.sqlite',
    '--trial-root=/private/trial', '--legacy-source=/private/legacy',
    '--legacy-node=/private/node', `--expected-source=${SOURCE}`,
    `--expected-legacy=${LEGACY}`,
    `--expected-appimage=${'c'.repeat(64)}`,
  ]), /GPU_AUTHORIZATION_REQUIRED/);
  assert.throws(() => parseStageArgs(['--gpu-authorized']), /GPU_AUTHORIZATION_REQUIRES_LIVE/);
  assert.throws(() => parseStageArgs([
    '--live', '--gpu-authorized', '--package=/private/pkg', '--db=/private/data.sqlite',
    '--trial-root=/private/trial', '--legacy-source=/private/legacy',
    '--legacy-node=/private/node', `--expected-source=${SOURCE}`,
    `--expected-legacy=${LEGACY}`, `--expected-appimage=${'c'.repeat(64)}`,
  ]), /VRAM_THRESHOLD_REQUIRED/);
  const live = parseStageArgs([
    '--live', '--gpu-authorized', '--min-free-vram-mib=12288',
    '--package=/private/pkg', '--db=/private/data.sqlite',
    '--trial-root=/private/trial', '--legacy-source=/private/legacy',
    '--legacy-node=/private/node', `--expected-source=${SOURCE}`,
    `--expected-legacy=${LEGACY}`, `--expected-appimage=${'c'.repeat(64)}`,
  ]);
  assert.equal(live.mode, 'live');
  assert.equal(live.minFreeVramMiB, 12288);
});

test('preflight validates every sealed file and does not create the trial root', async t => {
  const f = fixture(t);
  const plan = await preflightStage(f.options);
  assert.equal(plan.sourceRevision, SOURCE);
  assert.equal(plan.appImageSha256, f.options.expectedAppImage);
  assert.equal(plan.legacyRevision, f.options.expectedLegacy);
  assert.equal(plan.trialRoot, f.trialRoot);
  assert.equal(fs.existsSync(f.trialRoot), false);
});

test('CLI dry run verifies package identity without creating a trial or touching GPU', t => {
  const f = fixture(t);
  const args = [
    `--package=${f.pkg}`, `--db=${f.db}`, `--trial-root=${f.trialRoot}`,
    `--legacy-source=${f.legacySource}`, `--legacy-node=${f.options.legacyNode}`,
    `--expected-source=${f.options.expectedSource}`,
    `--expected-appimage=${f.options.expectedAppImage}`,
    `--expected-legacy=${f.options.expectedLegacy}`,
  ];
  const output = execFileSync(process.execPath,
    [path.resolve('scripts/studio2-isolated-stage.mjs'), ...args],
    { cwd: path.resolve('.'), encoding: 'utf8', timeout: 15_000 });
  const report = JSON.parse(output);
  assert.equal(report.status, 'READY_FOR_SERIAL_LIVE_STAGE');
  assert.equal(report.gpuCalled, false);
  assert.equal(report.databaseWritten, false);
  assert.equal(fs.existsSync(f.trialRoot), false);
});

test('wrong source or AppImage identity fails closed before any trial files exist', async t => {
  const f = fixture(t);
  await assert.rejects(preflightStage({ ...f.options, expectedSource: 'c'.repeat(40) }), /SOURCE_REVISION_MISMATCH/);
  await assert.rejects(preflightStage({ ...f.options, expectedAppImage: 'd'.repeat(64) }), /APPIMAGE_DIGEST_MISMATCH/);
  assert.equal(fs.existsSync(f.trialRoot), false);
});

test('tampered or unlisted package bytes fail even when the requested digest is unchanged', async t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.pkg, 'source', 'src', 'server.js'), 'tampered\n');
  await assert.rejects(preflightStage(f.options), /PACKAGE_DIGEST_MISMATCH/);
  fs.writeFileSync(path.join(f.pkg, 'source', 'src', 'server.js'), 'fixture server\n');
  fs.writeFileSync(path.join(f.pkg, 'unlisted'), 'payload');
  await assert.rejects(preflightStage(f.options), /PACKAGE_UNLISTED_FILE/);
});

test('source DB symlinks and existing trial paths are rejected', async t => {
  const f = fixture(t);
  const alias = path.join(f.root, 'alias.sqlite');
  fs.symlinkSync(f.db, alias);
  await assert.rejects(preflightStage({ ...f.options, sourceDb: alias }), /SOURCE_DB_SYMLINK/);
  fs.mkdirSync(f.trialRoot);
  await assert.rejects(preflightStage(f.options), /TRIAL_ROOT_EXISTS/);
  fs.rmdirSync(f.trialRoot);
  fs.symlinkSync(path.join(f.root, 'missing'), f.trialRoot);
  await assert.rejects(preflightStage(f.options), /TRIAL_ROOT_EXISTS/);
});

test('trial parent symlinks and containment inside package are rejected', async t => {
  const f = fixture(t);
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.root, alias);
  await assert.rejects(preflightStage({ ...f.options, trialRoot: path.join(alias, 'trial') }), /TRIAL_PARENT_SYMLINK/);
  await assert.rejects(preflightStage({ ...f.options, trialRoot: path.join(f.pkg, 'source', 'trial') }), /TRIAL_ROOT_UNSAFE/);
  await assert.rejects(preflightStage({ ...f.options,
    trialRoot: path.join(f.root, 'x'.repeat(80)),
  }), /TRIAL_ROOT_TOO_LONG_FOR_CHROMIUM/);
});

test('only a new real project under the private trial home may receive M2 or SCM effects', async t => {
  const f = fixture(t);
  const home = path.join(f.trialRoot, 'home');
  const project = path.join(home, 'projects', 'stage-fixture');
  fs.mkdirSync(project, { recursive: true });
  assert.equal(assertIsolatedProjectPath({ trialRoot: f.trialRoot, projectPath: project }), project);
  assert.throws(() => assertIsolatedProjectPath({
    trialRoot: f.trialRoot, projectPath: path.join(f.root, 'original-project'),
  }), /PROJECT_PATH_OUTSIDE_TRIAL/);
  const alias = path.join(home, 'projects', 'alias');
  fs.symlinkSync(f.root, alias);
  assert.throws(() => assertIsolatedProjectPath({ trialRoot: f.trialRoot, projectPath: alias }), /PROJECT_PATH_SYMLINK/);
});

test('preservation accepts reordered rows and additive schema but rejects changed or lost original data', () => {
  const empty = () => Object.fromEntries(PRESERVED_TABLES.map(table => [table, []]));
  const before = empty();
  before.messages = [{ id: 1, content: 'one' }, { id: 2, content: 'two' }];
  before.model_overrides = [{ id: 1, role: 'CHAT', model: 'qwen', verification_status: 'PENDING' }];
  const after = empty();
  after.messages = [{ id: 2, content: 'two', newColumn: null }, { id: 1, content: 'one', newColumn: null }];
  after.model_overrides = [{ id: 1, role: 'CHAT', model: 'qwen', verification_status: 'VERIFIED', newColumn: null }];
  assert.equal(assertPreserved(before, after, { allowVerificationChange: true }).messages.before, 2);
  assert.throws(() => assertPreserved(before, after), /PRESERVED_ROW_CHANGED/);
  after.messages[0].content = 'changed';
  assert.throws(() => assertPreserved(before, after, { allowVerificationChange: true }), /PRESERVED_ROW_CHANGED/);
  after.messages = [{ id: 1, content: 'one' }];
  assert.throws(() => assertPreserved(before, after, { allowVerificationChange: true }), /PRESERVED_ROW_COUNT_CHANGED/);
});

test('preservation requires duplicate originals, while permitting new stage rows only when requested', () => {
  const empty = () => Object.fromEntries(PRESERVED_TABLES.map(table => [table, []]));
  const before = empty();
  before.expertises = [{ name: 'same' }, { name: 'same' }];
  const after = empty();
  after.expertises = [{ name: 'same' }, { name: 'new' }];
  assert.throws(() => assertPreserved(before, after), /PRESERVED_ROW_CHANGED/);
  after.expertises = [{ name: 'same' }, { name: 'same' }, { name: 'new' }];
  assert.equal(assertPreserved(before, after, { allowNew: true }).expertises.after, 3);
  assert.throws(() => assertPreserved(before, after), /PRESERVED_ROW_COUNT_CHANGED/);
});

test('poisoned Git environment cannot attest a dirty Legacy checkout through another repository', async t => {
  const f = fixture(t);
  const decoy = path.join(f.root, 'decoy');
  fs.mkdirSync(decoy);
  execFileSync('git', ['-C', decoy, 'init', '-q']);
  fs.writeFileSync(path.join(decoy, 'clean.txt'), 'clean\n');
  execFileSync('git', ['-C', decoy, 'add', '.']);
  execFileSync('git', ['-C', decoy, '-c', 'user.name=stage test', '-c', 'user.email=stage@test.local',
    'commit', '-qm', 'clean decoy']);
  const decoyRevision = execFileSync('git', ['-C', decoy, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  fs.appendFileSync(path.join(f.legacySource, 'intentsmith-ide/applications/electron/lib/frontend/index.html'), 'dirty\n');
  const oldDir = process.env.GIT_DIR, oldTree = process.env.GIT_WORK_TREE;
  process.env.GIT_DIR = path.join(decoy, '.git');
  process.env.GIT_WORK_TREE = decoy;
  try {
    await assert.rejects(preflightStage({ ...f.options, expectedLegacy: decoyRevision }),
      /LEGACY_SOURCE_UNATTESTED/);
  } finally {
    if (oldDir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = oldDir;
    if (oldTree === undefined) delete process.env.GIT_WORK_TREE; else process.env.GIT_WORK_TREE = oldTree;
  }
});

test('imported automatic SCM, recoverable M2 and pending model pulls block copied DB startup', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE scm_project_policy (project_id INTEGER, fetch_mode TEXT, pull_mode TEXT);
      CREATE TABLE m2_lifecycle_operations (lifecycle_id TEXT, project_id INTEGER);
      CREATE TABLE m2_lifecycle_terminals (lifecycle_id TEXT);
      CREATE TABLE m6_model_artifact_operations (operation_id TEXT, kind TEXT);
      CREATE TABLE m6_model_artifact_events (event_id TEXT, operation_id TEXT, sequence INTEGER, status TEXT);
    `);
    assert.deepEqual(assertNoImportedStartupEffects(db), {
      automaticScmPolicies: 0, recoverableM2Operations: 0, outstandingModelPulls: 0,
    });
    db.prepare("INSERT INTO scm_project_policy VALUES (1,'automatic','ask')").run();
    assert.throws(() => assertNoImportedStartupEffects(db), /IMPORTED_SCM_AUTOMATION_UNSAFE/);
    db.prepare('DELETE FROM scm_project_policy').run();
    db.prepare("INSERT INTO m2_lifecycle_operations VALUES ('lifecycle-1',1)").run();
    assert.throws(() => assertNoImportedStartupEffects(db), /IMPORTED_M2_RECOVERY_UNSAFE/);
    db.prepare("INSERT INTO m2_lifecycle_terminals VALUES ('lifecycle-1')").run();
    db.prepare("INSERT INTO m6_model_artifact_operations VALUES ('pull-1','PULL')").run();
    assert.throws(() => assertNoImportedStartupEffects(db), /IMPORTED_MODEL_PULL_UNSAFE/);
    db.prepare("INSERT INTO m6_model_artifact_events VALUES ('event-1','pull-1',1,'SUCCEEDED')").run();
    assert.deepEqual(assertNoImportedStartupEffects(db), {
      automaticScmPolicies: 0, recoverableM2Operations: 0, outstandingModelPulls: 0,
    });
  } finally { db.close(); }
});

test('staged chat requires exact private conversation, user prompt and later assistant answer', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id INTEGER); CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT)');
    db.prepare('INSERT INTO conversations VALUES (?,?)').run('private-conv', 42);
    const proof = { conversationId: 'private-conv', projectId: 42,
      prompt: 'Explain this. END-MARKER', answer: 'A useful answer. END-MARKER', marker: 'END-MARKER' };
    assert.throws(() => assertDurableStageChat(db, proof), /MODEL_CHAT_NOT_DURABLE/);
    db.prepare('INSERT INTO messages VALUES (1,?,?,?)').run('private-conv', 'user', proof.prompt);
    assert.throws(() => assertDurableStageChat(db, proof), /MODEL_CHAT_NOT_DURABLE/);
    db.prepare('INSERT INTO messages VALUES (2,?,?,?)').run('private-conv', 'assistant', proof.answer);
    assert.deepEqual(assertDurableStageChat(db, proof), { userTurnId: 1, assistantTurnId: 2 });
    assert.throws(() => assertDurableStageChat(db, { ...proof, projectId: 99 }), /MODEL_CHAT_NOT_DURABLE/);
    assert.throws(() => assertDurableStageChat(db, { ...proof, answer: 'Different END-MARKER' }), /MODEL_CHAT_NOT_DURABLE/);
  } finally { db.close(); }
});
