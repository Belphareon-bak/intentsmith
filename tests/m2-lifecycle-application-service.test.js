#!/usr/bin/env node
import { projectTestProfile } from '../src/chat/handlers/project-collaboration.js';

import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectAuthorityHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectExecutionClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyExecutionAuthority } from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { up as applyLifecycleAuthority } from '../src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js';
import {
  M2LifecycleServiceErrorCode,
  createDefaultM2LifecycleApplicationService,
} from '../src/lifecycle/m2-lifecycle-application-service.js';
import { suite, testAsync, summary } from './harness.js';
import { compileCodeDraftInput, compileCodeDraftResult, buildCodeDraftPrompt, assertCodeDraftModelBudget, compileCodeDraftEditPolicy, parseCodeDraftEditPolicy, captureCodeDraftEditBase, CODE_DRAFT_NORMAL_EDIT_OUTPUT } from '../src/lifecycle/m2-code-draft.js';
import { initializeNewProject } from '../src/planner/project-onboarding.js';
import { processSandboxProvider } from '../src/execution/process-sandbox-provider.js';
import { computeM2ProjectChangeRequestDigest } from '../contracts/m2/execution-v1.js';
import {
  M2_GOVERNANCE_DECISION_CHECKS,
  computeM2GovernanceBaselineDigest,
  computeM2GovernancePolicySnapshotDigest,
  createM2GovernanceDecision,
} from '../contracts/m2/governance-v1.js';

const PROJECT_ID = 27;
// Node 24 infers ESM from syntax and no longer accepts this legacy flag.
const defaultModuleTypeArgs = process.allowedNodeEnvironmentFlags.has('--experimental-default-type')
  ? ['--experimental-default-type=module'] : [];
const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'operator-m2' });
const ORIGIN = Object.freeze({
  surface: 'studio',
  sessionId: 'studio-session-m2',
  conversationId: 'studio-conversation-m2',
  projectId: PROJECT_ID,
});

function git(root, args) {
  return execFileSync('/usr/bin/git', args, {
    cwd: root,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: '/nonexistent',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
    encoding: 'utf8',
  }).trim();
}

function sha(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

// Independent wire oracle: no production encoder/decoder is shared here.
// Existing assertions below still compare complete original context values.
function codeInput(prompt) {
  const wire = JSON.parse(prompt);
  if (!Object.hasOwn(wire, 'contextEncoding')) return wire;
  assert.equal(wire.contextEncoding, 'indexed-full/v1');
  assert.ok(Array.isArray(wire.paths) && wire.paths.every(value => typeof value === 'string'));
  assert.equal(new Set(wire.paths).size, wire.paths.length);
  const relative = index => {
    assert.ok(Number.isSafeInteger(index) && index >= 0 && index < wire.paths.length);
    return wire.paths[index];
  };
  const input = { path: relative(wire.path), filePlan: wire.filePlan.map(row => {
    assert.ok(row.length === 2 || row.length === 3);
    return { path: relative(row[0]), dependsOn: row[1].map(relative),
      ...(row.length === 3 ? { state: row[2] } : {}) };
  }) };
  for (const [key, value] of Object.entries(wire)) {
    if (['contextEncoding', 'paths', 'path', 'filePlan'].includes(key)) continue;
    input[key] = key === 'peerFiles' ? value.map(row => {
      assert.ok(row.length === 3 || row.length === 4);
      return { path: relative(row[0]), content: row[1], state: row[2],
        ...(row.length === 4 ? { contentDigest: row[3] } : {}) };
    }) : value;
  }
  return input;
}

function policy(externalImports = []) {
  return {
    policyId: 'm2-policy-v1',
    layers: [{ name: 'app', roots: ['src'] }],
    rules: [{ from: 'app', canImport: ['app'] }],
    externalImports,
    sourceExtensions: ['.js'],
    requiredChecks: ['imports.allowed', 'inventory.complete', 'layers.mapped'],
    unmappedFilePolicy: 'unavailable',
  };
}

function writePolicy(root, value = policy()) {
  fs.mkdirSync(path.join(root, '.intentsmith'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.intentsmith', 'm2-governance-policy.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-lifecycle-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  writePolicy(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '--', '.intentsmith/m2-governance-policy.json', 'src/app.js']);
  git(root, [
    '-c', 'user.name=IntentSmith Test',
    '-c', 'user.email=intentsmith@example.invalid',
    'commit', '-m', 'baseline',
  ]);
  return root;
}

function openDatabase(databasePath = ':memory:') {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  const installed = db.prepare(`
    SELECT 1 AS present FROM sqlite_master
    WHERE type = 'table' AND name = 'm2_lifecycle_operations'
  `).get();
  if (!installed) {
    // Group only initial schema construction. All tested lifecycle operations
    // run after this commit, with foreign_keys already enabled above.
    db.transaction(() => {
      applyEffectAuthority(db);
      applyEffectAuthorityHardening(db);
      applyEffectExecutionClaims(db);
      applyEffectClaimTruth(db);
      applyExecutionAuthority(db);
      applyLifecycleAuthority(db);
    })();
  }
  return db;
}

function projectRegistry(root) {
  return Object.freeze({
    findById: Object.freeze({
      get(projectId) {
        return projectId === PROJECT_ID
          ? { id: PROJECT_ID, path: root, status: 'active' }
          : null;
      },
    }),
  });
}

function proposal({
  commit = true,
  changes = [{ path: 'src/app.js', afterContent: 'export const value = 2;\n' }],
} = {}) {
  const value = {
    intent: 'Update the exact exported application value',
    changes,
    focusedTest: {
      binary: process.execPath,
      argv: ['--version'],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' },
      timeoutMs: 30_000,
    },
  };
  if (commit) {
    value.gitCommit = {
      message: 'M2 governed lifecycle change',
      identity: {
        authorName: 'IntentSmith Runtime',
        authorEmail: 'runtime@example.invalid',
        authorDate: '2026-08-24T10:00:00Z',
        committerName: 'IntentSmith Runtime',
        committerEmail: 'runtime@example.invalid',
        committerDate: '2026-08-24T10:00:00Z',
      },
    };
  }
  return value;
}

function makeClock(start = Date.parse('2026-08-24T09:00:00.000Z')) {
  let now = start;
  return () => ++now;
}

function createService(db, root, clock = makeClock(), overrides = {}) {
  return createDefaultM2LifecycleApplicationService({
    database: db,
    projects: projectRegistry(root),
    clock,
    ...overrides,
  });
}

async function prepare(service, proposalValue = proposal()) {
  return service.prepareSmallProjectChange({
    authenticatedSubject: SUBJECT,
    projectId: PROJECT_ID,
    origin: ORIGIN,
    proposal: proposalValue,
  });
}

suite('M2 lifecycle application service — production journey');

await testAsync('SCM disabled commit blocks M2 preparation and later approval while allowing a file-only plan', async () => {
  const root = makeProject(); const db = openDatabase();
  let mode = 'disabled';
  try {
    const service = createService(db, root, makeClock(), { scmCommitMode: () => mode });
    await service.recoverIncompleteSmallProjectChanges();
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    await assert.rejects(prepare(service), { code: M2LifecycleServiceErrorCode.SCM_COMMIT_DISABLED });
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
    const fileOnly = await prepare(service, proposal({ commit: false }));
    assert.equal(fileOnly.state, 'awaiting_approval');
    mode = 'ask';
    const withCommit = await prepare(service);
    mode = 'disabled';
    await assert.rejects(service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
      lifecycleId: withCommit.lifecycleId, planDigest: withCommit.planDigest, origin: ORIGIN }),
    { code: M2LifecycleServiceErrorCode.SCM_COMMIT_DISABLED });
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

for (const type of ['general', 'desktop']) {
  await testAsync(`actual ${type} scaffold reaches draft, sandbox test and committed increment`, async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-scaffold-m2-'));
    const root = path.join(parent, type); const db = openDatabase();
    try {
      await initializeNewProject(root, { name: 'Scaffold integration fixture', type });
      const outputs = {
        'src/index.mjs': 'export const add = (a, b) => a + b;\n',
        'test/acceptance.test.mjs': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {add} from '../src/index.mjs';\ntest('sum', () => assert.equal(add(2, 3), 5));\n",
      };
      const service = createService(db, root, makeClock(), { generateCodeDraft: async ({ prompt }) => ({
        content: JSON.stringify({ afterContent: outputs[codeInput(prompt).path] }), finishReason: 'stop',
      }) });
      await service.recoverIncompleteSmallProjectChanges();
      const planned = await service.draftSmallProjectChange({ authenticatedSubject: SUBJECT,
        projectId: PROJECT_ID, origin: ORIGIN, draft: {
          instruction: 'Implement the pure sum fixture and its behavior test.',
          files: [
            { path: 'src/index.mjs', instruction: 'Export add.', dependsOn: [] },
            { path: 'test/acceptance.test.mjs', instruction: 'Assert 2 + 3 = 5.', dependsOn: ['src/index.mjs'] },
          ], focusedTest: projectTestProfile(), gitCommit: proposal().gitCommit,
        } });
      assert.equal(planned.state, 'awaiting_approval');
      const completed = await service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
        lifecycleId: planned.lifecycleId, planDigest: planned.planDigest, origin: ORIGIN });
      assert.equal(completed.state, 'succeeded');
      assert.equal(completed.result.focusedTest.exitCode, 0);
      assert.equal(completed.result.git.status, 'committed');
      assert.equal(git(root, ['status', '--porcelain=v1']), '');
    } finally { db.close(); fs.rmSync(parent, { recursive: true, force: true }); }
  }, 60_000);
}

for (const defect of ['missing', 'symlink', 'hardlink', 'oversize']) {
  await testAsync(`exact policy file root rejects ${defect} without a pending plan`, async () => {
    const root = makeProject(); const db = openDatabase();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-root-canary-'));
    try {
      const p = policy(); p.layers[0].roots = ['root.cfg', 'src']; writePolicy(root, p);
      fs.writeFileSync(path.join(outside, 'canary'), 'outside private content\n');
      const target = path.join(root, 'root.cfg');
      if (defect === 'symlink') fs.symlinkSync(path.join(outside, 'canary'), target);
      if (defect === 'hardlink') fs.linkSync(path.join(outside, 'canary'), target);
      if (defect === 'oversize') fs.writeFileSync(target, Buffer.alloc(8 * 1024 * 1024 + 1, 65));
      git(root, ['add', '--', '.intentsmith/m2-governance-policy.json', ...(defect === 'missing' ? [] : ['root.cfg'])]);
      git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Exact root fixture']);
      assert.equal(git(root, ['status', '--porcelain=v1']), '');
      const service = createService(db, root);
      await service.recoverIncompleteSmallProjectChanges();
      await assert.rejects(prepare(service));
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
      assert.equal(fs.readFileSync(path.join(outside, 'canary'), 'utf8'), 'outside private content\n');
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
  });
}

await testAsync('real SQLite, ProjectContext, Git and bwrap journey reaches one evidence-bound success', async () => {
  const root = makeProject();
  const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-authority-'));
  const databasePath = path.join(authorityRoot, 'authority.sqlite');
  let db = openDatabase(databasePath);
  try {
    const service = createService(db, root);
    assert.deepEqual(service.getRecoveryCensusStatus(), {
      complete: false,
      attempts: 0,
      lastAttemptAt: null,
      lastErrorCode: null,
    });
    assert.deepEqual(await service.recoverIncompleteSmallProjectChanges(), []);
    assert.equal(service.getRecoveryCensusStatus().complete, true);
    assert.equal(service.getRecoveryCensusStatus().attempts, 1);
    assert.match(service.getRecoveryCensusStatus().lastAttemptAt, /^2026-08-24T09:00:00\.001Z$/);
    assert.equal(service.getRecoveryCensusStatus().lastErrorCode, null);

    const planned = await prepare(service);
    assert.equal(planned.state, 'awaiting_approval');
    assert.equal(planned.result, null);
    assert.equal(planned.terminal, null);
    assert.equal(planned.audit.governanceDecision.verdict, 'allow');
    assert.equal(planned.diff.length, 1);
    assert.equal(planned.diff[0].before.content, 'export const value = 1;\n');
    assert.equal(planned.diff[0].after.content, 'export const value = 2;\n');

    const completed = await service.approveSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      planDigest: planned.planDigest,
      origin: ORIGIN,
    });
    assert.equal(completed.state, 'succeeded', JSON.stringify(completed.result));
    assert.equal(completed.result.terminalStatus, 'succeeded');
    assert.equal(completed.result.focusedTest.terminalStatus, 'succeeded');
    assert.equal(completed.result.git.status, 'committed');
    assert.equal(completed.terminal.state, 'succeeded');
    assert.equal(completed.terminal.governanceReceiptDigest.startsWith('sha256:'), true);
    assert.equal(completed.audit.governanceReceipt.status, 'accepted');
    assert.equal(completed.approval.completeGrantSet, true);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 2;\n');
    assert.equal(git(root, ['status', '--porcelain=v1']), '');

    const lifecycleId = planned.lifecycleId;
    db.close();
    db = openDatabase(databasePath);
    const restarted = createService(db, root);
    assert.deepEqual(await restarted.recoverIncompleteSmallProjectChanges(), []);
    const durable = restarted.getSmallProjectChangeStatus({
      authenticatedSubject: SUBJECT,
      lifecycleId,
      origin: ORIGIN,
    });
    assert.equal(durable.state, 'succeeded');
    assert.equal(durable.terminal.resultDigest, completed.terminal.resultDigest);
    assert.equal(durable.audit.governanceReceipt.receiptId, completed.audit.governanceReceipt.receiptId);
    assert.equal(db.prepare('SELECT count(*) AS count FROM m2_lifecycle_terminals').get().count, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM m2_lifecycle_governance_receipts').get().count, 1);
  } finally {
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(authorityRoot, { recursive: true, force: true });
  }
}, 60_000);

for (const failsOracle of [false, true]) {
  await testAsync('AST production M2 preserves exact bytes and restart (' + (failsOracle ? 'functional rollback' : 'commit') + ')', async () => {
    const root = makeProject();
    const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-ast-m2-authority-'));
    const databasePath = path.join(authorityRoot, 'authority.sqlite');
    let db = openDatabase(databasePath);
    try {
      writePolicy(root, policy(['node:assert/strict']));
      git(root, ['add', '--', '.intentsmith/m2-governance-policy.json']);
      git(root, ['-c', 'user.name=IntentSmith Test', '-c', 'user.email=intentsmith@example.invalid',
        'commit', '-m', 'Freeze AST integration policy']);
      const beforeHead = git(root, ['rev-parse', 'HEAD']);
      const beforeContent = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
      const changes = [
        { path: 'src/app.js', afterContent: [
          "// import 'blocked'; require('blocked') are inert comment data.",
          "import { value } from './\\u0064ep.js';",
          'export const result = value + 1;',
          "export const inert = \"require('blocked')\";",
          'export const pattern = /import missing/;',
        ].join('\n') + '\n' },
        { path: 'src/dep.js', afterContent: 'export const value = 41;\n' },
        { path: 'src/probe.js', afterContent: [
          "import assert from 'node:assert/strict';",
          "import { result, inert } from './app.js';",
          'assert.equal(result, ' + (failsOracle ? '999' : '42') + ');',
          "assert.equal(inert, \"require('blocked')\");",
        ].join('\n') + '\n' },
      ];
      const proposalValue = proposal({ changes });
      proposalValue.focusedTest.binary = process.execPath;
      proposalValue.focusedTest.argv = ['--disable-wasm-trap-handler', 'src/probe.js'];
      const processResults = [];
      const service = createService(db, root, makeClock(), { processProvider: {
        async run(input, options) {
          const result = await processSandboxProvider.run(input, options);
          processResults.push(result);
          return result;
        },
      } });
      await service.recoverIncompleteSmallProjectChanges();
      const planned = await prepare(service, proposalValue);
      assert.equal(planned.audit.governanceDecision.verdict, 'allow');
      assert.deepEqual(planned.diff.map(file => [file.path, file.after.content]),
        changes.map(file => [file.path, file.afterContent]));
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), beforeContent);
      for (const relative of ['src/dep.js', 'src/probe.js']) assert.equal(fs.existsSync(path.join(root, relative)), false);
      await assert.rejects(service.approveSmallProjectChange({
        authenticatedSubject: SUBJECT, lifecycleId: planned.lifecycleId, origin: ORIGIN,
        planDigest: 'sha256:' + '0'.repeat(64),
      }), { code: M2LifecycleServiceErrorCode.PLAN_DIGEST_MISMATCH });
      assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
      const completed = await service.approveSmallProjectChange({
        authenticatedSubject: SUBJECT, lifecycleId: planned.lifecycleId,
        origin: ORIGIN, planDigest: planned.planDigest,
      });
      assert.equal(completed.state, failsOracle ? 'failed' : 'succeeded', JSON.stringify(completed.result));
      if (failsOracle) {
        assert.equal(completed.result.errorCode, 'PROJECT_CHANGE_TEST_FAILED');
        assert.equal(processResults.length, 1);
        assert.match(processResults[0].stderr, /ERR_ASSERTION/);
        assert.match(processResults[0].stderr, /42 !== 999/);
        assert.equal(completed.result.rollback.status, 'succeeded');
        assert.deepEqual([...completed.result.rollback.paths].sort(), changes.map(file => file.path));
        assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
        assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), beforeContent);
        for (const relative of ['src/dep.js', 'src/probe.js']) assert.equal(fs.existsSync(path.join(root, relative)), false);
      } else {
        assert.equal(completed.result.focusedTest.exitCode, 0);
        assert.equal(completed.result.git.status, 'committed');
        for (const file of changes) {
          assert.equal(fs.readFileSync(path.join(root, file.path), 'utf8'), file.afterContent);
          assert.deepEqual(execFileSync('/usr/bin/git', ['show', 'HEAD:' + file.path], { cwd: root }),
            Buffer.from(file.afterContent));
        }
      }
      assert.equal(git(root, ['status', '--porcelain=v1']), '');
      db.close(); db = openDatabase(databasePath);
      const restarted = createService(db, root);
      await restarted.recoverIncompleteSmallProjectChanges();
      const durable = restarted.getSmallProjectChangeStatus({
        authenticatedSubject: SUBJECT, lifecycleId: planned.lifecycleId, origin: ORIGIN,
      });
      assert.equal(durable.state, completed.state);
      assert.equal(durable.terminal.resultDigest, completed.terminal.resultDigest);
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_terminals').get().n, 1);
    } finally {
      if (db.open) db.close();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(authorityRoot, { recursive: true, force: true });
    }
  }, 60_000);
}

await testAsync('abort during asynchronous governance wins over denial and registers no authority', async () => {
  const root = makeProject(); const db = openDatabase(); const controller = new AbortController();
  try {
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const service = createService(db, root, makeClock(), {
      evaluateGovernance: async (_args, { signal }) => {
        assert.equal(signal, controller.signal);
        await Promise.resolve();
        controller.abort();
        return { verdict: 'unavailable' };
      },
    });
    await service.recoverIncompleteSmallProjectChanges();
    await assert.rejects(service.prepareSmallProjectChange({
      authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN,
      proposal: proposal(), signal: controller.signal,
    }), { code: M2LifecycleServiceErrorCode.CANCELLED });
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_effect_requests').get().n, 0);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

await testAsync('production lifecycle commits a governed non-manifest file with an unchanged revision', async () => {
  const root = makeProject();
  const db = openDatabase();
  try {
    const service = createService(db, root);
    assert.deepEqual(await service.recoverIncompleteSmallProjectChanges(), []);
    const planned = await prepare(service, proposal({
      changes: [{ path: 'src/deploy.cfg', afterContent: 'release=green\n' }],
    }));
    assert.equal(planned.audit.governanceDecision.verdict, 'allow');
    assert.equal(planned.plan.expectedAfterRevision, planned.plan.project.workspaceRevision);
    const completed = await service.approveSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      planDigest: planned.planDigest,
      origin: ORIGIN,
    });
    assert.equal(completed.state, 'succeeded', JSON.stringify(completed.result));
    assert.equal(completed.result.changes.afterRevision, planned.plan.project.workspaceRevision);
    assert.equal(completed.result.git.status, 'committed');
    assert.equal(completed.result.rollback.required, false);
    assert.equal(fs.readFileSync(path.join(root, 'src/deploy.cfg'), 'utf8'), 'release=green\n');
    assert.equal(git(root, ['status', '--porcelain=v1']), '');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

await testAsync('restart census fences approval of an existing plan before grants or project effects', async () => {
  const root = makeProject();
  const db = openDatabase();
  const processProvider = Object.freeze({
    async execute({ onSupervisor }) {
      onSupervisor({
        pid: 8199,
        processGroupId: 8199,
        bootId: '11111111-1111-4111-8111-111111111111',
        startIdentity: '999',
      });
      return {
        terminalStatus: 'succeeded',
        processGroupState: 'empty',
        exitCode: 0,
        signal: null,
        stdoutDigest: sha(Buffer.alloc(0)),
        stderrDigest: sha(Buffer.alloc(0)),
        outputTruncated: false,
        lateCompletionRejected: false,
      };
    },
  });
  try {
    const first = createService(db, root, makeClock(), { processProvider });
    await first.recoverIncompleteSmallProjectChanges();
    const planned = await prepare(first, proposal({ commit: false }));
    const restarted = createService(db, root, makeClock(), { processProvider });

    await assert.rejects(() => restarted.approveSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      planDigest: planned.planDigest,
      origin: ORIGIN,
    }), error => error.code === M2LifecycleServiceErrorCode.RECOVERY_INCOMPLETE);
    const fenced = restarted.getSmallProjectChangeStatus({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      origin: ORIGIN,
    });
    assert.equal(fenced.approval, null);
    assert.equal(fenced.result, null);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');

    await restarted.recoverIncompleteSmallProjectChanges();
    const completed = await restarted.approveSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      planDigest: planned.planDigest,
      origin: ORIGIN,
    });
    assert.equal(completed.state, 'succeeded');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 60_000);

await testAsync('type drift terminalizes and a restarted lifecycle recovery census completes', async () => {
  const root = makeProject();
  const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-type-drift-'));
  const databasePath = path.join(authorityRoot, 'authority.sqlite');
  const targetPath = path.join(root, 'src/app.js');
  let db = openDatabase(databasePath);
  const processProvider = Object.freeze({
    async execute({ onSupervisor }) {
      onSupervisor({
        pid: 8124,
        processGroupId: 8124,
        bootId: '11111111-1111-4111-8111-111111111111',
        startIdentity: '902',
      });
      fs.rmSync(targetPath, { force: true });
      fs.mkdirSync(targetPath);
      fs.writeFileSync(path.join(targetPath, 'foreign.txt'), 'foreign directory bytes\n');
      return {
        terminalStatus: 'succeeded',
        processGroupState: 'empty',
        exitCode: 0,
        signal: null,
        stdoutDigest: sha(Buffer.alloc(0)),
        stderrDigest: sha(Buffer.alloc(0)),
        outputTruncated: false,
        lateCompletionRejected: false,
      };
    },
  });
  try {
    const service = createService(db, root, makeClock(), { processProvider });
    assert.deepEqual(await service.recoverIncompleteSmallProjectChanges(), []);
    const planned = await prepare(service, proposal({ commit: false }));
    const completed = await service.approveSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      planDigest: planned.planDigest,
      origin: ORIGIN,
    });
    assert.equal(completed.state, 'orphaned');
    assert.equal(completed.result.terminalStatus, 'orphaned');
    assert.equal(completed.result.rollback.status, 'failed');
    assert.equal(completed.terminal.state, 'orphaned');
    assert.equal(fs.readFileSync(path.join(targetPath, 'foreign.txt'), 'utf8'), 'foreign directory bytes\n');

    const lifecycleId = planned.lifecycleId;
    db.close();
    db = openDatabase(databasePath);
    const restarted = createService(db, root);
    assert.deepEqual(await restarted.recoverIncompleteSmallProjectChanges(), []);
    const durable = restarted.getSmallProjectChangeStatus({
      authenticatedSubject: SUBJECT,
      lifecycleId,
      origin: ORIGIN,
    });
    assert.equal(durable.state, 'orphaned');
    assert.equal(durable.result.terminalStatus, 'orphaned');
    assert.equal(db.prepare('SELECT count(*) AS count FROM m2_lifecycle_terminals').get().count, 1);
  } finally {
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(authorityRoot, { recursive: true, force: true });
  }
}, 60_000);

await testAsync('policy or workspace drift after planning blocks approval before grants or effects', async () => {
  const root = makeProject();
  const db = openDatabase();
  try {
    const service = createService(db, root);
    await service.recoverIncompleteSmallProjectChanges();
    const planned = await prepare(service, proposal({ commit: false }));
    writePolicy(root, policy(['node:fs']));

    await assert.rejects(() => service.approveSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      planDigest: planned.planDigest,
      origin: ORIGIN,
    }), error => error.code === M2LifecycleServiceErrorCode.CONTEXT_STALE);

    const status = service.getSmallProjectChangeStatus({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      origin: ORIGIN,
    });
    assert.equal(status.state, 'awaiting_approval');
    assert.equal(status.approval, null);
    assert.equal(status.result, null);
    assert.equal(status.terminal, null);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await testAsync('pending plan cancellation is durable and forged owner or origin cannot inspect it', async () => {
  const root = makeProject();
  const db = openDatabase();
  try {
    const service = createService(db, root);
    await service.recoverIncompleteSmallProjectChanges();
    const planned = await prepare(service, proposal({ commit: false }));

    assert.throws(() => service.getSmallProjectChangeStatus({
      authenticatedSubject: { actorType: 'user', actorId: 'other-operator' },
      lifecycleId: planned.lifecycleId,
      origin: ORIGIN,
    }), error => error.code === M2LifecycleServiceErrorCode.OWNER_MISMATCH);
    assert.throws(() => service.getSmallProjectChangeStatus({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      origin: { ...ORIGIN, sessionId: 'forged-session' },
    }), error => error.code === M2LifecycleServiceErrorCode.ORIGIN_MISMATCH);

    const cancelled = await service.cancelSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      origin: ORIGIN,
      reason: 'operator_cancelled_before_approval',
    });
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.cancelRequested, true);
    assert.equal(cancelled.result, null);
    assert.equal(cancelled.terminal.errorCode, M2LifecycleServiceErrorCode.CANCELLED);
    assert.equal(cancelled.audit.governanceReceipt, null);
    assert.equal(db.prepare('SELECT count(*) AS count FROM m2_lifecycle_cancel_intents').get().count, 1);
    assert.equal(db.prepare('SELECT count(*) AS count FROM m2_lifecycle_terminals').get().count, 1);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await testAsync('cancel during the focused process aborts execution, rolls bytes back and cannot late-succeed', async () => {
  const root = makeProject();
  const db = openDatabase();
  let releaseStarted;
  const started = new Promise(resolve => { releaseStarted = resolve; });
  const processProvider = Object.freeze({
    async execute({ signal, onSupervisor }) {
      onSupervisor({
        pid: 8123,
        processGroupId: 8123,
        bootId: '11111111-1111-4111-8111-111111111111',
        startIdentity: '901',
      });
      releaseStarted();
      return new Promise(resolve => {
        const cancelled = () => resolve({
          terminalStatus: 'cancelled',
          processGroupState: 'empty',
          exitCode: null,
          signal: 'SIGTERM',
          stdoutDigest: sha(Buffer.alloc(0)),
          stderrDigest: sha(Buffer.alloc(0)),
          outputTruncated: false,
          lateCompletionRejected: false,
        });
        if (signal.aborted) cancelled();
        else signal.addEventListener('abort', cancelled, { once: true });
      });
    },
  });
  try {
    const service = createService(db, root, makeClock(), { processProvider });
    await service.recoverIncompleteSmallProjectChanges();
    const planned = await prepare(service, proposal({ commit: false }));
    const approving = service.approveSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      planDigest: planned.planDigest,
      origin: ORIGIN,
    });
    await started;
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 2;\n');

    const cancelled = await service.cancelSmallProjectChange({
      authenticatedSubject: SUBJECT,
      lifecycleId: planned.lifecycleId,
      origin: ORIGIN,
      reason: 'operator_cancelled_during_focused_test',
    });
    const approvalView = await approving;
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(approvalView.state, 'cancelled');
    assert.equal(cancelled.result.terminalStatus, 'cancelled');
    assert.equal(cancelled.result.rollback.status, 'succeeded');
    assert.equal(cancelled.terminal.state, 'cancelled');
    assert.equal(cancelled.terminal.governanceReceiptDigest, null);
    assert.equal(cancelled.audit.governanceReceipt, null);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});


suite('Bounded model draft — existing M2 execution authority');

await testAsync('default syntax check accepts a CJS hashbang without evaluating its code', async () => {
  const root = makeProject();
  try {
    fs.writeFileSync(path.join(root, 'src/cli.cjs'), '#!/usr/bin/env node\nthrow new Error("must not execute");\n');
    const { focusedTest } = compileCodeDraftInput({ path: 'src/cli.cjs', instruction: 'Check CLI' });
    execFileSync(focusedTest.binary, focusedTest.argv, { cwd: root, stdio: 'pipe', timeout: 30_000 });
    fs.writeFileSync(path.join(root, 'src/cli.cjs'), 'return; throw new Error("must not execute");\n');
    execFileSync(focusedTest.binary, focusedTest.argv, { cwd: root, stdio: 'pipe', timeout: 30_000 });
    fs.writeFileSync(path.join(root, 'src/cli.cjs'), '}); void 0; (function(){');
    assert.throws(() => execFileSync(focusedTest.binary, focusedTest.argv, { cwd: root, stdio: 'pipe', timeout: 30_000 }));
    fs.writeFileSync(path.join(root, 'src/cli.cjs'), '#!/usr/bin/env node\nconst value = ;\n');
    assert.throws(() => execFileSync(focusedTest.binary, focusedTest.argv, { cwd: root, stdio: 'pipe', timeout: 30_000 }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

await testAsync('syntax check treats option-shaped paths only as filenames', async () => {
  const root = makeProject();
  try {
    for (const file of ['--eval=process.exit(0),x.js', '-leading.js']) {
      const { focusedTest } = compileCodeDraftInput({ path: file, instruction: 'Check syntax' });
      fs.writeFileSync(path.join(root, file), 'export const value = 42;\n');
      execFileSync(focusedTest.binary, focusedTest.argv, { cwd: root, stdio: 'pipe', timeout: 30_000 });
      fs.writeFileSync(path.join(root, file), 'export const value = ;\n');
      assert.throws(() => execFileSync(focusedTest.binary, focusedTest.argv, { cwd: root, stdio: 'pipe', timeout: 30_000 }));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

for (const invalidSyntax of [false, true]) {
  await testAsync(`draft then exact approval uses real file/syntax authority (${invalidSyntax ? 'rejected before approval' : 'success'})`, async () => {
    const root = makeProject();
    const db = openDatabase();
    let calls = 0;
    const output = invalidSyntax ? 'export const value = ;\n' : 'export const value = 42;\n';
    try {
      const service = createService(db, root, makeClock(), {
        generateCodeDraft: async ({ prompt, signal }) => {
          calls++;
          assert.equal(signal.aborted, false);
          const input = codeInput(prompt);
          assert.equal(input.path, 'src/app.js');
          assert.equal(input.beforeContent, 'export const value = 1;\n');
          return { content: JSON.stringify({ afterContent: output }), finishReason: 'stop' };
        },
      });
      await service.recoverIncompleteSmallProjectChanges();
      const planning = service.draftSmallProjectChange({
        authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN,
        draft: { path: 'src/app.js', instruction: 'Change the exported value to 42.' },
      });
      if (invalidSyntax) {
        await assert.rejects(planning, { code: 'M2_CODE_DRAFT_OUTPUT_SYNTAX_INVALID' });
        assert.equal(calls, 1);
        assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
        assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
        return;
      }
      const planned = await planning;
      assert.equal(planned.state, 'awaiting_approval');
      assert.equal(calls, 1);
      assert.equal(planned.diff[0].after.content, output);
      assert.equal(planned.plan.focusedTest.binary, process.execPath);
      assert.equal(planned.plan.focusedTest.argv.at(-1), 'src/app.js');
      assert.match(planned.plan.focusedTest.argv[2], /SourceTextModule/);
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_terminals').get().n, 0);
      const result = await service.approveSmallProjectChange({
        authenticatedSubject: SUBJECT, origin: ORIGIN,
        lifecycleId: planned.lifecycleId, planDigest: planned.planDigest,
      });
      assert.equal(result.state, 'succeeded');
      assert.equal(result.result.focusedTest.terminalStatus, 'succeeded');
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), output);
      // Reconstruct the service and recover. Neither model nor write is replayed.
      const restarted = createService(db, root, makeClock(), {
        generateCodeDraft: async () => { throw new Error('unexpected model replay'); },
      });
      await restarted.recoverIncompleteSmallProjectChanges();
      const durable = restarted.getSmallProjectChangeStatus({
        authenticatedSubject: SUBJECT, origin: ORIGIN, lifecycleId: planned.lifecycleId,
      });
      assert.equal(durable.terminal.resultDigest, result.terminal.resultDigest);
      assert.equal(calls, 1);
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
}

for (const failure of ['length', 'extra-file', 'malformed', 'unchanged', 'stale', 'cancel', 'traversal', 'ignored', 'oversize', 'forged-test']) {
  await testAsync(`draft rejects ${failure} before plan, approval and write`, async () => {
    const root = makeProject();
    const db = openDatabase();
    const controller = new AbortController();
    let calls = 0;
    try {
      const service = createService(db, root, makeClock(), {
        generateCodeDraft: async () => {
          calls++;
          if (failure === 'stale') fs.writeFileSync(path.join(root, 'src', 'foreign.js'), 'export const changed = true;\n');
          if (failure === 'cancel') controller.abort();
          const value = { afterContent: failure === 'unchanged' ? 'export const value = 1;\n' : 'export const value = 42;\n' };
          if (failure === 'extra-file') value.path = 'src/other.js';
          return { content: failure === 'malformed' ? '```javascript\nexport const value=42;\n```' : JSON.stringify(value),
            finishReason: failure === 'length' ? 'length' : 'stop' };
        },
      });
      await service.recoverIncompleteSmallProjectChanges();
      const draft = { path: 'src/app.js', instruction: 'Change the exported value to 42.' };
      if (failure === 'traversal') draft.path = '../outside.js';
      if (failure === 'ignored') draft.path = '.intentsmith/private.js';
      if (failure === 'oversize') draft.instruction = 'x'.repeat(513);
      if (failure === 'forged-test') draft.focusedTest = { binary: 'sh', argv: ['-c', 'anything'] };
      const expected = {
        length: 'M2_CODE_DRAFT_OUTPUT_INCOMPLETE', 'extra-file': 'M2_CODE_DRAFT_OUTPUT_INVALID',
        malformed: 'M2_CODE_DRAFT_OUTPUT_INVALID', unchanged: 'M2_CODE_DRAFT_OUTPUT_UNCHANGED',
        stale: 'M2_LIFECYCLE_CONTEXT_STALE', cancel: 'M2_CODE_DRAFT_CANCELLED',
        traversal: 'M2_PROPOSAL_CHANGE_PATH_INVALID', ignored: 'M2_CODE_DRAFT_PATH_INVALID',
        oversize: 'M2_CODE_DRAFT_INPUT_INVALID', 'forged-test': 'M2_PROPOSAL_FOCUSED_TEST_KEYS_INVALID',
      };
      await assert.rejects(service.draftSmallProjectChange({
        authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN, draft, signal: controller.signal,
      }), { code: expected[failure] });
      assert.equal(calls, ['traversal', 'ignored', 'oversize', 'forged-test'].includes(failure) ? 0 : 1);
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

suite('Bounded multi-file draft — one atomic approval');

for (const invalidLastFile of [false, true]) {
  await testAsync(`three-file draft is atomic (${invalidLastFile ? 'last file syntax prevents whole plan' : 'functional import succeeds'})`, async () => {
    const root = makeProject();
    const db = openDatabase();
    const outputs = ["import {answer} from './helper.js'; export const value = answer;\n",
      'export const okay = true;\n', invalidLastFile ? 'export const answer = ;\n' : 'export const answer = 42;\n'];
    const paths = ['src/app.js', 'src/extra.js', 'src/helper.js'];
    let calls = 0;
    try {
      const service = createService(db, root, makeClock(), {
        generateCodeDraft: async ({ prompt }) => {
          const input = codeInput(prompt);
          assert.equal(input.path, paths[calls]);
          assert.equal(input.peerFiles.length, 2);
          if (calls > 0) {
            assert.deepEqual(input.peerFiles.find(file => file.path === paths[0]),
              { path: paths[0], content: outputs[0], state: 'proposed' });
          }
          // No earlier model output may be materialized before exact approval.
          assert.equal(fs.readFileSync(path.join(root, paths[0]), 'utf8'), 'export const value = 1;\n');
          assert.equal(fs.existsSync(path.join(root, paths[1])), false);
          return { content: JSON.stringify({ afterContent: outputs[calls++] }), finishReason: 'stop' };
        },
      });
      await service.recoverIncompleteSmallProjectChanges();
      const draft = { paths, instruction: 'Export value from helper and add the extra flag.' };
      if (!invalidLastFile) draft.focusedTest = { binary: process.execPath,
        argv: [...projectTestProfile().argv.slice(0, -2), ...defaultModuleTypeArgs, '--input-type=module', '-e',
          "import assert from 'node:assert/strict';import {value} from './src/app.js';import {okay} from './src/extra.js';assert.equal(value,42);assert.equal(okay,true);"],
        environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000 };
      const planning = service.draftSmallProjectChange({
        authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN, draft,
      });
      if (invalidLastFile) {
        await assert.rejects(planning, { code: 'M2_CODE_DRAFT_OUTPUT_SYNTAX_INVALID' });
        assert.equal(calls, 3);
        assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
        assert.equal(fs.readFileSync(path.join(root, paths[0]), 'utf8'), 'export const value = 1;\n');
        for (const target of paths.slice(1)) assert.equal(fs.existsSync(path.join(root, target)), false);
        return;
      }
      const planned = await planning;
      assert.equal(calls, 3);
      assert.equal(planned.state, 'awaiting_approval');
      assert.deepEqual(planned.diff.map(file => file.path), paths);
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 1);
      const result = await service.approveSmallProjectChange({ authenticatedSubject: SUBJECT, origin: ORIGIN,
        lifecycleId: planned.lifecycleId, planDigest: planned.planDigest });
      assert.equal(result.state, 'succeeded');
      for (let index = 0; index < paths.length; index++)
        assert.equal(fs.readFileSync(path.join(root, paths[index]), 'utf8'), outputs[index]);
      const restarted = createService(db, root, makeClock(), {
        generateCodeDraft: async () => { throw new Error('unexpected model replay'); },
      });
      await restarted.recoverIncompleteSmallProjectChanges();
      const durable = restarted.getSmallProjectChangeStatus({ authenticatedSubject: SUBJECT, origin: ORIGIN,
        lifecycleId: planned.lifecycleId });
      assert.equal(durable.terminal.resultDigest, result.terminal.resultDigest);
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
}

for (const invalidSyntax of [true, false]) {
  await testAsync(`bad first peer (${invalidSyntax ? 'syntax stops before propagation' : 'functional error propagates and rolls back'})`, async () => {
    const root = makeProject();
    const db = openDatabase();
    const paths = ['src/app.js', 'src/copy.js', 'src/view.js'];
    const outputs = [invalidSyntax ? 'export const value = ;\n' : 'export const value = 41;\n',
      "import {value} from './app.js'; export const copied = value;\n",
      "import {copied} from './copy.js'; export const displayed = copied;\n"];
    let calls = 0;
    try {
      const service = createService(db, root, makeClock(), {
        generateCodeDraft: async ({ prompt }) => {
          const input = codeInput(prompt);
          assert.equal(input.path, paths[calls]);
          if (calls > 0) assert.deepEqual(input.peerFiles.find(file => file.path === paths[0]),
            { path: paths[0], content: outputs[0], state: 'proposed' });
          if (calls === 2) assert.deepEqual(input.peerFiles.find(file => file.path === paths[1]),
            { path: paths[1], content: outputs[1], state: 'proposed' });
          assert.equal(fs.readFileSync(path.join(root, paths[0]), 'utf8'), 'export const value = 1;\n');
          assert.equal(fs.existsSync(path.join(root, paths[1])), false);
          assert.equal(fs.existsSync(path.join(root, paths[2])), false);
          return { content: JSON.stringify({ afterContent: outputs[calls++] }), finishReason: 'stop' };
        },
      });
      await service.recoverIncompleteSmallProjectChanges();
      const draft = { paths, instruction: 'Export 42 from app and propagate it through copy and view.' };
      if (!invalidSyntax) draft.focusedTest = { binary: process.execPath,
        argv: [...projectTestProfile().argv.slice(0, -2), ...defaultModuleTypeArgs, '--input-type=module', '-e',
          "import assert from 'node:assert/strict';import {displayed} from './src/view.js';assert.equal(displayed,42,'transitive peer result');"],
        environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000 };
      const planning = service.draftSmallProjectChange({
        authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN, draft,
      });
      if (invalidSyntax) {
        await assert.rejects(planning, { code: 'M2_CODE_DRAFT_OUTPUT_SYNTAX_INVALID' });
        assert.equal(calls, 1);
        assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
        assert.equal(fs.readFileSync(path.join(root, paths[0]), 'utf8'), 'export const value = 1;\n');
        for (const target of paths.slice(1)) assert.equal(fs.existsSync(path.join(root, target)), false);
        return;
      }
      const planned = await planning;
      assert.equal(calls, 3);
      assert.equal(planned.state, 'awaiting_approval');
      assert.deepEqual(planned.diff.map(file => file.after.content), outputs);
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 1);
      assert.equal(fs.readFileSync(path.join(root, paths[0]), 'utf8'), 'export const value = 1;\n');
      const result = await service.approveSmallProjectChange({ authenticatedSubject: SUBJECT, origin: ORIGIN,
        lifecycleId: planned.lifecycleId, planDigest: planned.planDigest });
      assert.notEqual(result.state, 'succeeded');
      assert.equal(result.result.focusedTest.terminalStatus, 'failed');
      assert.equal(result.result.rollback.status, 'succeeded');
      assert.equal(fs.readFileSync(path.join(root, paths[0]), 'utf8'), 'export const value = 1;\n');
      assert.equal(fs.existsSync(path.join(root, paths[1])), false);
      assert.equal(fs.existsSync(path.join(root, paths[2])), false);
      const restarted = createService(db, root, makeClock(), {
        generateCodeDraft: async () => { throw new Error('unexpected model replay'); },
      });
      await restarted.recoverIncompleteSmallProjectChanges();
      const durable = restarted.getSmallProjectChangeStatus({ authenticatedSubject: SUBJECT,
        origin: ORIGIN, lifecycleId: planned.lifecycleId });
      assert.equal(durable.state, result.state);
      assert.equal(durable.terminal.resultDigest, result.terminal.resultDigest);
      assert.notEqual(durable.state, 'succeeded');
      assert.equal(calls, 3);
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
}

for (const failure of ['second-length', 'second-cancel', 'second-malformed', 'second-stale',
  'peer-overflow', 'initial-overflow', 'duplicate', 'too-many', 'mixed-path-keys', 'ignored-second']) {
  await testAsync(`multi-file ${failure} leaves no partial plan or effect`, async () => {
    const root = makeProject();
    const db = openDatabase();
    const controller = new AbortController();
    let calls = 0;
    try {
      if (failure === 'initial-overflow') {
        for (const file of ['src/a.js', 'src/b.js']) fs.writeFileSync(path.join(root, file), '//'+ 'x'.repeat(900)+'\n');
        git(root, ['add', '--', 'src/a.js', 'src/b.js']);
        git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'large peers']);
      }
      const service = createService(db, root, makeClock(), {
        generateCodeDraft: async () => {
          calls++;
          if (calls === 2 && failure === 'second-cancel') controller.abort();
          if (calls === 2 && failure === 'second-stale') fs.writeFileSync(path.join(root, 'src/foreign.js'), '// foreign\n');
          return { content: calls === 2 && failure === 'second-malformed' ? 'invalid' : JSON.stringify({
            afterContent: failure === 'peer-overflow' ? '//'+ 'x'.repeat(2000)+'\n' : 'export const value = 42;\n',
          }), finishReason: calls === 2 && failure === 'second-length' ? 'length' : 'stop' };
        },
      });
      await service.recoverIncompleteSmallProjectChanges();
      const draft = { paths: ['src/app.js', 'src/a.js', 'src/b.js'], instruction: 'Update these files.' };
      if (failure === 'duplicate') draft.paths[1] = draft.paths[0];
      if (failure === 'too-many') draft.paths.push('src/c.js');
      if (failure === 'mixed-path-keys') draft.path = 'src/app.js';
      if (failure === 'ignored-second') draft.paths[1] = '.intentsmith/private.js';
      const expected = {
        'second-length': 'M2_CODE_DRAFT_OUTPUT_INCOMPLETE', 'second-cancel': 'M2_CODE_DRAFT_CANCELLED',
        'second-malformed': 'M2_CODE_DRAFT_OUTPUT_INVALID', 'second-stale': 'M2_LIFECYCLE_CONTEXT_STALE',
        'peer-overflow': 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED', 'initial-overflow': 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED',
        duplicate: 'M2_PROPOSAL_CHANGE_PATH_DUPLICATE', 'too-many': 'M2_CODE_DRAFT_INPUT_INVALID',
        'mixed-path-keys': 'M2_CODE_DRAFT_INPUT_INVALID', 'ignored-second': 'M2_CODE_DRAFT_PATH_INVALID',
      };
      await assert.rejects(service.draftSmallProjectChange({ authenticatedSubject: SUBJECT,
        projectId: PROJECT_ID, origin: ORIGIN, draft, signal: controller.signal }), { code: expected[failure] });
      assert.equal(calls, failure === 'second-stale' ? 3 : failure.startsWith('second-') ? 2 : failure === 'peer-overflow' ? 1 : 0);
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
      if (failure !== 'initial-overflow') assert.equal(fs.existsSync(path.join(root, 'src/a.js')), false);
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

await testAsync('cancel during final preparation keeps draft cancellation taxonomy and stores no plan', async () => {
  const root = makeProject();
  const db = openDatabase();
  const controller = new AbortController();
  let generated = false;
  try {
    const service = createService(db, root, makeClock(), {
      projects: { findById: { get(id) {
        if (generated) controller.abort();
        return id === PROJECT_ID ? { id, path: root, status: 'active' } : null;
      } } },
      generateCodeDraft: async () => {
        generated = true;
        return { content: JSON.stringify({ afterContent: 'export const value = 42;\n' }), finishReason: 'stop' };
      },
    });
    await service.recoverIncompleteSmallProjectChanges();
    await assert.rejects(service.draftSmallProjectChange({ authenticatedSubject: SUBJECT,
      projectId: PROJECT_ID, origin: ORIGIN, signal: controller.signal,
      draft: { path: 'src/app.js', instruction: 'Change value to 42.' } }), { code: 'M2_CODE_DRAFT_CANCELLED' });
    assert.equal(generated, true);
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

function projectBlueprint() {
  const files = [
    ['src/app.js', 'Re-export run from cli as the public entrypoint.', ['src/cli.js']],
    ['src/cli.js', 'Export run(commands): add takes amount/category; list, total, categories return results; unknown operation throws. Each run has a fresh service.', ['src/service.js']],
    ['src/service.js', 'Export createService(): expose ledger add/list, total() and categories() using the totals module.', ['src/storage.js', 'src/totals.js']],
    ['src/storage.js', 'Export createLedger(): add(amount,category) validates and stores one item; list() returns copies.', ['src/validate.js']],
    ['src/totals.js', 'Export total(rows) and categories(rows), summing numeric amount, also grouped by category.', []],
    ['src/validate.js', 'Export validate(amount,category), throwing for nonpositive/nonfinite amount or empty/nonstring category.', []],
  ];
  return {
    instruction: 'Build a small in-memory expense ledger with a command entrypoint and no external dependencies.',
    files: files.map(([path, instruction, dependsOn]) => ({ path, instruction, dependsOn })),
    focusedTest: {
      binary: process.execPath,
      argv: [...projectTestProfile().argv.slice(0, projectTestProfile().argv.indexOf('--test')), ...defaultModuleTypeArgs, '--input-type=module', '-e',
        "import assert from 'node:assert/strict';import {run} from './src/app.js';assert.equal(new WebAssembly.Memory({initial:1}).buffer.byteLength,65536);const results=run([['add',12,'food'],['add',8,'travel'],['add',3,'food'],['total'],['categories'],['list']]);assert.equal(results[3],23);assert.deepEqual(results[4],{food:15,travel:8});assert.equal(results[5].length,3);assert.deepEqual(run([['list'],['total']]),[[],0]);for(const amount of [0,-1,NaN,Infinity])assert.throws(()=>run([['add',amount,'food']]));assert.throws(()=>run([['add',1,'']]));assert.throws(()=>run([['unknown']]));"],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000,
    },
    gitCommit: proposal().gitCommit,
  };
}

const projectBuildOutputs = {
  'src/app.js': "export {run} from './cli.js';\n",
  'src/cli.js': "import {createService} from './service.js';export function run(commands){const service=createService();return commands.map(([op,...args])=>{if(!['add','list','total','categories'].includes(op))throw Error('unknown operation');return service[op](...args);});}\n",
  'src/service.js': "import {createLedger} from './storage.js';import {total,categories} from './totals.js';export function createService(){const ledger=createLedger();return {...ledger,total:()=>total(ledger.list()),categories:()=>categories(ledger.list())};}\n",
  'src/storage.js': "import {validate} from './validate.js';export function createLedger(){const rows=[];return {add(amount,category){validate(amount,category);rows.push({amount,category});return {amount,category};},list(){return rows.map(row=>({...row}));}};}\n",
  'src/totals.js': "export const total=rows=>rows.reduce((sum,row)=>sum+row.amount,0);export function categories(rows){const sums={};for(const row of rows)Object.defineProperty(sums,row.category,{value:(Object.hasOwn(sums,row.category)?sums[row.category]:0)+row.amount,writable:true,enumerable:true,configurable:true});return sums;}\n",
  'src/validate.js': "export function validate(amount,category){if(!Number.isFinite(amount)||amount<=0||typeof category!=='string'||!category.trim())throw Error('invalid expense');}\n",
};
const projectBuildOrder = ['src/totals.js', 'src/validate.js', 'src/storage.js', 'src/service.js', 'src/cli.js', 'src/app.js'];

suite('Explicit project blueprint — existing M2 execution authority');

for (const defect of [null, 'src/totals.js', 'src/app.js']) {
  await testAsync(`six-file dependency build with fixed behavioral test: ${defect ?? 'success and exact commit'}`, async () => {
    const root = makeProject();
    const authorityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-build-authority-'));
    const databasePath = path.join(authorityRoot, 'authority.sqlite');
    const db = openDatabase(databasePath);
    const blueprint = projectBlueprint();
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const outputs = { ...projectBuildOutputs };
    if (defect === 'src/totals.js') outputs[defect] = outputs[defect].replace('sum+row.amount', 'sum');
    if (defect === 'src/app.js') outputs[defect] = 'export const run=()=>[];\n';
    const calls = [];
    try {
      const service = createService(db, root, makeClock(), {
        generateCodeDraft: async ({ prompt }) => {
          const input = codeInput(prompt);
          const definition = blueprint.files.find(file => file.path === input.path);
          assert.equal(input.path, projectBuildOrder[calls.length]);
          assert.equal(input.fileInstruction, definition.instruction);
          assert.equal(input.filePlan.length, blueprint.files.length);
          assert.ok(input.filePlan.every(file => !Object.hasOwn(file, 'instruction')),
            'other targets must not compete with the current file instruction');
          assert.deepEqual(input.filePlan.find(file => file.path === input.path).dependsOn, definition.dependsOn);
          assert.equal(input.beforeContent, input.path === 'src/app.js' ? 'export const value = 1;\n' : null);
          assert.deepEqual(input.peerFiles ?? [], definition.dependsOn.map(path => ({ path, content: outputs[path], state: 'proposed' })));
          for (const dependency of definition.dependsOn) assert.ok(calls.includes(dependency));
          assert.equal(Object.hasOwn(input, 'focusedTest'), false, 'fixed author test is not model output');
          assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
          for (const file of blueprint.files.slice(1)) assert.equal(fs.existsSync(path.join(root, file.path)), false);
          calls.push(input.path);
          return { content: JSON.stringify({ afterContent: outputs[input.path] }), finishReason: 'stop' };
        },
      });
      await service.recoverIncompleteSmallProjectChanges();
      const planned = await service.draftSmallProjectChange({ authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN, draft: blueprint });
      assert.equal(planned.state, 'awaiting_approval');
      assert.deepEqual(calls, projectBuildOrder);
      assert.deepEqual(planned.diff.map(file => file.path), Object.keys(outputs).sort());
      assert.deepEqual(planned.diff.map(file => file.after.content), Object.keys(outputs).sort().map(path => outputs[path]));
      assert.deepEqual(planned.plan.focusedTest.argv, blueprint.focusedTest.argv);
      assert.equal(planned.plan.gitCommit.messageDigest, sha(JSON.stringify(blueprint.gitCommit.message)));
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 1);
      const result = await service.approveSmallProjectChange({ authenticatedSubject: SUBJECT, origin: ORIGIN,
        lifecycleId: planned.lifecycleId, planDigest: planned.planDigest });
      if (defect) {
        assert.notEqual(result.state, 'succeeded');
        assert.equal(result.result.focusedTest.terminalStatus, 'failed');
        const diagnostic = result.audit.executionEvents.find(event => event.type === 'process_terminated')?.details.testOutput;
        assert.ok(diagnostic, 'failed real test exposes bounded diagnostics, not only stream hashes');
        assert.match(diagnostic.stdout + diagnostic.stderr, /AssertionError/);
        assert.ok(Buffer.byteLength(diagnostic.stdout) <= 4100 && Buffer.byteLength(diagnostic.stderr) <= 4100);
        assert.equal(result.result.rollback.status, 'succeeded');
        assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
        for (const file of blueprint.files.slice(1)) assert.equal(fs.existsSync(path.join(root, file.path)), false);
        assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
      } else {
        assert.equal(result.state, 'succeeded');
        assert.equal(result.result.focusedTest.terminalStatus, 'succeeded');
        assert.equal(result.result.git.status, 'committed');
        assert.notEqual(git(root, ['rev-parse', 'HEAD']), beforeHead);
        for (const file of blueprint.files) assert.equal(fs.readFileSync(path.join(root, file.path), 'utf8'), outputs[file.path]);
      }
      assert.equal(git(root, ['status', '--porcelain=v1']), '');
      db.close();
      // A new Node process opens the on-disk authority after execution. This
      // proves terminal restart persistence, not a crash during an effect.
      const restartScript = `
        import Database from 'better-sqlite3';
        import { createDefaultM2LifecycleApplicationService } from './src/lifecycle/m2-lifecycle-application-service.js';
        const [databasePath,root,lifecycleId,subjectJson,originJson]=process.argv.slice(1);
        const db=new Database(databasePath);db.pragma('foreign_keys = ON');
        try {
          const subject=JSON.parse(subjectJson),origin=JSON.parse(originJson);
          const service=createDefaultM2LifecycleApplicationService({database:db,
            projects:{findById:{get:id=>id===origin.projectId?{id,path:root,status:'active'}:null}},
            generateCodeDraft:async()=>{throw Error('unexpected model replay');}});
          const recovered=await service.recoverIncompleteSmallProjectChanges();
          const view=service.getSmallProjectChangeStatus({authenticatedSubject:subject,origin,lifecycleId});
          process.stdout.write(JSON.stringify({pid:process.pid,state:view.state,
            resultDigest:view.terminal.resultDigest,recovered:recovered.length,
            testOutput:view.audit.executionEvents.find(event=>event.type==='process_terminated')?.details.testOutput,
            terminals:db.prepare('SELECT count(*) AS n FROM m2_lifecycle_terminals').get().n}));
        } finally {db.close();}
      `;
      const durable = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', restartScript, '--',
        databasePath, root, planned.lifecycleId, JSON.stringify(SUBJECT), JSON.stringify(ORIGIN)],
      { encoding: 'utf8', timeout: 15_000 }));
      assert.notEqual(durable.pid, process.pid);
      assert.equal(durable.state, result.state);
      assert.equal(durable.resultDigest, result.terminal.resultDigest);
      assert.deepEqual(durable.testOutput, result.audit.executionEvents.find(event => event.type === 'process_terminated')?.details.testOutput);
      assert.equal(durable.recovered, 0);
      assert.equal(durable.terminals, 1);
      assert.equal(calls.length, 6);
    } finally {
      if (db.open) db.close();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(authorityRoot, { recursive: true, force: true });
    }
  }, 60_000);
}

for (const failure of ['missing-test', 'duplicate', 'unknown-dependency', 'cycle', 'too-many', 'extra-authority', 'traversal', 'file-instruction-limit',
  'missing-parent', 'file-parent', 'dependency-overflow', 'late-length', 'late-cancel', 'late-stale', 'late-syntax']) {
  await testAsync(`blueprint ${failure} preserves targets and creates no partial approval`, async () => {
    const root = makeProject();
    const db = openDatabase();
    const controller = new AbortController();
    const blueprint = projectBlueprint();
    let calls = 0;
    try {
      if (failure === 'missing-test') delete blueprint.focusedTest;
      if (failure === 'duplicate') blueprint.files[1].path = blueprint.files[0].path;
      if (failure === 'unknown-dependency') blueprint.files[0].dependsOn = ['src/unknown.js'];
      if (failure === 'cycle') blueprint.files.at(-1).dependsOn = ['src/app.js'];
      if (failure === 'too-many') blueprint.files = Array.from({ length: 33 }, (_, index) => ({ path: `src/p${index}.js`, instruction: 'Export a value.', dependsOn: [] }));
      if (failure === 'extra-authority') blueprint.actor = { actorType: 'system' };
      if (failure === 'traversal') blueprint.files[0].path = '../outside.js';
      if (failure === 'file-instruction-limit') blueprint.files[0].instruction = 'x'.repeat(513);
      if (failure === 'missing-parent') blueprint.files[0].path = 'src/new-area/app.js';
      if (failure === 'file-parent') blueprint.files[0].path = 'src/app.js/nested.js';
      const service = createService(db, root, makeClock(), { generateCodeDraft: async ({ prompt }) => {
        const input = codeInput(prompt); calls++;
        if (calls === 4 && failure === 'late-cancel') controller.abort();
        if (calls === 4 && failure === 'late-stale') fs.writeFileSync(path.join(root, 'src/foreign.js'), '// foreign\n');
        return { content: JSON.stringify({ afterContent: failure === 'dependency-overflow' && calls <= 3 ? '//'+ 'x'.repeat(16000)+'\n' : failure === 'late-syntax' && calls === 4 ? 'export function broken() {' : projectBuildOutputs[input.path] }),
          finishReason: calls === 4 && failure === 'late-length' ? 'length' : 'stop' };
      } });
      await service.recoverIncompleteSmallProjectChanges();
      const expected = { 'missing-parent': 'M2_CODE_DRAFT_PARENT_UNAVAILABLE', 'file-parent': 'M2_CODE_DRAFT_PATH_INVALID', cycle: 'M2_CODE_DRAFT_DEPENDENCY_CYCLE', traversal: 'M2_PROPOSAL_CHANGE_PATH_INVALID',
        'dependency-overflow': 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED', 'late-length': 'M2_CODE_DRAFT_OUTPUT_INCOMPLETE',
        'late-syntax': 'M2_CODE_DRAFT_OUTPUT_SYNTAX_INVALID', 'late-cancel': 'M2_CODE_DRAFT_CANCELLED', 'late-stale': 'M2_LIFECYCLE_CONTEXT_STALE' };
      await assert.rejects(service.draftSmallProjectChange({ authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN,
        draft: blueprint, signal: controller.signal }), { code: expected[failure] ?? 'M2_CODE_DRAFT_INPUT_INVALID' });
      assert.equal(calls, failure === 'dependency-overflow' ? 3 : failure === 'late-stale' ? 6 : failure.startsWith('late-') ? 4 : 0);
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
      for (const file of Object.keys(projectBuildOutputs).filter(path => path !== 'src/app.js')) assert.equal(fs.existsSync(path.join(root, file)), false);
      if (failure === 'late-stale') assert.equal(fs.readFileSync(path.join(root, 'src/foreign.js'), 'utf8'), '// foreign\n');
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

for (const defect of [null, 'missing', 'traversal', 'target-overlap', 'secret', 'oversize', 'late-stale']) {
  await testAsync(`existing project context is read-only and revision-bound: ${defect ?? 'success'}`, async () => {
    const root = makeProject(); const db = openDatabase(); let calls = 0;
    const contextPath = 'src/prior-step.js';
    const content = 'export const priorValue = 42;\n';
    fs.writeFileSync(path.join(root, contextPath), defect === 'oversize' ? 'x'.repeat(16_385) : content);
    git(root, ['add', '--', contextPath]);
    git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'previous increment']);
    const reference = ({ missing: 'src/absent.js', traversal: '../outside.js', 'target-overlap': 'src/app.js', secret: '.env' })[defect] || contextPath;
    const blueprint = { instruction: 'Use the existing module without rewriting it.',
      files: [{ path: 'src/app.js', instruction: 'Re-export priorValue as value.', dependsOn: [], contextFiles: [reference] }],
      focusedTest: proposal().focusedTest };
    try {
      const service = createService(db, root, makeClock(), { generateCodeDraft: async ({ prompt }) => {
        calls++; const input = codeInput(prompt);
        assert.deepEqual(input.peerFiles, [{ path: contextPath, content, state: 'read_only', contentDigest: sha(content) }]);
        if (defect === 'late-stale') fs.writeFileSync(path.join(root, contextPath), 'export const priorValue = 99;\n');
        return { content: JSON.stringify({ afterContent: "export {priorValue as value} from './prior-step.js';\n" }), finishReason: 'stop' };
      } });
      await service.recoverIncompleteSmallProjectChanges();
      const execute = () => service.draftSmallProjectChange({ authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN, draft: blueprint });
      if (defect) {
        const codes = { missing: 'M2_CODE_DRAFT_CONTEXT_UNAVAILABLE', traversal: 'M2_CODE_DRAFT_INPUT_INVALID',
          'target-overlap': 'M2_CODE_DRAFT_INPUT_INVALID', secret: 'M2_CODE_DRAFT_CONTEXT_UNAVAILABLE',
          oversize: 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED', 'late-stale': 'M2_LIFECYCLE_CONTEXT_STALE' };
        await assert.rejects(execute(), { code: codes[defect] });
        assert.equal(calls, defect === 'late-stale' ? 1 : 0);
        assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
      } else {
        const planned = await execute();
        assert.equal(planned.state, 'awaiting_approval');
        assert.deepEqual(planned.diff.map(file => file.path), ['src/app.js']);
        assert.equal(fs.readFileSync(path.join(root, contextPath), 'utf8'), content);
      }
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

await testAsync('indexed full-source context roundtrips graphs, UTF-8, escapes and read-only provenance', async () => {
  const content = `export const text = ${JSON.stringify('č雪🙂"\\\n\u0000 @0:2\n indexed-full/v1')};\n`;
  for (const count of [1, 2, 7, 32]) {
    const files = Array.from({ length: count }, (_, index) => ({
      path: `src/shared-long-module-${index}.js`, instruction: `Implement module ${index}.`,
      dependsOn: index === count - 1 ? Array.from({ length: index }, (_, value) => `src/shared-long-module-${value}.js`) : [],
      contextFiles: index === count - 1 ? ['src/existing-module.js'] : [],
    }));
    const compiled = compileCodeDraftInput({ instruction: 'Use complete dependencies without changing them.',
      files, focusedTest: proposal().focusedTest });
    const step = compiled.buildSteps.at(-1);
    const peers = step.dependsOn.map((path, index) => ({ path, content: index === 0 ? null : content,
      state: index === 0 ? 'original' : 'proposed' }));
    peers.push({ path: 'src/existing-module.js', content, state: 'read_only', contentDigest: sha(content) });
    const message = buildCodeDraftPrompt(compiled, content, step.index, peers);
    const expected = { path: compiled.changes[step.index].path,
      filePlan: compiled.buildSteps.map(item => ({ path: compiled.changes[item.index].path, dependsOn: item.dependsOn })),
      beforeContent: content, peerFiles: peers, instruction: compiled.intent, fileInstruction: step.instruction };
    assert.deepEqual(codeInput(message.prompt), expected);
    assert.equal(buildCodeDraftPrompt(compiled, content, step.index, peers).prompt, message.prompt,
      'same complete inputs have canonical transport bytes');
    assert.ok(message.systemPrompt.endsWith(' indexed-full/v1: path uses paths indexes; filePlan=[path,dependsOnIndexes,state?]; peerFiles=[path,content,state,contentDigest?].'));
    assert.deepEqual(codeInput(message.prompt).peerFiles.at(-1), peers.at(-1));
    assert.equal(codeInput(message.prompt).beforeContent, content);
  }
});

await testAsync('indexed transport preserves retained repair source and exact byte-budget boundaries', async () => {
  const retained = 'export const helper = "雪\\\\\\\"";\n';
  const compiled = compileCodeDraftInput({ instruction: 'Repair the proposal without editing its retained dependency.',
    revisionOf: { lifecycleId: 'previous-plan', planDigest: sha('previous-plan') },
    files: [
      { path: 'src/app.js', instruction: 'Set value to 3.', dependsOn: ['src/helper.js'] },
      { path: 'src/helper.js', instruction: 'Retain.', dependsOn: [], reusePrevious: true },
    ], focusedTest: proposal().focusedTest });
  const index = compiled.changes.findIndex(change => change.path === 'src/app.js');
  const before = 'export const value = 1;\n';
  const previous = { content: 'export const value = 2;\n', state: 'unapplied_proposal', contentDigest: sha('export const value = 2;\n') };
  const peers = [{ path: 'src/helper.js', content: retained, state: 'proposed' }];
  const message = buildCodeDraftPrompt(compiled, before, index, peers, previous);
  const decoded = codeInput(message.prompt);
  assert.deepEqual(decoded.previousDraft, previous);
  assert.equal(decoded.onDiskContentDigest, sha(before));
  assert.equal(Object.hasOwn(decoded, 'beforeContent'), false);
  assert.deepEqual(decoded.peerFiles, peers);
  assert.equal(decoded.filePlan.find(row => row.path === 'src/helper.js').state, 'retained_without_generation');
  const empty = buildCodeDraftPrompt(compiled, '', index, peers);
  const cap = 8736;
  const padding = cap - Buffer.byteLength(empty.prompt + empty.systemPrompt);
  assert.ok(padding > 0);
  const exact = buildCodeDraftPrompt(compiled, 'a'.repeat(padding), index, peers);
  assert.equal(Buffer.byteLength(exact.prompt + exact.systemPrompt), cap);
  assert.doesNotThrow(() => assertCodeDraftModelBudget(exact, { maxPromptBytes: cap }));
  assert.throws(() => assertCodeDraftModelBudget(
    buildCodeDraftPrompt(compiled, 'a'.repeat(padding + 1), index, peers), { maxPromptBytes: cap }),
  { code: 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED' });
  const unicode = buildCodeDraftPrompt(compiled, '雪'.repeat(padding), index, peers);
  assert.equal(Buffer.byteLength(unicode.prompt + unicode.systemPrompt), cap + padding * 2);
  assert.throws(() => assertCodeDraftModelBudget(unicode, { maxPromptBytes: cap }),
    { code: 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED' });
});

await testAsync('indexed context rejects absent, duplicate, foreign and stale dependency data', async () => {
  const compiled = compileCodeDraftInput({ instruction: 'Use the existing dependency.',
    files: [{ path: 'src/app.js', instruction: 'Use priorValue.', dependsOn: [], contextFiles: ['src/prior.js'] }],
    focusedTest: proposal().focusedTest });
  const content = 'export const priorValue = 42;\n';
  const peer = { path: 'src/prior.js', content, state: 'read_only', contentDigest: sha(content) };
  for (const peers of [[], [peer, peer], [{ ...peer, path: 'src/foreign.js' }],
    [{ ...peer, contentDigest: sha('old bytes') }], [{ ...peer, state: 'summarized' }], [{ ...peer, content: null }]]) {
    assert.throws(() => buildCodeDraftPrompt(compiled, null, 0, peers),
      { code: 'M2_CODE_DRAFT_CONTEXT_UNAVAILABLE' });
  }
  assert.doesNotThrow(() => buildCodeDraftPrompt(compiled, null, 0, [peer]));
  // The legacy small-change wire still uses ordinary objects and string paths.
  const small = compileCodeDraftInput({ path: 'src/app.js', instruction: 'Set value to 2.' });
  const legacy = buildCodeDraftPrompt(small, content);
  assert.deepEqual(JSON.parse(legacy.prompt), { path: 'src/app.js', beforeContent: content, instruction: small.intent });
  assert.equal(legacy.systemPrompt.includes('indexed-full'), false);
});

await testAsync('trusted normal edit policy freezes exact project/path/digest and rejects malformed opt-ins', async () => {
  const target = { path: 'src/app.js', beforeDigest: sha('export const value = 1;\n') };
  const input = { kind: CODE_DRAFT_NORMAL_EDIT_OUTPUT, projectId: PROJECT_ID, targets: [target] };
  const policy = compileCodeDraftEditPolicy(input);
  assert.equal(parseCodeDraftEditPolicy(undefined), null);
  assert.equal(parseCodeDraftEditPolicy(''), null);
  assert.deepEqual(parseCodeDraftEditPolicy(JSON.stringify(input)), policy);
  target.beforeDigest = sha('changed caller metadata');
  assert.notEqual(policy.targets[0].beforeDigest, target.beforeDigest);
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(policy.targets) && Object.isFrozen(policy.targets[0]));
  for (const invalid of [{}, { ...input, kind: 'fuzzy' }, { ...input, projectId: 0 },
    { ...input, targets: [] }, { ...input, targets: [target, target] },
    { ...input, targets: [{ ...target, path: '../outside.js' }] },
    { ...input, targets: [{ ...target, beforeDigest: null }] }, { ...input, authority: 'approve' }]) {
    assert.throws(() => compileCodeDraftEditPolicy(invalid), { code: 'M2_CODE_DRAFT_EDIT_POLICY_INVALID' });
  }
  assert.throws(() => parseCodeDraftEditPolicy('{'), { code: 'M2_CODE_DRAFT_EDIT_POLICY_INVALID' });
});

await testAsync('normal anchored edits bind complete UTF-8 disk bytes and preserve all untouched spans', async () => {
  const source = '// Česko 雪 🙂 " \\\r\nexport const first = 1;\r\nexport const second = 2;\r\n';
  const compiled = compileCodeDraftInput({ instruction: 'Modify the observed source.',
    files: [{ path: 'src/app.js', instruction: 'Change both values.', dependsOn: [] }],
    focusedTest: proposal().focusedTest });
  const base = captureCodeDraftEditBase('src/app.js', source, sha(source));
  const prompt = buildCodeDraftPrompt(compiled, source, 0, [], null, base);
  const input = codeInput(prompt.prompt);
  assert.equal(input.beforeContent, source);
  assert.equal(input.beforeContentDigest, sha(source));
  assert.equal(prompt.outputContract, CODE_DRAFT_NORMAL_EDIT_OUTPUT);
  assert.equal(prompt.repairBuild, false);
  assert.equal(Object.hasOwn(input, 'previousDraft'), false);
  assert.equal(Object.hasOwn(input, 'editBase'), false, 'complete before source is serialized only once');
  const response = { finishReason: 'stop', content: JSON.stringify({ replacements: [
    { before: 'second = 2', after: 'second = 3' }, { before: 'first = 1', after: 'first = 2' },
  ] }) };
  const after = compileCodeDraftResult(compiled, response, 0, null, base).changes[0].afterContent;
  assert.equal(after, source.replace('first = 1', 'first = 2').replace('second = 2', 'second = 3'));
  for (const [bad, code] of [[{ ...base, path: 'src/foreign.js' }, 'EDIT_BASE_UNAVAILABLE'],
    [{ ...base, kind: 'fuzzy' }, 'EDIT_BASE_UNAVAILABLE'],
    [{ ...base, contentDigest: sha('old bytes') }, 'EDIT_BASE_STALE'],
    [{ ...base, content: null }, 'EDIT_BASE_UNAVAILABLE']]) {
    assert.throws(() => buildCodeDraftPrompt(compiled, source, 0, [], null, bad), { code: `M2_CODE_DRAFT_${code}` });
    assert.throws(() => compileCodeDraftResult(compiled, response, 0, null, bad), { code: `M2_CODE_DRAFT_${code}` });
  }
  assert.throws(() => buildCodeDraftPrompt(compiled, source + ' ', 0, [], null, base), { code: 'M2_CODE_DRAFT_EDIT_BASE_STALE' });
  assert.throws(() => captureCodeDraftEditBase('src/app.js', '\ud800', sha('\ud800')), { code: 'M2_CODE_DRAFT_EDIT_BASE_UNAVAILABLE' });
  assert.throws(() => compileCodeDraftResult(compiled, { finishReason: 'stop', content: JSON.stringify({ afterContent: after }) },
    0, null, base), { code: 'M2_CODE_DRAFT_OUTPUT_INVALID' });
  assert.throws(() => compileCodeDraftResult(compiled, response, 0, source, base), { code: 'M2_CODE_DRAFT_EDIT_BASE_UNAVAILABLE' });
  const legacy = compileCodeDraftInput({ path: 'src/app.js', instruction: 'Change value.' });
  assert.throws(() => buildCodeDraftPrompt(legacy, source, 0, [], null, base), { code: 'M2_CODE_DRAFT_EDIT_BASE_UNAVAILABLE' });
});

await testAsync('normal full-source and serialized escaping guards accept the boundary and reject growth', async () => {
  const source = '/*' + 'a'.repeat(16_384 - Buffer.byteLength('/**/\nexport const value=1;\n')) + '*/\nexport const value=1;\n';
  const compiled = compileCodeDraftInput({ instruction: 'Modify the observed source.',
    files: [{ path: 'src/app.js', instruction: 'Change value.', dependsOn: [], contextFiles: ['src/helper.js'] }],
    focusedTest: proposal().focusedTest });
  const base = captureCodeDraftEditBase('src/app.js', source, sha(source));
  const response = after => ({ finishReason: 'stop', content: JSON.stringify({ replacements: [{ before: 'value=1', after }] }) });
  assert.equal(Buffer.byteLength(compileCodeDraftResult(compiled, response('value=2'), 0, null, base).changes[0].afterContent), 16_384);
  assert.throws(() => compileCodeDraftResult(compiled, response('value=22'), 0, null, base), { code: 'M2_CODE_DRAFT_OUTPUT_INVALID' });
  const small = 'export const value=1;\n'; const edit = captureCodeDraftEditBase(base.path, small, sha(small));
  const peers = n => [{ path: 'src/helper.js', content: '\\'.repeat(n), state: 'read_only', contentDigest: sha('\\'.repeat(n)) }];
  const empty = buildCodeDraftPrompt(compiled, small, 0, peers(0), null, edit);
  const n = Math.floor((32_000 - Buffer.byteLength(empty.prompt + empty.systemPrompt)) / 2);
  const exact = buildCodeDraftPrompt(compiled, small, 0, peers(n), null, edit);
  assert.ok(Buffer.byteLength(exact.prompt + exact.systemPrompt) >= 31_999);
  assert.throws(() => buildCodeDraftPrompt(compiled, small, 0, peers(n + 1), null, edit), { code: 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED' });
});

for (const defect of [null, 'focused-fail', 'cancel', 'late-stale', 'incomplete', 'full-output', 'no-op', 'missing', 'stale-digest']) {
  await testAsync(`trusted normal two-file anchored service: ${defect ?? 'exact approval, commit and durable full bytes'}`, async () => {
    const root = makeProject(); const db = openDatabase(); const controller = new AbortController(); let calls = 0;
    const before = 'export const value = 1;\n'; const helperBefore = 'export const helper = 1;\n';
    if (defect !== 'missing') {
      fs.writeFileSync(path.join(root, 'src/helper.js'), helperBefore);
      git(root, ['add', '--', 'src/helper.js']);
      git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'existing dependency']);
    }
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const codeDraftEditPolicy = { kind: CODE_DRAFT_NORMAL_EDIT_OUTPUT, projectId: PROJECT_ID,
      targets: [{ path: 'src/helper.js', beforeDigest: sha(helperBefore) },
        { path: 'src/app.js', beforeDigest: defect === 'stale-digest' ? sha('old bytes') : sha(before) }] };
    try {
      const service = createService(db, root, makeClock(), { codeDraftEditPolicy,
        generateCodeDraft: async ({ prompt, repairBuild, outputContract, signal }) => {
          calls++; const input = codeInput(prompt);
          assert.equal(repairBuild, false); assert.equal(outputContract, CODE_DRAFT_NORMAL_EDIT_OUTPUT);
          assert.equal(signal.aborted, false); assert.equal(Object.hasOwn(input, 'previousDraft'), false);
          assert.equal(input.beforeContent, input.path === 'src/helper.js' ? helperBefore : before);
          assert.equal(input.beforeContentDigest, sha(input.beforeContent));
          if (calls === 2) assert.deepEqual(input.peerFiles, [{ path: 'src/helper.js', content: 'export const helper = 2;\n', state: 'proposed' }]);
          assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), before);
          assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
          if (calls === 2 && defect === 'cancel') controller.abort();
          if (calls === 2 && defect === 'late-stale') fs.writeFileSync(path.join(root, 'src/foreign.js'), '// new foreign bytes\n');
          if (calls === 2 && defect === 'full-output') return { finishReason: 'stop', content: JSON.stringify({ afterContent: 'export const value = 2;\n' }) };
          return { finishReason: calls === 2 && defect === 'incomplete' ? 'length' : 'stop',
            content: JSON.stringify({ replacements: [{ before: ' = 1;', after: defect === 'no-op' ? ' = 1;' : ' = 2;' }] }) };
        } });
      await service.recoverIncompleteSmallProjectChanges();
      const draft = { instruction: 'Modify only the existing two modules.', files: [
        { path: 'src/helper.js', instruction: 'Set helper to 2.', dependsOn: [] },
        { path: 'src/app.js', instruction: 'Set value to 2 and preserve interface.', dependsOn: ['src/helper.js'] },
      ], focusedTest: { ...proposal().focusedTest, argv: ['--input-type=module', '-e',
        `import {value} from './src/app.js';import {helper} from './src/helper.js';if(value!==${defect === 'focused-fail' ? 3 : 2}||helper!==2)throw Error('semantic oracle failed');`] },
      gitCommit: proposal().gitCommit };
      const planning = service.draftSmallProjectChange({ authenticatedSubject: SUBJECT, projectId: PROJECT_ID,
        origin: ORIGIN, draft, signal: controller.signal });
      if (defect && defect !== 'focused-fail') {
        const codes = { cancel: 'M2_CODE_DRAFT_CANCELLED', 'late-stale': 'M2_LIFECYCLE_CONTEXT_STALE',
          incomplete: 'M2_CODE_DRAFT_OUTPUT_INCOMPLETE', 'full-output': 'M2_CODE_DRAFT_OUTPUT_INVALID',
          'no-op': 'M2_CODE_DRAFT_OUTPUT_UNCHANGED', missing: 'M2_CODE_DRAFT_EDIT_BASE_UNAVAILABLE',
          'stale-digest': 'M2_CODE_DRAFT_EDIT_BASE_STALE' };
        await assert.rejects(planning, { code: codes[defect] });
        assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
      } else {
        const planned = await planning;
        assert.deepEqual(planned.diff.map(file => [file.path, file.after.content]), [
          ['src/app.js', 'export const value = 2;\n'], ['src/helper.js', 'export const helper = 2;\n']]);
        assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), before);
        assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
        await assert.rejects(service.approveSmallProjectChange({ authenticatedSubject: SUBJECT, origin: ORIGIN,
          lifecycleId: planned.lifecycleId, planDigest: sha('wrong approval') }), { code: M2LifecycleServiceErrorCode.PLAN_DIGEST_MISMATCH });
        const result = await service.approveSmallProjectChange({ authenticatedSubject: SUBJECT, origin: ORIGIN,
          lifecycleId: planned.lifecycleId, planDigest: planned.planDigest });
        assert.equal(result.state, defect ? 'failed' : 'succeeded');
        if (defect) {
          assert.equal(result.result.rollback.status, 'succeeded');
          assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
          assert.equal(fs.readFileSync(path.join(root, 'src/helper.js'), 'utf8'), helperBefore);
        } else {
          assert.equal(result.result.git.status, 'committed');
          assert.notEqual(git(root, ['rev-parse', 'HEAD']), beforeHead);
        }
        const restarted = createService(db, root, makeClock(), { generateCodeDraft: async () => { throw Error('no replay'); } });
        await restarted.recoverIncompleteSmallProjectChanges();
        assert.equal(restarted.getSmallProjectChangeStatus({ authenticatedSubject: SUBJECT, origin: ORIGIN,
          lifecycleId: planned.lifecycleId }).terminal.resultDigest, result.terminal.resultDigest);
      }
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), defect ? before : 'export const value = 2;\n');
      assert.equal(calls, ['missing', 'stale-digest'].includes(defect) ? 0 : defect === 'no-op' ? 1 : 2);
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

await testAsync('a compact proposal remains repairable when the original disk file is large', async () => {
  const original = `/* ${'original scaffold '.repeat(550)} */\nexport const value = 1;\n`;
  const compiled = compileCodeDraftInput({ instruction: 'Correct the proposed value.',
    files: [{ path: 'src/app.js', instruction: 'Set value to 3.', dependsOn: [] }],
    focusedTest: proposal().focusedTest, gitCommit: proposal().gitCommit });
  const previous = { content: 'export const value = 2;\n',
    contentDigest: sha('export const value = 2;\n'), state: 'unapplied_proposal' };
  const repair = buildCodeDraftPrompt(compiled, original, 0, [], previous);
  assert.doesNotThrow(() => assertCodeDraftModelBudget(repair, { maxPromptBytes: 8742 }));
  assert.equal(codeInput(repair.prompt).onDiskContentDigest, sha(original));
  assert.equal(codeInput(repair.prompt).previousDraft.content, previous.content);
  // The same large file really exceeds the budget when it is the editable base.
  assert.throws(() => assertCodeDraftModelBudget(
    buildCodeDraftPrompt(compiled, original), { maxPromptBytes: 8742 }),
  { code: 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED' });
});

for (const content of ['export function unfinished() {', 'export const = 1;', 'const text = "unfinished', '/* missing end']) {
  await testAsync(`draft rejects invalid JavaScript before any focused test: ${JSON.stringify(content)}`, async () => {
    const compiled = compileCodeDraftInput({ path: 'src/entry.mjs', instruction: 'Implement entrypoint.',
      focusedTest: { ...proposal().focusedTest, argv: ['-e', 'process.exit(0)'] } });
    assert.throws(() => compileCodeDraftResult(compiled,
      { finishReason: 'stop', content: JSON.stringify({ afterContent: content }) }),
    { code: 'M2_CODE_DRAFT_OUTPUT_SYNTAX_INVALID' });
  });
}

await testAsync('syntax validation parses ESM and CommonJS without linking or executing either', async () => {
  const canary = '__intentsmithDraftSyntaxCanary';
  assert.equal(Object.hasOwn(globalThis, canary), false);
  for (const [path, content] of [
    ['src/entry.mjs', `import './does-not-exist.mjs'; globalThis.${canary}=true; export const value=1;`],
    ['src/entry.cjs', `globalThis.${canary}=true; module.exports = require('./does-not-exist.cjs');`],
  ]) {
    const compiled = compileCodeDraftInput({ path, instruction: 'Parse without running.' });
    assert.equal(compileCodeDraftResult(compiled,
      { finishReason: 'stop', content: JSON.stringify({ afterContent: content }) }).changes[0].afterContent, content);
    assert.equal(Object.hasOwn(globalThis, canary), false);
  }
});

await testAsync('an exact repair that breaks syntax cannot produce a proposal', async () => {
  const compiled = compileCodeDraftInput({ path: 'src/entry.mjs', instruction: 'Repair entrypoint.' });
  assert.throws(() => compileCodeDraftResult(compiled,
    { finishReason: 'stop', content: JSON.stringify({ replacements: [{ before: 'return 1;', after: 'return (' }] }) },
    0, 'export function f() { return 1; }'), { code: 'M2_CODE_DRAFT_OUTPUT_SYNTAX_INVALID' });
});

await testAsync('repair replaces exact independent spans and preserves every other byte', async () => {
  const compiled = compileCodeDraftInput({ instruction: 'Repair values.',
    files: [{ path: 'src/app.js', instruction: 'Repair values.', dependsOn: [] }],
    focusedTest: proposal().focusedTest });
  const base = '// Česko\nexport const first = 1;\nexport const second = 2;\n';
  const response = { finishReason: 'stop', content: JSON.stringify({ replacements: [
    { before: 'second = 2', after: 'second = 3' },
    { before: 'first = 1', after: 'first = 2' },
  ] }) };
  const result = compileCodeDraftResult(compiled, response, 0, base);
  assert.deepEqual(result.changes, [{ path: 'src/app.js',
    afterContent: '// Česko\nexport const first = 2;\nexport const second = 3;\n' }]);
  assert.throws(() => compileCodeDraftResult(compiled, response), { code: 'M2_CODE_DRAFT_OUTPUT_INVALID' });
});

for (const [name, value, code] of [
  ['empty replacement set', { replacements: [] }, 'OUTPUT_INVALID'],
  ['excess replacement count', { replacements: Array(17).fill({ before: '1', after: '2' }) }, 'OUTPUT_INVALID'],
  ['extra output path', { replacements: [{ before: '1', after: '2' }], path: '/other' }, 'OUTPUT_INVALID'],
  ['extra replacement key', { replacements: [{ before: '1', after: '2', path: '/other' }] }, 'OUTPUT_INVALID'],
  ['empty match', { replacements: [{ before: '', after: '2' }] }, 'OUTPUT_INVALID'],
  ['missing match', { replacements: [{ before: 'missing', after: '2' }] }, 'REPAIR_MATCH_INVALID'],
  ['ambiguous match', { replacements: [{ before: 'e', after: 'x' }] }, 'REPAIR_MATCH_INVALID'],
  ['overlapping spans', { replacements: [{ before: 'const value', after: 'x' }, { before: 'value = 1', after: 'y' }] }, 'REPAIR_MATCH_INVALID'],
  ['sequential rather than original match', { replacements: [{ before: '1', after: '2' }, { before: '2', after: '3' }] }, 'REPAIR_MATCH_INVALID'],
  ['oversized resulting file', { replacements: [{ before: '1', after: '2'.repeat(16_384) }] }, 'OUTPUT_INVALID'],
  ['whole-file output in repair mode', { afterContent: 'replacement' }, 'OUTPUT_INVALID'],
]) {
  await testAsync(`repair rejects ${name}`, async () => {
    const compiled = compileCodeDraftInput({ instruction: 'Repair value.',
      files: [{ path: 'src/app.js', instruction: 'Repair value.', dependsOn: [] }],
      focusedTest: proposal().focusedTest });
    assert.throws(() => compileCodeDraftResult(compiled,
      { finishReason: 'stop', content: JSON.stringify(value) }, 0, 'export const value = 1;\n'),
    { code: `M2_CODE_DRAFT_${code}` });
  });
}

await testAsync('retaining an old invalid proposal still checks syntax before inference', async () => {
  const root = makeProject(); const db = openDatabase(); let calls = 0;
  try {
    const old = proposal(); old.changes[0].afterContent = 'export const value = ;\n';
    const generateCodeDraft = async () => { calls++; throw Error('must not infer'); };
    const current = createService(db, root, makeClock(), { generateCodeDraft });
    await current.recoverIncompleteSmallProjectChanges();
    await assert.rejects(prepare(current, old), { code: M2LifecycleServiceErrorCode.GOVERNANCE_DENIED });
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);
    // Only this historical setup emulates the old regex evaluator's ALLOW for
    // syntactically invalid source. Use the typed writer, never direct DB edits.
    let historicalEvaluations = 0;
    const service = createService(db, root, makeClock(), {
      generateCodeDraft,
      evaluateGovernance(args) {
        historicalEvaluations++;
        return createM2GovernanceDecision({
          lifecycleId: args.lifecycleId, milestoneId: args.milestoneId,
          executionId: args.request.executionId, runId: args.request.runId,
          projectId: args.request.project.projectId,
          requestDigest: computeM2ProjectChangeRequestDigest(args.request),
          policyDigest: computeM2GovernancePolicySnapshotDigest(args.policySnapshot),
          baselineDigest: computeM2GovernanceBaselineDigest(args.baselineSnapshot),
          expectedAfterRevision: args.expectedAfterRevision, verdict: 'allow',
          checks: M2_GOVERNANCE_DECISION_CHECKS.map(checkId => ({
            checkId, required: true, status: 'pass', findingIds: [],
          })), findings: [], blockingFindingIds: [],
        });
      },
    });
    await service.recoverIncompleteSmallProjectChanges();
    const prior = await prepare(service, old);
    await service.cancelSmallProjectChange({ authenticatedSubject: SUBJECT, origin: ORIGIN, lifecycleId: prior.lifecycleId });
    await assert.rejects(service.draftSmallProjectChange({ authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN,
      draft: { instruction: 'Retain prior proposal.', files: [{ path: 'src/app.js', instruction: 'Retain.', dependsOn: [], reusePrevious: true }],
        focusedTest: proposal().focusedTest, revisionOf: { lifecycleId: prior.lifecycleId, planDigest: prior.planDigest } } }),
    { code: 'M2_CODE_DRAFT_OUTPUT_SYNTAX_INVALID' });
    assert.equal(calls, 0);
    assert.equal(historicalEvaluations, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 1);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

for (const defect of [null, 'owner', 'origin', 'digest', 'active', 'stale', 'missing-retained', 'repeated', 'ambiguous-repair']) {
  await testAsync(`revision preserves reviewed bytes and requires same owned cancelled plan: ${defect ?? 'success'}`, async () => {
    const root = makeProject(); const db = openDatabase(); let calls = 0;
    try {
      const retained = 'export const helper = 42;\n';
      const service = createService(db, root, makeClock(), { generateCodeDraft: async ({ prompt }) => {
        calls++; const input = codeInput(prompt);
        assert.equal(input.path, 'src/app.js');
        assert.equal(Object.hasOwn(input, 'beforeContent'), false);
        assert.equal(input.onDiskContentDigest, sha('export const value = 1;\n'));
        assert.equal(input.previousDraft.content, 'export const value = 2;\n');
        assert.equal(input.previousDraft.state, 'unapplied_proposal');
        assert.equal(input.previousDraft.contentDigest, sha(input.previousDraft.content));
        assert.equal(input.peerFiles[0].content, retained);
        return { content: JSON.stringify({ replacements: [
          { before: defect === 'ambiguous-repair' ? 'e' : 'value = 2',
            after: defect === 'repeated' ? 'value = 2' : 'value = 3' },
        ] }), finishReason: 'stop' };
      } });
      await service.recoverIncompleteSmallProjectChanges();
      const previous = await prepare(service, proposal({ changes: [
        { path: 'src/app.js', afterContent: 'export const value = 2;\n' },
        { path: 'src/helper.js', afterContent: retained },
      ] }));
      if (defect !== 'active') await service.cancelSmallProjectChange({ authenticatedSubject: SUBJECT,
        lifecycleId: previous.lifecycleId, origin: ORIGIN });
      if (defect === 'stale') fs.writeFileSync(path.join(root, 'src/unrelated.js'), '// changed workspace\n');
      const blueprint = { instruction: 'Correct only the exported value; retain the reviewed helper.',
        revisionOf: { lifecycleId: previous.lifecycleId, planDigest: defect === 'digest' ? sha('wrong') : previous.planDigest },
        files: [
          { path: 'src/app.js', instruction: 'Correct value to 3, preserving other behavior.', dependsOn: ['src/helper.js'] },
          { path: 'src/helper.js', instruction: 'Retain reviewed helper.', dependsOn: [], reusePrevious: true },
        ], focusedTest: proposal().focusedTest, gitCommit: proposal().gitCommit };
      if (defect === 'missing-retained') { blueprint.files[1].path = 'src/missing.js'; blueprint.files[0].dependsOn = ['src/missing.js']; }
      const act = () => service.draftSmallProjectChange({ projectId: PROJECT_ID, draft: blueprint,
        authenticatedSubject: defect === 'owner' ? { ...SUBJECT, actorId: 'someone-else' } : SUBJECT,
        origin: defect === 'origin' ? { ...ORIGIN, conversationId: 'other-conversation' } : ORIGIN });
      if (defect) {
        const codes = { owner: 'M2_LIFECYCLE_OWNER_MISMATCH', origin: 'M2_LIFECYCLE_ORIGIN_MISMATCH',
          digest: 'M2_LIFECYCLE_PLAN_DIGEST_MISMATCH', active: 'M2_CODE_DRAFT_REVISION_UNAVAILABLE',
          stale: 'M2_LIFECYCLE_CONTEXT_STALE', 'missing-retained': 'M2_CODE_DRAFT_REVISION_UNAVAILABLE',
          repeated: 'M2_CODE_DRAFT_REVISION_UNCHANGED', 'ambiguous-repair': 'M2_CODE_DRAFT_REPAIR_MATCH_INVALID' };
        await assert.rejects(act(), { code: codes[defect] });
        assert.equal(calls, ['repeated', 'ambiguous-repair'].includes(defect) ? 1 : 0);
        assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 1);
      } else {
        const next = await act(); assert.equal(calls, 1);
        assert.notEqual(next.lifecycleId, previous.lifecycleId); assert.notEqual(next.planDigest, previous.planDigest);
        assert.equal(next.state, 'awaiting_approval'); assert.equal(next.approval, null);
        assert.equal(next.diff.find(file => file.path === 'src/helper.js').after.content, retained);
        assert.equal(next.diff.find(file => file.path === 'src/app.js').after.content, 'export const value = 3;\n');
        assert.equal(service.getSmallProjectChangeStatus({ authenticatedSubject: SUBJECT, origin: ORIGIN,
          lifecycleId: previous.lifecycleId }).state, 'cancelled');
      }
      assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
      assert.equal(fs.existsSync(path.join(root, 'src/helper.js')), false);
    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });
}

// A separate Node process keeps every parent binding/cache/fetch value intact.
// Only HTTP mock requests execute; real project preparation uses the default
// CODE generator, SQLite, Git and AST governance. Approval remains a later gate.
await testAsync('default CODE32k keeps complete sources beyond the old16k guard and stops later failures before authority', async () => {
  const childSource = [
    "import assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { execFileSync } from 'node:child_process';\nimport fs from 'node:fs';\nimport os from 'node:os';\nimport path from 'node:path';\nimport Database from 'better-sqlite3';\nimport { up as applyEffectAuthority } from './src/db/migrations/2026_08_23_092_m2_effect_authority.js';\nimport { up as applyEffectAuthorityHardening } from './src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';\nimport { up as applyEffectExecutionClaims } from './src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';\nimport { up as applyEffectClaimTruth } from './src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';\nimport { up as applyExecutionAuthority } from './src/db/migrations/2026_08_24_078_m2_execution_authority.js';\nimport { up as applyLifecycleAuthority } from './src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js';\nimport { createDefaultM2LifecycleApplicationService } from './src/lifecycle/m2-lifecycle-application-service.js';\nconst PROJECT_ID = 27;\nconst SUBJECT = Object.freeze({ actorType: 'user', actorId: 'operator-m2' });\nconst ORIGIN = Object.freeze({surface:'studio',sessionId:'studio-session-m2',conversationId:'studio-conversation-m2',projectId:PROJECT_ID});",
    git.toString(),
    sha.toString(),
    codeInput.toString(),
    policy.toString(),
    writePolicy.toString(),
    makeProject.toString(),
    openDatabase.toString(),
    projectRegistry.toString(),
    proposal.toString(),
    makeClock.toString(),
    createService.toString(),
    [
      "import { config } from './src/config.js';",
      "import { codeDraftModelBudget } from './src/lifecycle/m2-code-draft.js';",
      "import { llmGateway } from './src/llm/gateway.js';",
      "import { CODE_RUNTIME_PROFILE, CODE_RUNTIME_QUALIFICATION } from './src/llm/model-runtime-profile.js';",
      "import { setNumCtx, clearNumCtxCache } from './src/llm/model-ctx.js';",
      "import { modelUniverseStore } from './src/upgrade/model-universe-store.js';",
      "const original = { fetch: globalThis.fetch, code: config.models.CODE, baseUrl: config.ollama.baseUrl,",
      "  authority: llmGateway._bindingStartupAuthority, resolver: llmGateway._bindingArtifactResolver,",
      "  recorder: modelUniverseStore.recordSignalEvent };",
      "const receipts = [];",
      "const controlledResponse = json => ({ ok: true, status: 200, json: async () => json });",
      "try {",
      "  for (const scenario of ['complete-full-source', 'later-dependency-overflow', 'later-incomplete-output', 'later-config-drift', 'injected-generator-unchanged']) {",
      "    const root = makeProject(); const db = openDatabase(); const beforeHead = git(root, ['rev-parse', 'HEAD']);",
      "    const beforeBytes = fs.readFileSync(path.join(root, 'src/app.js'));",
      "    let calls = 0; let versionQueries = 0; let artifactQueries = 0; const sourceLengths = []; const requestContexts = [];",
      "    const artifact = { modelName: CODE_RUNTIME_PROFILE.model, digestSha256: CODE_RUNTIME_PROFILE.digestSha256 };",
      "    config.models.CODE = CODE_RUNTIME_PROFILE.model; config.ollama.baseUrl = 'http://service-code-unit.invalid';",
      "    clearNumCtxCache(); setNumCtx(CODE_RUNTIME_PROFILE.model, 8192);",
      "    const old8192Budget = await codeDraftModelBudget(true);",
      "    llmGateway.setBindingStartupAuthority({ status: 'DURABLE' }, { resolveArtifact: () => { artifactQueries += 1; return artifact; } });",
      "    modelUniverseStore.recordSignalEvent = () => ({ ok: true });",
      "    const payload = scenario === 'later-dependency-overflow' ? 15500 : 13200;",
      "    const outputs = {",
      "      'src/a.js': `export const a = 1;\\n/*${'a'.repeat(payload)}*/\\n`,",
      "      'src/b.js': `export const b = 2;\\n/*${'b'.repeat(payload)}*/\\n`,",
      "      'src/c.js': \"import {a} from './a.js';\\nimport {b} from './b.js';\\nexport const sum = a+b;\\n\",",
      "      'src/app.js': \"export {sum as value} from './c.js';\\n\",",
      "    };",
      "    const blueprint = { instruction: 'Create complete modules and use their full sources.', files: [",
      "      { path: 'src/a.js', instruction: 'Export a.', dependsOn: [] },",
      "      { path: 'src/b.js', instruction: 'Export b.', dependsOn: [] },",
      "      { path: 'src/c.js', instruction: 'Export a+b.', dependsOn: ['src/a.js', 'src/b.js'] },",
      "      { path: 'src/app.js', instruction: 'Re-export c.', dependsOn: ['src/c.js'] },",
      "    ], focusedTest: proposal().focusedTest };",
      "    globalThis.fetch = async (url, options = {}) => {",
      "      if (url === 'http://service-code-unit.invalid/api/version') { versionQueries += 1; return controlledResponse({ version: CODE_RUNTIME_QUALIFICATION.providerVersion }); }",
      "      if (url === 'http://service-code-unit.invalid/api/tags') return controlledResponse({ models: [{ name: artifact.modelName, digest: artifact.digestSha256 }] });",
      "      if (url !== 'http://service-code-unit.invalid/api/chat') throw Error(`Unexpected CPU endpoint ${url}`);",
      "      const body = JSON.parse(options.body); const prompt = body.messages.find(message => message.role === 'user').content;",
      "      const input = codeInput(prompt); calls += 1; requestContexts.push(body.options.num_ctx);",
      "      assert.equal(body.model, artifact.modelName);",
      "      assert.equal(body.options.num_ctx, 32768); assert.equal(body.options.num_predict, 4096);",
      "      const expectedPeers = blueprint.files.find(file => file.path === input.path).dependsOn;",
      "      assert.deepEqual(input.peerFiles?.map(peer => peer.path) ?? [], expectedPeers);",
      "      for (const peer of input.peerFiles ?? []) assert.equal(peer.content, outputs[peer.path]);",
      "      sourceLengths.push({ path: input.path, promptAndSystemBytes: body.messages.reduce((sum, message) => sum + Buffer.byteLength(message.content), 0),",
      "        fullPeerBytes: (input.peerFiles ?? []).reduce((sum, peer) => sum + Buffer.byteLength(peer.content), 0) });",
      "      // Shared-cache drift between successive actual service generations must not change CODE budget.",
      "      setNumCtx(CODE_RUNTIME_PROFILE.model, calls === 1 ? 4096 : 8192);",
      "      if (scenario === 'later-config-drift' && calls === 2) config.models.CODE = 'retargeted:1b';",
      "      return controlledResponse({ model: artifact.modelName, digest: artifact.digestSha256,",
      "        provider_version: CODE_RUNTIME_QUALIFICATION.providerVersion,",
      "        message: { content: JSON.stringify({ afterContent: outputs[input.path] }) },",
      "        done_reason: scenario === 'later-incomplete-output' && calls === 3 ? 'length' : 'stop' });",
      "    };",
      "    try {",
      "      const service = createService(db, root, makeClock(), scenario === 'injected-generator-unchanged' ? {",
      "        generateCodeDraft: async ({ prompt }) => { calls += 1; return { content: JSON.stringify({ afterContent: outputs[codeInput(prompt).path] }), finishReason: 'stop' }; }",
      "      } : {}); await service.recoverIncompleteSmallProjectChanges();",
      "      const run = () => service.draftSmallProjectChange({ authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN, draft: blueprint });",
      "      let actual;",
      "      if (scenario === 'complete-full-source' || scenario === 'injected-generator-unchanged') {",
      "        actual = await run(); assert.equal(actual.state, 'awaiting_approval'); assert.equal(calls, 4);",
      "        assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 1);",
      "        if (scenario === 'complete-full-source') {",
      "        const third = sourceLengths[2]; assert.ok(third.promptAndSystemBytes > old8192Budget.maxPromptBytes);",
      "        assert.ok(third.promptAndSystemBytes > 23808, 'complete sources exceed the historical16k guard');",
      "        assert.ok(third.promptAndSystemBytes <= 32000, 'serializer cap stays unchanged');",
      "        assert.equal(third.fullPeerBytes, Buffer.byteLength(outputs['src/a.js']) + Buffer.byteLength(outputs['src/b.js']));",
      "        } else { assert.equal(versionQueries, 0); assert.equal(artifactQueries, 0); }",
      "      } else {",
      "        const codes = { 'later-dependency-overflow': 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED',",
      "          'later-incomplete-output': 'M2_CODE_DRAFT_OUTPUT_INCOMPLETE', 'later-config-drift': 'LLM_CODE_RUNTIME_DRIFT' };",
      "        await assert.rejects(run(), { code: codes[scenario] });",
      "        assert.equal(calls, scenario === 'later-incomplete-output' ? 3 : 2);",
      "        assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 0);",
      "      }",
      "      assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead); assert.equal(git(root, ['status', '--porcelain=v1']), '');",
      "      assert.deepEqual(fs.readFileSync(path.join(root, 'src/app.js')), beforeBytes);",
      "      for (const relative of ['src/a.js', 'src/b.js', 'src/c.js']) assert.equal(fs.existsSync(path.join(root, relative)), false);",
      "      assert.equal(llmGateway.getConcurrencyStats().active, 0); assert.equal(llmGateway.getConcurrencyStats().queued, 0);",
      "      receipts.push({ scenario, status: 'CPU_PASS', calls, requestContexts, sourceLengths,",
      "        durableOperations: db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n,",
      "        noSourceWritesOrCommit: true, actualDefaultServiceAndGenerator: scenario !== 'injected-generator-unchanged',",
      "        versionQueries, artifactQueries, reference8192MaxPromptBytes: old8192Budget.maxPromptBytes,",
      "        generatorInjectionUnchanged: scenario === 'injected-generator-unchanged',",
      "        lifecycleId: actual?.lifecycleId ?? null });",
      "    } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }",
      "  }",
      "  console.log(JSON.stringify({ schemaVersion: 1, kind: 'CPU_MOCK_PROVIDER_ONLY', model: CODE_RUNTIME_PROFILE.model,",
      "    digestSha256: CODE_RUNTIME_PROFILE.digestSha256, profileContext: 32768,",
      "    limitations: ['No live provider request or GPU', 'No approval/execution/commit acceptance', 'Five bounded generation/preparation cases only'], receipts }, null, 2));",
      "} finally {",
      "  globalThis.fetch = original.fetch; config.models.CODE = original.code; config.ollama.baseUrl = original.baseUrl;",
      "  llmGateway._bindingStartupAuthority = original.authority; llmGateway._bindingArtifactResolver = original.resolver;",
      "  modelUniverseStore.recordSignalEvent = original.recorder; clearNumCtxCache();",
      "}",
    ].join('\n'),
  ].join('\n');
  const { fileURLToPath } = await import('node:url');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', childSource], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env }, encoding: 'utf8', timeout: 45_000, maxBuffer: 1024 * 1024,
  });
  const marker = '{\n  "schemaVersion": 1,\n  "kind": "CPU_MOCK_PROVIDER_ONLY"';
  const offset = output.indexOf(marker); assert.ok(offset >= 0, 'bounded child must return its exact CPU receipt');
  const evidence = JSON.parse(output.slice(offset));
  assert.equal(evidence.kind, 'CPU_MOCK_PROVIDER_ONLY'); assert.equal(evidence.profileContext, 32768);
  assert.deepEqual(evidence.receipts.map(item => [item.scenario, item.status, item.calls, item.durableOperations]), [
    ['complete-full-source', 'CPU_PASS', 4, 1], ['later-dependency-overflow', 'CPU_PASS', 2, 0],
    ['later-incomplete-output', 'CPU_PASS', 3, 0], ['later-config-drift', 'CPU_PASS', 2, 0],
    ['injected-generator-unchanged', 'CPU_PASS', 4, 1],
  ]);
  assert.ok(evidence.receipts.every(item => item.noSourceWritesOrCommit === true));
}, 60_000);

// Controlled V2 acceptance-boundary regressions. Artifact identities and the
// provider are fixtures; these cases make no native, network or kernel claim.
const {
  computeM2PrivateHttpNetworkPolicyDigest, computeM2PrivateHttpNftRulesDigest,
  M2_PRIVATE_HTTP_SECCOMP_DIGEST,
} = await import('../contracts/m2/execution-v2.js');
const { up: applyPrivateHttpAuthority } = await import('../src/db/migrations/2026_10_04_122_m2_private_http_authority.js');
const { up: applyApprovalListIndex } = await import('../src/db/migrations/2026_08_29_106_m7_m2_approval_list_index.js');

function openPrivateHttpDatabase(databasePath = ':memory:') {
  const db = openDatabase(databasePath);
  applyApprovalListIndex(db);
  db.transaction(() => applyPrivateHttpAuthority(db))();
  return db;
}
function privateHttpProposal() {
  const artifact = (canonicalPath, inode) => ({ canonicalPath, bytes: 1234,
    digest: sha(Buffer.from(String(inode))), device: '2049', inode: String(inode) });
  const networkPolicy = { contract: 'M2PrivateHttpNetworkPolicy', version: 1,
    profile: 'linux-bwrap-private-loopback-v1', architecture: 'x64',
    endpoint: { family: 'ipv4', transport: 'tcp', address: '127.0.0.1', port: 18080 },
    minimumLandlockAbi: 4, nftRulesDigest: computeM2PrivateHttpNftRulesDigest(18080),
    seccompProgramDigest: M2_PRIVATE_HTTP_SECCOMP_DIGEST,
    artifacts: { launcher: artifact('/trusted/launcher', 1), ip: artifact('/usr/bin/ip', 2),
      nft: artifact('/usr/sbin/nft', 3), runtimeExecutable: artifact(process.execPath, 4),
      oracle: artifact('/trusted/oracle.mjs', 5) } };
  const value = proposal({ commit: false });
  Object.assign(value.focusedTest, { binary: process.execPath,
    argv: [networkPolicy.artifacts.oracle.canonicalPath, 'src/app.js', '/tmp/private.sqlite', '18080'],
    environment: {}, sandboxProfile: networkPolicy.profile, networkPolicy,
    networkPolicyDigest: computeM2PrivateHttpNetworkPolicyDigest(networkPolicy) });
  return value;
}
function controlledPrivateHttpProvider(root, db, focusedTest, refusedPreflight = 0) {
  const calls = [];
  const emptyDigest = sha(Buffer.alloc(0));
  return { calls,
    async preflight(input) {
      calls.push({ stage: 'preflight', bytes: fs.readFileSync(path.join(root, 'src/app.js')),
        requests: db.prepare('SELECT count(*) AS n FROM m2_execution_requests').get().n });
      assert.deepEqual(input.environment, {});
      assert.deepEqual(input.networkPolicy, focusedTest.networkPolicy);
      assert.equal(input.networkPolicyDigest, focusedTest.networkPolicyDigest);
      if (calls.filter(call => call.stage === 'preflight').length === refusedPreflight) {
        throw Object.assign(new Error('controlled trusted-artifact drift'), { code: 'PROCESS_PRIVATE_HTTP_ARTIFACT_CHANGED' });
      }
      return { sandboxProfile: input.sandboxProfile, networkPolicyDigest: input.networkPolicyDigest,
        artifacts: input.networkPolicy.artifacts };
    },
    async run(input, { recordSupervisorIdentity }) {
      await recordSupervisorIdentity({ pid: 8199, processGroupId: 8199,
        bootId: '11111111-1111-4111-8111-111111111111', startIdentity: '999' });
      calls.push({ stage: 'run', bytes: fs.readFileSync(path.join(root, 'src/app.js')) });
      return { state: 'terminal', terminalStatus: 'succeeded', errorCode: null,
        exitCode: 0, signal: null, processGroupState: 'empty',
        supervisorIdentity: { supervisorPid: 8199, supervisorPgid: 8199,
          supervisorBootId: '11111111-1111-4111-8111-111111111111', supervisorStartIdentity: '999' },
        cleanup: { groupState: 'empty', childClosed: true }, stdout: '', stderr: '',
        stdoutDigest: emptyDigest, stderrDigest: emptyDigest, outputTruncated: false,
        sandboxProfile: input.sandboxProfile, networkPolicyDigest: input.networkPolicyDigest, kernelProof: null };
    },
    execute() { assert.fail('V2 must never use the legacy execute fallback'); },
  };
}

await testAsync('V2 controlled service preflights full policy before authority, denies stale approval and preserves exact result after reopen', async () => {
  const root = makeProject();
  const authorityDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-http-authority-'));
  const databasePath = path.join(authorityDirectory, 'authority.sqlite');
  let db = openPrivateHttpDatabase(databasePath);
  const value = privateHttpProposal(), clock = makeClock();
  const provider = controlledPrivateHttpProvider(root, db, value.focusedTest);
  let service = createService(db, root, clock, { processProvider: provider });
  try {
    await service.recoverIncompleteSmallProjectChanges();
    const beforeBytes = fs.readFileSync(path.join(root, 'src/app.js'));
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const pending = await prepare(service, value);
    assert.equal(pending.plan.version, 2);
    assert.equal(pending.state, 'awaiting_approval');
    assert.deepEqual(pending.plan.focusedTest.networkPolicy, value.focusedTest.networkPolicy);
    assert.deepEqual(pending.diff[0].before.content, beforeBytes.toString('utf8'));
    assert.equal(pending.diff[0].after.content, value.changes[0].afterContent);
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0].requests, 0);
    assert.deepEqual(provider.calls[0].bytes, beforeBytes);
    const row = db.prepare('SELECT request_json, focused_process_payload FROM m2_execution_requests').get();
    assert.equal(JSON.parse(row.request_json).version, 2);
    assert.deepEqual(JSON.parse(row.focused_process_payload).networkPolicy, value.focusedTest.networkPolicy);
    assert.deepEqual(JSON.parse(row.focused_process_payload).environment, {});
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_approval_grants').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_effect_results').get().n, 0);
    await assert.rejects(service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
      lifecycleId: pending.lifecycleId, origin: ORIGIN, planDigest: sha(Buffer.alloc(0)) }),
    { code: M2LifecycleServiceErrorCode.PLAN_DIGEST_MISMATCH });
    assert.equal(provider.calls.length, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM m2_approval_grants').get().n, 0);
    assert.deepEqual(fs.readFileSync(path.join(root, 'src/app.js')), beforeBytes);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['status', '--porcelain=v1']), '');
    const completed = await service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
      lifecycleId: pending.lifecycleId, origin: ORIGIN, planDigest: pending.planDigest });
    assert.equal(completed.state, 'succeeded', JSON.stringify(completed.result));
    assert.equal(completed.result.version, 2);
    assert.equal(completed.result.focusedTest.networkPolicyDigest, value.focusedTest.networkPolicyDigest);
    assert.equal(completed.terminal.version, 1);
    assert.deepEqual(provider.calls.map(call => call.stage), ['preflight', 'preflight', 'run']);
    assert.deepEqual(provider.calls[1].bytes, beforeBytes, 'second preflight precedes the first project write');
    assert.equal(provider.calls[2].bytes.toString('utf8'), value.changes[0].afterContent);
    db.close(); db = openPrivateHttpDatabase(databasePath);
    service = createService(db, root, clock, {
      processProvider: controlledPrivateHttpProvider(root, db, value.focusedTest) });
    await service.recoverIncompleteSmallProjectChanges();
    const restored = service.getSmallProjectChangeStatus({ authenticatedSubject: SUBJECT,
      lifecycleId: pending.lifecycleId, origin: ORIGIN });
    assert.equal(restored.state, 'succeeded');
    assert.deepEqual(restored.result, completed.result);
    assert.deepEqual(restored.terminal, completed.terminal);
    assert.deepEqual(restored.plan.focusedTest.networkPolicy, value.focusedTest.networkPolicy);
  } finally {
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(authorityDirectory, { recursive: true, force: true });
  }
});

await testAsync('V2 controlled prepare refusal creates no authority, grant, write or commit', async () => {
  const root = makeProject(), db = openPrivateHttpDatabase();
  const value = privateHttpProposal();
  const provider = controlledPrivateHttpProvider(root, db, value.focusedTest, 1);
  try {
    const service = createService(db, root, makeClock(), { processProvider: provider });
    await service.recoverIncompleteSmallProjectChanges();
    const beforeBytes = fs.readFileSync(path.join(root, 'src/app.js'));
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    await assert.rejects(prepare(service, value), { code: 'PROCESS_PRIVATE_HTTP_ARTIFACT_CHANGED' });
    for (const table of ['m2_execution_requests', 'm2_lifecycle_operations', 'm2_effect_requests', 'm2_approval_grants']) {
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0, table);
    }
    assert.deepEqual(provider.calls.map(call => call.stage), ['preflight']);
    assert.deepEqual(fs.readFileSync(path.join(root, 'src/app.js')), beforeBytes);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['status', '--porcelain=v1']), '');
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

await testAsync('V2 controlled postapproval preflight refusal stops before file mutation and never falls back to legacy execute', async () => {
  const root = makeProject(), db = openPrivateHttpDatabase();
  const value = privateHttpProposal();
  const provider = controlledPrivateHttpProvider(root, db, value.focusedTest, 2);
  try {
    const service = createService(db, root, makeClock(), { processProvider: provider });
    await service.recoverIncompleteSmallProjectChanges();
    const beforeBytes = fs.readFileSync(path.join(root, 'src/app.js'));
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const pending = await prepare(service, value);
    const completed = await service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
      lifecycleId: pending.lifecycleId, origin: ORIGIN, planDigest: pending.planDigest });
    assert.equal(completed.state, 'failed');
    assert.equal(completed.result.version, 2);
    assert.equal(completed.result.focusedTest.sandboxProfile, value.focusedTest.sandboxProfile);
    assert.equal(completed.result.focusedTest.networkPolicyDigest, value.focusedTest.networkPolicyDigest);
    assert.deepEqual(provider.calls.map(call => call.stage), ['preflight', 'preflight']);
    assert.deepEqual(fs.readFileSync(path.join(root, 'src/app.js')), beforeBytes);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['status', '--porcelain=v1']), '');
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

summary();
