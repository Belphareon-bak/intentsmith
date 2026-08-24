#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_070_m2_effect_authority.js';
import { up as applyEffectAuthorityHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectExecutionClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyExecutionAuthority } from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { observeWorkspaceRevision } from '../src/code-intel/project-context-provider.js';
import { createApprovalGrantIssuer } from '../src/effects/approval-grant-issuer.js';
import { EffectAuthorityRepository } from '../src/effects/effect-authority-repository.js';
import { ExecutionAuthorityRepository } from '../src/execution/execution-authority-repository.js';
import {
  exactGitProvider,
  observeExactGitBaseline,
} from '../src/execution/exact-git-provider.js';
import { planProjectChange, ProjectChangePlanningErrorCode } from '../src/execution/project-change-planner.js';
import {
  executeProjectChange,
  ProjectChangeRuntimeErrorCode,
} from '../src/execution/project-change-runtime.js';
import { processSandboxProvider } from '../src/execution/process-sandbox-provider.js';
import { writeProjectFileAtomic } from '../src/executor/project-path-authority.js';
import { suite, testAsync, summary } from './harness.js';

const CREATED_MS = Date.parse('2026-08-24T05:30:00.000Z');
const OWNER_ONE = Object.freeze({
  ownerId: 'owner:runtime-one',
  pid: 5101,
  bootId: '11111111-1111-4111-8111-111111111111',
  startIdentity: '201',
});
const OWNER_TWO = Object.freeze({
  ownerId: 'owner:runtime-two',
  pid: 5102,
  bootId: '11111111-1111-4111-8111-111111111111',
  startIdentity: '202',
});

function sha(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function git(root, args, options = {}) {
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
    ...options,
  }).trim();
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-change-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/app.js'), 'export const value = 1;\n');
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '--', 'src/app.js']);
  git(root, [
    '-c', 'user.name=IntentSmith Test',
    '-c', 'user.email=intentsmith@example.invalid',
    'commit', '-m', 'baseline',
  ]);
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function workspaceRevision(root) {
  const entries = [];
  for (const relative of ['src/app.js', 'src/new.js']) {
    const absolute = path.join(root, relative);
    entries.push({
      path: relative,
      digest: fs.existsSync(absolute) ? sha(fs.readFileSync(absolute)) : null,
    });
  }
  return `wsr1:${createHash('sha256').update(JSON.stringify(entries)).digest('hex')}`;
}

function productionRevisionObserver(root) {
  const projects = Object.freeze({
    findById: Object.freeze({
      get(projectId) {
        return projectId === 17 ? { id: 17, path: root, status: 'active' } : null;
      },
    }),
  });
  return scope => observeWorkspaceRevision(scope, {}, { projects });
}

function openDb(databasePath = ':memory:') {
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  applyEffectAuthority(db);
  applyEffectAuthorityHardening(db);
  applyEffectExecutionClaims(db);
  applyEffectClaimTruth(db);
  applyExecutionAuthority(db);
  return db;
}

function successfulProcess() {
  return Object.freeze({
    async execute({ onSupervisor }) {
      onSupervisor({
        pid: 6201,
        processGroupId: 6201,
        bootId: '11111111-1111-4111-8111-111111111111',
        startIdentity: '301',
      });
      return {
        terminalStatus: 'succeeded',
        exitCode: 0,
        signal: null,
        stdoutDigest: sha(Buffer.alloc(0)),
        stderrDigest: sha(Buffer.alloc(0)),
        outputTruncated: false,
        lateCompletionRejected: false,
      };
    },
  });
}

function successfulMutatingProcess(mutate) {
  return Object.freeze({
    async execute({ onSupervisor }) {
      onSupervisor({
        pid: 6203,
        processGroupId: 6203,
        bootId: '11111111-1111-4111-8111-111111111111',
        startIdentity: '303',
      });
      mutate();
      return {
        terminalStatus: 'succeeded',
        exitCode: 0,
        signal: null,
        stdoutDigest: sha(Buffer.alloc(0)),
        stderrDigest: sha(Buffer.alloc(0)),
        outputTruncated: false,
        lateCompletionRejected: false,
      };
    },
  });
}

function failingProcess() {
  return Object.freeze({
    async execute({ onSupervisor }) {
      onSupervisor({
        pid: 6202,
        processGroupId: 6202,
        bootId: '11111111-1111-4111-8111-111111111111',
        startIdentity: '302',
      });
      return {
        terminalStatus: 'failed',
        exitCode: 7,
        signal: null,
        stdoutDigest: sha(Buffer.from('failed')),
        stderrDigest: sha(Buffer.from('boom')),
        outputTruncated: false,
        lateCompletionRejected: false,
      };
    },
  });
}

async function prepare(root, {
  twoFiles = true,
  commit = false,
  databasePath = ':memory:',
  changes = null,
  revisionObserver = null,
} = {}) {
  const plannedChanges = changes ?? [
    { path: 'src/app.js', afterContent: 'export const value = 2;\n' },
    ...(twoFiles ? [{ path: 'src/new.js', afterContent: 'export const added = true;\n' }] : []),
  ];
  const targetPaths = plannedChanges.map(change => change.path);
  const baseline = observeExactGitBaseline(root, targetPaths, { projectId: 17 });
  const observe = revisionObserver ?? (async () => ({
    projectId: 17,
    canonicalRoot: root,
    workspaceRevision: workspaceRevision(root),
  }));
  const revision = (await observe({ projectId: 17, canonicalRoot: root })).workspaceRevision;
  const environment = { NODE_ENV: 'test', NO_COLOR: '1' };
  const plan = await planProjectChange({
    executionId: 'execution-runtime-1',
    runId: 'run-runtime-1',
    actor: { type: 'user', id: 'user-1' },
    origin: {
      surface: 'studio',
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      projectId: 17,
    },
    projectContext: { projectId: 17, canonicalRoot: root, workspaceRevision: revision },
    gitBaseline: baseline,
    changes: plannedChanges,
    focusedTest: {
      binary: '/usr/bin/node',
      argv: ['--version'],
      environment,
      timeoutMs: 30_000,
    },
    gitCommit: commit ? {
      message: 'M2 exact project change',
      identity: {
        authorName: 'IntentSmith Runtime',
        authorEmail: 'runtime@example.invalid',
        authorDate: '2026-08-24T06:30:00Z',
        committerName: 'IntentSmith Runtime',
        committerEmail: 'runtime@example.invalid',
        committerDate: '2026-08-24T06:30:00Z',
      },
    } : null,
    createdAt: new Date(CREATED_MS).toISOString(),
  }, {
    observeRevision: observe,
  });

  const db = openDb(databasePath);
  let authorityNow = CREATED_MS + 10_000;
  const effectRepository = new EffectAuthorityRepository(db, { clock: () => authorityNow });
  const executionRepository = new ExecutionAuthorityRepository(db, { clock: () => authorityNow });
  for (const effect of plan.effectRequests) effectRepository.registerEffectRequest(effect);
  executionRepository.registerProjectChange(plan.request, { files: plan.files, git: plan.git });
  let grantOrdinal = 0;
  const issuer = createApprovalGrantIssuer(effectRepository, {
    clock: () => authorityNow,
    grantIdFactory: () => `grant-runtime-${++grantOrdinal}`,
    nonceFactory: () => `nonce-runtime-0000-${grantOrdinal}`,
  });
  const grants = plan.effectRequests.map(effect => ({
    effectId: effect.effectId,
    grantId: issuer.issue({
      effectId: effect.effectId,
      authenticatedSubject: { actorType: 'user', actorId: 'user-1' },
    }).grant.grantId,
  }));
  return {
    plan,
    db,
    effectRepository,
    executionRepository,
    grants,
    environment,
    baseline,
    observeRevision: observe,
    clock: () => ++authorityNow,
    advance(ms) { authorityNow += ms; },
  };
}

function dependencies(
  prepared,
  root,
  processProvider,
  owner = OWNER_ONE,
  liveness = { isProvablyDead: () => false },
  gitProvider = null,
) {
  return {
    executionRepository: prepared.executionRepository,
    effectRepository: prepared.effectRepository,
    owner,
    liveness,
    clock: prepared.clock,
    observeRevision: prepared.observeRevision,
    observeGitBaseline: observeExactGitBaseline,
    processProvider,
    gitProvider,
  };
}

suite('M2 project-change planner and durable runtime');

await testAsync('real two-file write and focused test produce one durable success', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root);
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, dependencies(prepared, root, successfulProcess()));
    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 2;\n');
    assert.equal(fs.readFileSync(path.join(root, 'src/new.js'), 'utf8'), 'export const added = true;\n');
    assert.equal(prepared.executionRepository.getResult(result.executionId).terminalStatus, 'succeeded');
    assert.equal(prepared.effectRepository.getEffectResult(result.focusedTest.effectId).terminalStatus, 'succeeded');
    assert.equal(prepared.executionRepository.listEvents(result.executionId)
      .filter(event => event.type === 'phase_applied').length, 2);
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('direct journey uses real bwrap test and exact Git commit end to end', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root, { commit: true });
    const beforeHead = prepared.plan.request.project.gitHead;
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, dependencies(
      prepared,
      root,
      processSandboxProvider,
      OWNER_ONE,
      { isProvablyDead: () => false },
      exactGitProvider,
    ));
    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(result.focusedTest.terminalStatus, 'succeeded');
    assert.equal(result.git.status, 'committed');
    assert.notEqual(result.git.afterHead, beforeHead);
    assert.equal(git(root, ['rev-parse', 'HEAD']), result.git.commitId);
    assert.equal(git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']), 'src/app.js\nsrc/new.js');
    assert.equal(git(root, ['status', '--porcelain=v1']), '');
    prepared.db.close();
  } finally {
    cleanup(root);
  }
}, 30_000);

await testAsync('real production revision observer accepts an exact committed non-manifest change', async () => {
  const root = makeProject();
  try {
    const observe = productionRevisionObserver(root);
    const prepared = await prepare(root, {
      commit: true,
      changes: [{ path: 'deploy.cfg', afterContent: 'release=green\n' }],
      revisionObserver: observe,
    });
    const beforeRevision = prepared.plan.request.project.workspaceRevision;
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, dependencies(
      prepared,
      root,
      successfulProcess(),
      OWNER_ONE,
      { isProvablyDead: () => false },
      exactGitProvider,
    ));
    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(result.changes.beforeRevision, beforeRevision);
    assert.equal(result.changes.afterRevision, beforeRevision);
    assert.equal(result.git.status, 'committed');
    assert.equal(result.rollback.required, false);
    assert.equal(fs.readFileSync(path.join(root, 'deploy.cfg'), 'utf8'), 'release=green\n');
    assert.equal(prepared.executionRepository.getResult(result.executionId)?.terminalStatus, 'succeeded');
    prepared.db.close();
  } finally {
    cleanup(root);
  }
}, 30_000);

await testAsync('post-write revision observer failure is durably failed and rolled back', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root, { twoFiles: false });
    let observations = 0;
    prepared.observeRevision = async () => {
      observations += 1;
      if (observations === 1) {
        return { projectId: 17, canonicalRoot: root, workspaceRevision: prepared.plan.request.project.workspaceRevision };
      }
      throw new Error('revision observer unavailable');
    };
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, dependencies(prepared, root, successfulProcess()));
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.errorCode, ProjectChangeRuntimeErrorCode.CONTEXT_STALE);
    assert.equal(result.rollback.status, 'succeeded');
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(prepared.executionRepository.getResult(result.executionId)?.terminalStatus, 'failed');
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('post-write Git observer failure is durably failed and rolled back', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root, { twoFiles: false });
    const runtimeDependencies = dependencies(prepared, root, successfulProcess());
    let observations = 0;
    runtimeDependencies.observeGitBaseline = (...args) => {
      observations += 1;
      if (observations === 1) return observeExactGitBaseline(...args);
      throw new Error('git observer unavailable');
    };
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, runtimeDependencies);
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.errorCode, ProjectChangeRuntimeErrorCode.GIT_FAILED);
    assert.equal(result.git.status, 'not_requested');
    assert.equal(result.git.foreignDirtPreserved, false);
    assert.equal(result.rollback.status, 'succeeded');
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(prepared.executionRepository.getResult(result.executionId)?.terminalStatus, 'failed');
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('post-commit revision observer failure records an honest durable orphan without throwing', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root, { commit: true, twoFiles: false });
    let observations = 0;
    prepared.observeRevision = async () => {
      observations += 1;
      if (observations === 1) {
        return { projectId: 17, canonicalRoot: root, workspaceRevision: prepared.plan.request.project.workspaceRevision };
      }
      throw new Error('revision observer unavailable after commit');
    };
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, dependencies(
      prepared,
      root,
      successfulProcess(),
      OWNER_ONE,
      { isProvablyDead: () => false },
      exactGitProvider,
    ));
    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.errorCode, ProjectChangeRuntimeErrorCode.CONTEXT_STALE);
    assert.equal(result.git.status, 'committed');
    assert.equal(result.rollback.required, false);
    assert.equal(git(root, ['rev-parse', 'HEAD']), result.git.commitId);
    assert.equal(prepared.executionRepository.getResult(result.executionId)?.terminalStatus, 'orphaned');
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('SIGKILL after Git index update is completed by generation-two recovery without rerunning effects', async () => {
  const root = makeProject();
  const artifactRoot = path.join(process.cwd(), '.intentsmith-artifacts', 'direct-tests');
  fs.mkdirSync(artifactRoot, { recursive: true });
  const crashRoot = fs.mkdtempSync(path.join(artifactRoot, 'm2-runtime-git-crash-'));
  const databasePath = path.join(crashRoot, 'authority.sqlite');
  try {
    const prepared = await prepare(root, {
      commit: true,
      databasePath,
      changes: [{ path: 'deploy.cfg', afterContent: 'release=green\n' }],
      revisionObserver: productionRevisionObserver(root),
    });
    const originalHead = prepared.plan.request.project.gitHead;
    prepared.db.close();

    const moduleUrls = {
      effectRepository: new URL('../src/effects/effect-authority-repository.js', import.meta.url).href,
      executionRepository: new URL('../src/execution/execution-authority-repository.js', import.meta.url).href,
      runtime: new URL('../src/execution/project-change-runtime.js', import.meta.url).href,
      git: new URL('../src/execution/exact-git-provider.js', import.meta.url).href,
      projectContext: new URL('../src/code-intel/project-context-provider.js', import.meta.url).href,
    };
    const crashScript = path.join(crashRoot, 'runtime-crash.mjs');
    fs.writeFileSync(crashScript, `
      import { createHash } from 'node:crypto';
      import Database from 'better-sqlite3';
      import { EffectAuthorityRepository } from ${JSON.stringify(moduleUrls.effectRepository)};
      import { ExecutionAuthorityRepository } from ${JSON.stringify(moduleUrls.executionRepository)};
      import { executeProjectChange } from ${JSON.stringify(moduleUrls.runtime)};
      import { commitExactProjectChange, observeExactGitBaseline } from ${JSON.stringify(moduleUrls.git)};
      import { observeWorkspaceRevision } from ${JSON.stringify(moduleUrls.projectContext)};

      const root = ${JSON.stringify(root)};
      const databasePath = ${JSON.stringify(databasePath)};
      const fixedNow = ${CREATED_MS + 10_000};
      const db = new Database(databasePath);
      db.pragma('foreign_keys = ON');
      const effectRepository = new EffectAuthorityRepository(db, { clock: () => fixedNow });
      const executionRepository = new ExecutionAuthorityRepository(db, { clock: () => fixedNow });
      const projects = { findById: { get: projectId => (
        projectId === 17 ? { id: 17, path: root, status: 'active' } : null
      ) } };
      const processProvider = {
        async execute({ onSupervisor }) {
          onSupervisor({
            pid: 7301,
            processGroupId: 7301,
            bootId: '11111111-1111-4111-8111-111111111111',
            startIdentity: '401',
          });
          const empty = 'sha256:' + createHash('sha256').update(Buffer.alloc(0)).digest('hex');
          return {
            terminalStatus: 'succeeded', exitCode: 0, signal: null,
            stdoutDigest: empty, stderrDigest: empty,
            outputTruncated: false, lateCompletionRejected: false,
          };
        },
      };
      await executeProjectChange({
        executionId: ${JSON.stringify(prepared.plan.request.executionId)},
        grants: ${JSON.stringify(prepared.grants)},
        focusedEnvironment: ${JSON.stringify(prepared.environment)},
      }, {
        executionRepository,
        effectRepository,
        owner: ${JSON.stringify(OWNER_ONE)},
        liveness: { isProvablyDead: () => false },
        clock: () => fixedNow,
        observeRevision: scope => observeWorkspaceRevision(scope, {}, { projects }),
        observeGitBaseline: observeExactGitBaseline,
        processProvider,
        gitProvider: {
          commit(input) {
            return commitExactProjectChange(input, {
              afterIndexUpdate() { process.kill(process.pid, 'SIGKILL'); },
            });
          },
        },
      });
      process.exit(87);
    `);
    const crashed = spawnSync(process.execPath, [crashScript], {
      encoding: 'utf8',
      env: { ...process.env, HOME: '/nonexistent' },
      stdio: 'pipe',
    });
    assert.equal(crashed.status, null, crashed.stderr);
    assert.equal(crashed.signal, 'SIGKILL');
    assert.notEqual(git(root, ['rev-parse', 'HEAD']), originalHead);
    let recoveryNow = CREATED_MS + 45_000;
    const recoveryDb = new Database(databasePath);
    recoveryDb.pragma('foreign_keys = ON');
    const recoveryPrepared = {
      executionRepository: new ExecutionAuthorityRepository(recoveryDb, { clock: () => recoveryNow }),
      effectRepository: new EffectAuthorityRepository(recoveryDb, { clock: () => recoveryNow }),
      observeRevision: productionRevisionObserver(root),
      clock: () => ++recoveryNow,
    };
    let processReruns = 0;
    const result = await executeProjectChange({
      executionId: 'execution-runtime-1',
      focusedEnvironment: { NODE_ENV: 'test', NO_COLOR: '1' },
    }, dependencies(
      recoveryPrepared,
      root,
      { async execute() { processReruns += 1; throw new Error('recovery reran focused test'); } },
      OWNER_TWO,
      { isProvablyDead: () => true },
      exactGitProvider,
    ));
    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(result.fencingGeneration, 2);
    assert.equal(result.git.status, 'committed');
    assert.equal(result.changes.afterRevision, result.changes.beforeRevision);
    assert.equal(git(root, ['rev-parse', 'HEAD']), result.git.commitId);
    assert.equal(git(root, ['status', '--porcelain=v1']), '');
    assert.equal(fs.readFileSync(path.join(root, 'deploy.cfg'), 'utf8'), 'release=green\n');
    assert.equal(result.rollback.required, false);
    assert.equal(processReruns, 0);
    assert.equal(recoveryPrepared.effectRepository
      .getEffectResult(prepared.plan.request.gitCommit.authority.effectId)?.terminalStatus, 'succeeded');
    recoveryDb.close();
  } finally {
    cleanup(root);
    cleanup(crashRoot);
  }
}, 30_000);

await testAsync('nonzero focused test restores old bytes and deletes a newly created file', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root);
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, dependencies(prepared, root, failingProcess()));
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.rollback.status, 'succeeded');
    assert.deepEqual(result.rollback.paths, ['src/app.js', 'src/new.js']);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(fs.existsSync(path.join(root, 'src/new.js')), false);
    const rollbackResults = prepared.plan.request.changes.map(change => (
      prepared.effectRepository.getEffectResult(change.rollbackAuthority.effectId)?.terminalStatus
    ));
    assert.deepEqual(rollbackResults, ['succeeded', 'succeeded']);
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('post-write readback failure records the forward effect as orphaned before compensation', async () => {
  const root = makeProject();
  const targetPath = path.join(root, 'src/app.js');
  const originalReadFileSync = fs.readFileSync;
  let injectedReads = 0;
  try {
    const prepared = await prepare(root, { twoFiles: false });
    const change = prepared.plan.request.changes[0];
    fs.readFileSync = function injectedRead(file, ...args) {
      if (Number.isInteger(file) && injectedReads < 2) {
        let openedPath = null;
        try { openedPath = fs.realpathSync(`/proc/self/fd/${file}`); } catch { /* unrelated descriptor */ }
        if (openedPath === targetPath) {
          const bytes = originalReadFileSync.call(fs, file, ...args);
          if (sha(bytes) === change.after.digest) {
            injectedReads += 1;
            const error = new Error('forced post-write readback failure');
            error.code = 'EIO';
            throw error;
          }
          return bytes;
        }
      }
      return originalReadFileSync.call(fs, file, ...args);
    };

    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, dependencies(prepared, root, successfulProcess()));
    const forwardEffectId = change.forwardAuthority.effectId;
    const forward = prepared.effectRepository.getEffectResult(forwardEffectId);

    assert.equal(injectedReads, 2);
    assert.equal(forward.terminalStatus, 'orphaned');
    assert.deepEqual(forward.changes.paths, [change.path]);
    assert.equal(forward.changes.afterDigest, null);
    assert.equal(forward.rollback.required, true);
    assert.equal(forward.rollback.status, 'pending');
    assert.equal(forward.lateCompletionRejected, true);
    assert.equal(result.terminalStatus, 'failed');
    assert.equal(result.rollback.status, 'succeeded');
    assert.equal(fs.readFileSync(targetPath, 'utf8'), 'export const value = 1;\n');
    prepared.db.close();
  } finally {
    fs.readFileSync = originalReadFileSync;
    cleanup(root);
  }
});

await testAsync('post-readback symlink replacement never succeeds across revision and Git variants', async () => {
  for (const target of ['src/app.js', 'deploy.cfg']) {
    for (const commit of [false, true]) {
      const root = makeProject();
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-foreign-target-'));
      const secret = path.join(outside, 'secret.txt');
      const secretBytes = `SECRET:${target}:${commit}\n`;
      fs.writeFileSync(secret, secretBytes);
      try {
        const observe = productionRevisionObserver(root);
        const prepared = await prepare(root, {
          commit,
          changes: [{ path: target, afterContent: 'approved=true\n' }],
          revisionObserver: observe,
        });
        const targetPath = path.join(root, target);
        const result = await executeProjectChange({
          executionId: prepared.plan.request.executionId,
          grants: prepared.grants,
          focusedEnvironment: prepared.environment,
        }, dependencies(
          prepared,
          root,
          successfulMutatingProcess(() => {
            fs.rmSync(targetPath, { recursive: true, force: true });
            fs.symlinkSync(secret, targetPath);
          }),
          OWNER_ONE,
          { isProvablyDead: () => false },
          commit ? exactGitProvider : null,
        ));
        assert.equal(result.terminalStatus, 'orphaned', `${target} commit=${commit}`);
        assert.equal(result.errorCode, ProjectChangeRuntimeErrorCode.ROLLBACK_FAILED);
        assert.equal(result.rollback.status, 'failed');
        assert.deepEqual(result.rollback.paths, [target]);
        assert.equal(fs.lstatSync(targetPath).isSymbolicLink(), true);
        assert.equal(fs.readFileSync(secret, 'utf8'), secretBytes);
        assert.equal(prepared.executionRepository.getResult(result.executionId)?.terminalStatus, 'orphaned');
        const restarted = await executeProjectChange({
          executionId: prepared.plan.request.executionId,
          focusedEnvironment: prepared.environment,
        }, dependencies(
          prepared,
          root,
          { async execute() { throw new Error('terminal restart must not execute'); } },
          OWNER_TWO,
          { isProvablyDead: () => true },
          commit ? exactGitProvider : null,
        ));
        assert.deepEqual(restarted, result);
        prepared.db.close();
      } finally {
        cleanup(root);
        cleanup(outside);
      }
    }
  }
});

await testAsync('post-readback directory replacement records one durable orphan and restart returns it', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root, { twoFiles: false });
    const targetPath = path.join(root, 'src/app.js');
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      grants: prepared.grants,
      focusedEnvironment: prepared.environment,
    }, dependencies(prepared, root, successfulMutatingProcess(() => {
      fs.rmSync(targetPath, { force: true });
      fs.mkdirSync(targetPath);
      fs.writeFileSync(path.join(targetPath, 'foreign.txt'), 'foreign directory bytes\n');
    })));
    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.errorCode, ProjectChangeRuntimeErrorCode.ROLLBACK_FAILED);
    assert.equal(result.rollback.status, 'failed');
    assert.equal(fs.readFileSync(path.join(targetPath, 'foreign.txt'), 'utf8'), 'foreign directory bytes\n');
    assert.equal(prepared.executionRepository.getResult(result.executionId)?.terminalStatus, 'orphaned');
    const restarted = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      focusedEnvironment: prepared.environment,
    }, dependencies(prepared, root, successfulProcess(), OWNER_TWO, { isProvablyDead: () => true }));
    assert.deepEqual(restarted, result);
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('takeover classifies symlink and directory observations as foreign without throwing', async () => {
  for (const replacement of ['symlink', 'directory']) {
    const root = makeProject();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-recovery-foreign-'));
    try {
      const prepared = await prepare(root, { twoFiles: false });
      const claim = prepared.executionRepository.acquireClaim({
        executionId: prepared.plan.request.executionId,
        owner: OWNER_ONE,
        leaseMs: 1_000,
        liveness: { isProvablyDead: () => false },
      });
      const items = prepared.plan.effectRequests.map(effect => {
        const grantId = prepared.grants.find(entry => entry.effectId === effect.effectId).grantId;
        return { grantId, request: { ...effect, approvalGrantId: grantId } };
      });
      prepared.effectRepository.consumeApprovalGrantBatch({ items, executionOwner: OWNER_ONE });
      prepared.executionRepository.recordApprovalSet({
        executionId: prepared.plan.request.executionId,
        generation: claim.generation,
        grantIds: prepared.grants.map(entry => entry.grantId)
          .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
      });
      const targetPath = path.join(root, 'src/app.js');
      fs.rmSync(targetPath, { force: true });
      if (replacement === 'directory') {
        fs.mkdirSync(targetPath);
        fs.writeFileSync(path.join(targetPath, 'foreign.txt'), 'foreign\n');
      } else {
        const secret = path.join(outside, 'secret.txt');
        fs.writeFileSync(secret, 'foreign\n');
        fs.symlinkSync(secret, targetPath);
      }
      prepared.advance(2_000);
      const result = await executeProjectChange({
        executionId: prepared.plan.request.executionId,
        focusedEnvironment: prepared.environment,
      }, dependencies(
        prepared,
        root,
        { async execute() { throw new Error('recovery must not execute'); } },
        OWNER_TWO,
        { isProvablyDead: () => true },
      ));
      assert.equal(result.terminalStatus, 'orphaned', replacement);
      assert.equal(result.rollback.status, 'failed');
      assert.equal(prepared.executionRepository.getResult(result.executionId)?.terminalStatus, 'orphaned');
      const restarted = await executeProjectChange({
        executionId: prepared.plan.request.executionId,
        focusedEnvironment: prepared.environment,
      }, dependencies(prepared, root, successfulProcess(), OWNER_TWO, { isProvablyDead: () => true }));
      assert.deepEqual(restarted, result);
      prepared.db.close();
    } finally {
      cleanup(root);
      cleanup(outside);
    }
  }
});

await testAsync('restart takeover scans exact after-images and rolls the transaction back', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root);
    const claim = prepared.executionRepository.acquireClaim({
      executionId: prepared.plan.request.executionId,
      owner: OWNER_ONE,
      leaseMs: 1_000,
      liveness: { isProvablyDead: () => false },
    });
    const items = prepared.plan.effectRequests.map(effect => {
      const grantId = prepared.grants.find(entry => entry.effectId === effect.effectId).grantId;
      return { grantId, request: { ...effect, approvalGrantId: grantId } };
    });
    prepared.effectRepository.consumeApprovalGrantBatch({ items, executionOwner: OWNER_ONE });
    prepared.executionRepository.recordApprovalSet({
      executionId: prepared.plan.request.executionId,
      generation: claim.generation,
      grantIds: prepared.grants.map(entry => entry.grantId)
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    });
    for (const [index, file] of prepared.plan.files.entries()) {
      const current = prepared.executionRepository.getFileMaterial(prepared.plan.request.executionId)[index];
      writeProjectFileAtomic(root, file.path, file.afterBytes, {
        expectedTarget: null,
        createParents: false,
        desiredMode: prepared.plan.request.changes[index].after.mode,
      });
      assert.equal(sha(fs.readFileSync(path.join(root, file.path))), prepared.plan.request.changes[index].after.digest);
      assert.equal(current.path, file.path);
    }
    prepared.advance(2_000);
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      focusedEnvironment: prepared.environment,
    }, dependencies(
      prepared,
      root,
      successfulProcess(),
      OWNER_TWO,
      { isProvablyDead: () => true },
    ));
    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.rollback.status, 'succeeded');
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(fs.existsSync(path.join(root, 'src/new.js')), false);
    assert.equal(result.fencingGeneration, 2);
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('takeover reconstructs a complete consumed grant batch after the approval-set crash window', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root);
    const claim = prepared.executionRepository.acquireClaim({
      executionId: prepared.plan.request.executionId,
      owner: OWNER_ONE,
      leaseMs: 1_000,
      liveness: { isProvablyDead: () => false },
    });
    assert.equal(claim.generation, 1);
    const items = prepared.plan.effectRequests.map(effect => {
      const grantId = prepared.grants.find(entry => entry.effectId === effect.effectId).grantId;
      return { grantId, request: { ...effect, approvalGrantId: grantId } };
    });
    prepared.effectRepository.consumeApprovalGrantBatch({ items, executionOwner: OWNER_ONE });
    assert.equal(prepared.executionRepository.getLatestApprovalSet(prepared.plan.request.executionId), null);
    assert.equal(prepared.executionRepository.getConsumedApprovalSet(prepared.plan.request.executionId).status, 'complete');

    prepared.advance(2_000);
    let processReruns = 0;
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      focusedEnvironment: prepared.environment,
    }, dependencies(
      prepared,
      root,
      { async execute() { processReruns += 1; throw new Error('must remain recovery-only'); } },
      OWNER_TWO,
      { isProvablyDead: () => true },
    ));
    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.fencingGeneration, 2);
    assert.equal(processReruns, 0);
    assert.equal(prepared.executionRepository
      .getLatestApprovalSet(prepared.plan.request.executionId).generation, 2);
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('takeover rejects a partial consumed grant set without executing or writing', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root);
    prepared.executionRepository.acquireClaim({
      executionId: prepared.plan.request.executionId,
      owner: OWNER_ONE,
      leaseMs: 1_000,
      liveness: { isProvablyDead: () => false },
    });
    const effect = prepared.plan.effectRequests[0];
    const grantId = prepared.grants.find(entry => entry.effectId === effect.effectId).grantId;
    prepared.effectRepository.consumeApprovalGrantBatch({
      items: [{ grantId, request: { ...effect, approvalGrantId: grantId } }],
      executionOwner: OWNER_ONE,
    });
    assert.equal(prepared.executionRepository.getConsumedApprovalSet(prepared.plan.request.executionId).status, 'partial');
    prepared.advance(2_000);
    let processReruns = 0;
    await assert.rejects(() => executeProjectChange({
      executionId: prepared.plan.request.executionId,
      focusedEnvironment: prepared.environment,
    }, dependencies(
      prepared,
      root,
      { async execute() { processReruns += 1; throw new Error('must not execute'); } },
      OWNER_TWO,
      { isProvablyDead: () => true },
    )), error => error.code === ProjectChangeRuntimeErrorCode.AUTHORITY_INCOMPLETE);
    assert.equal(processReruns, 0);
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'export const value = 1;\n');
    assert.equal(fs.existsSync(path.join(root, 'src/new.js')), false);
    assert.equal(prepared.executionRepository.getResult(prepared.plan.request.executionId), null);
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('restart never overwrites a third-party drifted image', async () => {
  const root = makeProject();
  try {
    const prepared = await prepare(root, { twoFiles: false });
    const claim = prepared.executionRepository.acquireClaim({
      executionId: prepared.plan.request.executionId,
      owner: OWNER_ONE,
      leaseMs: 1_000,
      liveness: { isProvablyDead: () => false },
    });
    const items = prepared.plan.effectRequests.map(effect => {
      const grantId = prepared.grants.find(entry => entry.effectId === effect.effectId).grantId;
      return { grantId, request: { ...effect, approvalGrantId: grantId } };
    });
    prepared.effectRepository.consumeApprovalGrantBatch({ items, executionOwner: OWNER_ONE });
    prepared.executionRepository.recordApprovalSet({
      executionId: prepared.plan.request.executionId,
      generation: claim.generation,
      grantIds: prepared.grants.map(entry => entry.grantId)
        .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    });
    fs.writeFileSync(path.join(root, 'src/app.js'), 'external owner bytes\n');
    prepared.advance(2_000);
    const result = await executeProjectChange({
      executionId: prepared.plan.request.executionId,
      focusedEnvironment: prepared.environment,
    }, dependencies(prepared, root, successfulProcess(), OWNER_TWO, { isProvablyDead: () => true }));
    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.rollback.status, 'failed');
    assert.equal(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8'), 'external owner bytes\n');
    prepared.db.close();
  } finally {
    cleanup(root);
  }
});

await testAsync('planner rejects a dirty target before registering any effect', async () => {
  const root = makeProject();
  try {
    fs.writeFileSync(path.join(root, 'src/app.js'), 'dirty\n');
    const baseline = observeExactGitBaseline(root, ['src/app.js'], { projectId: 17 });
    await assert.rejects(() => planProjectChange({
      executionId: 'execution-dirty',
      runId: 'run-dirty',
      actor: { type: 'user', id: 'user-1' },
      origin: { surface: 'studio', sessionId: null, conversationId: null, projectId: 17 },
      projectContext: { projectId: 17, canonicalRoot: root, workspaceRevision: workspaceRevision(root) },
      gitBaseline: baseline,
      changes: [{ path: 'src/app.js', afterContent: 'next\n' }],
      focusedTest: { binary: '/usr/bin/node', argv: ['--version'], environment: {}, timeoutMs: 1_000 },
      createdAt: new Date(CREATED_MS).toISOString(),
    }, {
      observeRevision: async () => ({ workspaceRevision: workspaceRevision(root) }),
    }), error => error.code === ProjectChangePlanningErrorCode.TARGET_DIRTY);
  } finally {
    cleanup(root);
  }
});

await testAsync('planner rejects a hardlinked target and preserves both names', async () => {
  const root = makeProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-m2-hardlink-'));
  try {
    fs.linkSync(path.join(root, 'src/app.js'), path.join(outside, 'alias.js'));
    const baseline = observeExactGitBaseline(root, ['src/app.js'], { projectId: 17 });
    await assert.rejects(() => planProjectChange({
      executionId: 'execution-hardlink',
      runId: 'run-hardlink',
      actor: { type: 'user', id: 'user-1' },
      origin: { surface: 'studio', sessionId: null, conversationId: null, projectId: 17 },
      projectContext: { projectId: 17, canonicalRoot: root, workspaceRevision: workspaceRevision(root) },
      gitBaseline: baseline,
      changes: [{ path: 'src/app.js', afterContent: 'next\n' }],
      focusedTest: { binary: '/usr/bin/node', argv: ['--version'], environment: {}, timeoutMs: 1_000 },
      createdAt: new Date(CREATED_MS).toISOString(),
    }, {
      observeRevision: async () => ({ workspaceRevision: workspaceRevision(root) }),
    }), error => error.code === ProjectChangePlanningErrorCode.TARGET_HARDLINKED);
    assert.equal(fs.readFileSync(path.join(outside, 'alias.js'), 'utf8'), 'export const value = 1;\n');
  } finally {
    cleanup(root);
    cleanup(outside);
  }
});

summary();
