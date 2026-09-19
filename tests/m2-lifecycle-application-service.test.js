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
import { compileCodeDraftInput } from '../src/lifecycle/m2-code-draft.js';
import { initializeNewProject } from '../src/planner/project-onboarding.js';

const PROJECT_ID = 27;
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
      binary: '/usr/bin/node',
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
        content: JSON.stringify({ afterContent: outputs[JSON.parse(prompt).path] }), finishReason: 'stop',
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
    assert.equal(completed.state, 'succeeded');
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
    assert.equal(completed.state, 'succeeded');
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
  await testAsync(`draft then exact approval uses real file/syntax authority (${invalidSyntax ? 'rollback' : 'success'})`, async () => {
    const root = makeProject();
    const db = openDatabase();
    let calls = 0;
    const output = invalidSyntax ? 'export const value = ;\n' : 'export const value = 42;\n';
    try {
      const service = createService(db, root, makeClock(), {
        generateCodeDraft: async ({ prompt, signal }) => {
          calls++;
          assert.equal(signal.aborted, false);
          const input = JSON.parse(prompt);
          assert.equal(input.path, 'src/app.js');
          assert.equal(input.beforeContent, 'export const value = 1;\n');
          return { content: JSON.stringify({ afterContent: output }), finishReason: 'stop' };
        },
      });
      await service.recoverIncompleteSmallProjectChanges();
      const planned = await service.draftSmallProjectChange({
        authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN,
        draft: { path: 'src/app.js', instruction: 'Change the exported value to 42.' },
      });
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
      if (invalidSyntax) {
        assert.notEqual(result.state, 'succeeded');
        assert.equal(result.result.focusedTest.terminalStatus, 'failed');
        assert.equal(result.result.rollback.status, 'succeeded');
        assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
      } else {
        assert.equal(result.state, 'succeeded');
        assert.equal(result.result.focusedTest.terminalStatus, 'succeeded');
        assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), output);
      }
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
  await testAsync(`three-file draft is atomic (${invalidLastFile ? 'last file syntax rolls all back' : 'functional import succeeds'})`, async () => {
    const root = makeProject();
    const db = openDatabase();
    const outputs = ["import {answer} from './helper.js'; export const value = answer;\n",
      'export const okay = true;\n', invalidLastFile ? 'export const answer = ;\n' : 'export const answer = 42;\n'];
    const paths = ['src/app.js', 'src/extra.js', 'src/helper.js'];
    let calls = 0;
    try {
      const service = createService(db, root, makeClock(), {
        generateCodeDraft: async ({ prompt }) => {
          const input = JSON.parse(prompt);
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
        argv: [...projectTestProfile().argv.slice(0, -2), '--experimental-default-type=module', '--input-type=module', '-e',
          "import assert from 'node:assert/strict';import {value} from './src/app.js';import {okay} from './src/extra.js';assert.equal(value,42);assert.equal(okay,true);"],
        environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000 };
      const planned = await service.draftSmallProjectChange({
        authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN, draft,
      });
      assert.equal(calls, 3);
      assert.equal(planned.state, 'awaiting_approval');
      assert.deepEqual(planned.diff.map(file => file.path), paths);
      assert.equal(db.prepare('SELECT count(*) AS n FROM m2_lifecycle_operations').get().n, 1);
      if (invalidLastFile) assert.deepEqual(planned.plan.focusedTest.argv.slice(-3), paths);
      const result = await service.approveSmallProjectChange({ authenticatedSubject: SUBJECT, origin: ORIGIN,
        lifecycleId: planned.lifecycleId, planDigest: planned.planDigest });
      if (invalidLastFile) {
        assert.notEqual(result.state, 'succeeded');
        assert.equal(result.result.focusedTest.terminalStatus, 'failed');
        assert.equal(result.result.rollback.status, 'succeeded');
        assert.equal(fs.readFileSync(path.join(root, paths[0]), 'utf8'), 'export const value = 1;\n');
        assert.equal(fs.existsSync(path.join(root, paths[1])), false);
        assert.equal(fs.existsSync(path.join(root, paths[2])), false);
      } else {
        assert.equal(result.state, 'succeeded');
        for (let index = 0; index < paths.length; index++)
          assert.equal(fs.readFileSync(path.join(root, paths[index]), 'utf8'), outputs[index]);
      }
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
  await testAsync(`bad first peer propagates as data but rolls the entire batch back (${invalidSyntax ? 'syntax' : 'functional'})`, async () => {
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
          const input = JSON.parse(prompt);
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
        argv: [...projectTestProfile().argv.slice(0, -2), '--experimental-default-type=module', '--input-type=module', '-e',
          "import assert from 'node:assert/strict';import {displayed} from './src/view.js';assert.equal(displayed,42,'transitive peer result');"],
        environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000 };
      const planned = await service.draftSmallProjectChange({
        authenticatedSubject: SUBJECT, projectId: PROJECT_ID, origin: ORIGIN, draft,
      });
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
      argv: [...projectTestProfile().argv.slice(0, projectTestProfile().argv.indexOf('--test')), '--experimental-default-type=module', '--input-type=module', '-e',
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
          const input = JSON.parse(prompt);
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
  'missing-parent', 'file-parent', 'dependency-overflow', 'late-length', 'late-cancel', 'late-stale']) {
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
        const input = JSON.parse(prompt); calls++;
        if (calls === 4 && failure === 'late-cancel') controller.abort();
        if (calls === 4 && failure === 'late-stale') fs.writeFileSync(path.join(root, 'src/foreign.js'), '// foreign\n');
        return { content: JSON.stringify({ afterContent: failure === 'dependency-overflow' && calls <= 3 ? '//'+ 'x'.repeat(16000)+'\n' : projectBuildOutputs[input.path] }),
          finishReason: calls === 4 && failure === 'late-length' ? 'length' : 'stop' };
      } });
      await service.recoverIncompleteSmallProjectChanges();
      const expected = { 'missing-parent': 'M2_CODE_DRAFT_PARENT_UNAVAILABLE', 'file-parent': 'M2_CODE_DRAFT_PATH_INVALID', cycle: 'M2_CODE_DRAFT_DEPENDENCY_CYCLE', traversal: 'M2_PROPOSAL_CHANGE_PATH_INVALID',
        'dependency-overflow': 'M2_CODE_DRAFT_CONTEXT_LIMIT_EXCEEDED', 'late-length': 'M2_CODE_DRAFT_OUTPUT_INCOMPLETE',
        'late-cancel': 'M2_CODE_DRAFT_CANCELLED', 'late-stale': 'M2_LIFECYCLE_CONTEXT_STALE' };
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
        calls++; const input = JSON.parse(prompt);
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

for (const defect of [null, 'owner', 'origin', 'digest', 'active', 'stale', 'missing-retained']) {
  await testAsync(`revision preserves reviewed bytes and requires same owned cancelled plan: ${defect ?? 'success'}`, async () => {
    const root = makeProject(); const db = openDatabase(); let calls = 0;
    try {
      const retained = 'export const helper = 42;\n';
      const service = createService(db, root, makeClock(), { generateCodeDraft: async ({ prompt }) => {
        calls++; const input = JSON.parse(prompt);
        assert.equal(input.path, 'src/app.js');
        assert.equal(input.beforeContent, 'export const value = 1;\n');
        assert.equal(input.previousDraft.content, 'export const value = 2;\n');
        assert.equal(input.previousDraft.state, 'unapplied_proposal');
        assert.equal(input.previousDraft.contentDigest, sha(input.previousDraft.content));
        assert.equal(input.peerFiles[0].content, retained);
        return { content: JSON.stringify({ afterContent: 'export const value = 3;\n' }), finishReason: 'stop' };
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
          stale: 'M2_LIFECYCLE_CONTEXT_STALE', 'missing-retained': 'M2_CODE_DRAFT_REVISION_UNAVAILABLE' };
        await assert.rejects(act(), { code: codes[defect] }); assert.equal(calls, 0);
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

summary();
