#!/usr/bin/env node

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
  fs.mkdirSync(path.join(root, '.c3'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.c3', 'm2-governance-policy.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-lifecycle-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  writePolicy(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '--', '.c3/m2-governance-policy.json', 'src/app.js']);
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
    applyEffectAuthority(db);
    applyEffectAuthorityHardening(db);
    applyEffectExecutionClaims(db);
    applyEffectClaimTruth(db);
    applyExecutionAuthority(db);
    applyLifecycleAuthority(db);
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
      if (failure === 'ignored') draft.path = '.c3/private.js';
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
        argv: ['--experimental-default-type=module', '--input-type=module', '-e',
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
      if (failure === 'ignored-second') draft.paths[1] = '.c3/private.js';
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

summary();
