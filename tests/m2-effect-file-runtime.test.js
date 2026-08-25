import { isolatedTestRuntime } from './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { up as applyEffectAuthorityMigration } from '../src/db/migrations/2026_08_23_070_m2_effect_authority.js';
import { up as applyEffectAuthorityHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectExecutionClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyToolAuthority } from '../src/db/migrations/2026_08_24_074_m2_tool_authority.js';
import { up as applyToolEffectLinks } from '../src/db/migrations/2026_08_24_075_m2_tool_effect_links.js';
import { up as applyToolTruth } from '../src/db/migrations/2026_08_24_076_m2_tool_authority_truth.js';
import { up as applyEffectInvalidations } from '../src/db/migrations/2026_08_24_077_m2_effect_invalidations.js';
import { up as applyEffectSemanticAuthority } from '../src/db/migrations/2026_08_24_080_m2_effect_semantic_authority.js';
import { up as applyEffectResultSemanticV2 } from '../src/db/migrations/2026_08_24_081_m2_effect_result_semantic_authority_v2.js';
import { createEffectFileRuntime } from '../src/effects/effect-file-runtime.js';
import { EffectAuthorityRepository } from '../src/effects/effect-authority-repository.js';
import { createApprovalGrantIssuer } from '../src/effects/approval-grant-issuer.js';
import { processExecutionOwner } from '../src/effects/execution-owner.js';
import { computeEffectRequestDigest } from '../contracts/m2/effect-v1.js';
import { db as applicationDatabase, projects } from '../src/db/database.js';
import { suite, testAsync, summary } from './harness.js';

void isolatedTestRuntime;

function openDatabase(filename) {
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  const hasAuthority = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'm2_effect_requests'",
  ).get());
  if (!hasAuthority) {
    applyEffectAuthorityMigration(database);
    applyEffectAuthorityHardening(database);
    applyEffectExecutionClaims(database);
  }
  const hasInvalidations = Boolean(database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'm2_effect_invalidations'",
  ).get());
  if (!hasInvalidations) {
    applyEffectClaimTruth(database);
    applyToolAuthority(database);
    applyToolEffectLinks(database);
    applyToolTruth(database);
    applyEffectInvalidations(database);
    applyEffectSemanticAuthority(database);
  }
  return database;
}

async function withEnvironment(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-effect-runtime-'));
  const projectRoot = path.join(directory, 'project');
  const databasePath = path.join(directory, 'authority.sqlite');
  mkdirSync(path.join(projectRoot, 'notes'), { recursive: true });
  let database = openDatabase(databasePath);
  const workspaceAuthority = Object.freeze({
    async observe() {
      return Object.freeze({
        canonicalRoot: realpathSync(projectRoot),
        workspaceRevision: 'wsr1:runtime-integration',
      });
    },
  });
  const runtime = (options = {}) => createEffectFileRuntime({
    database,
    workspaceAuthority,
    ...options,
  });

  try {
    await callback({
      projectRoot,
      databasePath,
      get database() { return database; },
      runtime,
      reopen() {
        database.close();
        database = openDatabase(databasePath);
      },
    });
  } finally {
    if (database.open) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function requestInput(projectRoot, overrides = {}) {
  return {
    sessionId: 'session-1',
    conversationId: 'conversation-1',
    subjectId: 'local-operator',
    operationId: 'message:101',
    projectId: 17,
    projectRoot,
    relativePath: 'notes/result.md',
    content: 'Příliš žluťoučký kůň\n',
    ...overrides,
  };
}

suite('M2 durable filesystem effect runtime');

await testAsync('request persists exact pending bytes and exact approval is the only write path', async () => {
  await withEnvironment(async environment => {
    const runtime = environment.runtime();
    const input = requestInput(environment.projectRoot);
    const target = path.join(environment.projectRoot, input.relativePath);
    const prepared = await runtime.requestFilesystemWrite(input);

    assert.equal(prepared.state, 'approval_required');
    assert.equal(runtime.getPending(prepared.effectId).subjectId, input.subjectId);
    assert.equal(
      environment.database.prepare('SELECT payload_bytes AS bytes FROM m2_pending_effect_payloads').get().bytes,
      Buffer.byteLength(input.content, 'utf8'),
    );
    assert.throws(
      () => environment.database.prepare(
        'UPDATE m2_pending_effect_payloads SET subject_id = ? WHERE effect_id = ?',
      ).run('attacker', prepared.effectId),
      /append-only/,
    );
    assert.throws(
      () => environment.database.prepare(
        'DELETE FROM m2_pending_effect_payloads WHERE effect_id = ?',
      ).run(prepared.effectId),
      /PAYLOAD_IS_ACTIVE/,
    );
    await assert.rejects(
      runtime.approveFilesystemWrite({
        effectId: prepared.effectId,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        subjectId: 'attacker',
      }),
      error => error?.code === 'EFFECT_PENDING_NOT_FOUND',
    );
    assert.throws(() => readFileSync(target), /ENOENT/);

    const result = await runtime.approveFilesystemWrite({
      effectId: prepared.effectId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });

    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(readFileSync(target, 'utf8'), input.content);
    assert.equal(runtime.getPending(prepared.effectId), null);
    assert.deepEqual(
      environment.database.prepare(`
        SELECT event_type AS type FROM m2_effect_authority_events
        WHERE effect_id = ? ORDER BY seq
      `).all(prepared.effectId).map(row => row.type),
      ['REQUEST_REGISTERED', 'GRANT_ISSUED', 'GRANT_CONSUMED', 'RESULT_RECORDED'],
    );
  });
});

await testAsync('pending effect survives restart and remains bound to its original conversation and subject', async () => {
  await withEnvironment(async environment => {
    const input = requestInput(environment.projectRoot, {
      conversationId: 'conversation-restart',
      operationId: 'message:102',
      relativePath: 'notes/restart.md',
      content: 'restart durable\n',
    });
    const prepared = await environment.runtime().requestFilesystemWrite(input);
    environment.reopen();
    const restarted = environment.runtime();

    assert.equal(restarted.getPending(prepared.effectId).conversationId, input.conversationId);
    await assert.rejects(
      restarted.approveFilesystemWrite({
        effectId: prepared.effectId,
        sessionId: 'session-after-reconnect',
        conversationId: 'different-conversation',
        subjectId: input.subjectId,
      }),
      error => error?.code === 'EFFECT_PENDING_NOT_FOUND',
    );
    const result = await restarted.approveFilesystemWrite({
      effectId: prepared.effectId,
      sessionId: 'session-after-reconnect',
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });

    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(
      readFileSync(path.join(environment.projectRoot, input.relativePath), 'utf8'),
      input.content,
    );
    assert.equal(restarted.getPending(prepared.effectId), null);
  });
});

await testAsync('startup isolates a quarantined legacy terminal without disabling unrelated approvals', async () => {
  await withEnvironment(async environment => {
    const input = requestInput(environment.projectRoot, {
      operationId: 'message:quarantine-startup',
      relativePath: 'notes/quarantine.md',
      content: 'quarantine startup\n',
    });
    const prepared = await environment.runtime().requestFilesystemWrite(input);
    const repository = new EffectAuthorityRepository(environment.database);
    const request = repository.getEffectRequest(prepared.effectId);
    const grant = createApprovalGrantIssuer(repository).issue({
      effectId: prepared.effectId,
      authenticatedSubject: { actorType: 'user', actorId: input.subjectId },
    }).grant;
    repository.consumeApprovalGrant({
      grantId: grant.grantId,
      request: repository.getEffectRequest(prepared.effectId),
      executionOwner: processExecutionOwner,
    });
    const claimedAtMs = repository.getExecutionClaim(prepared.effectId).claimedAtMs;
    const result = {
      contract: 'EffectResult', version: 1,
      effectId: prepared.effectId, runId: request.runId,
      projectId: request.origin.projectId,
      requestDigest: computeEffectRequestDigest(request),
      approvalGrantId: grant.grantId, terminalStatus: 'succeeded',
      startedAt: new Date(claimedAtMs).toISOString(),
      completedAt: new Date(claimedAtMs + 1).toISOString(),
      process: { pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null },
      changes: {
        paths: [request.target.relativePath], beforeDigest: null,
        afterDigest: request.payloadDigest, diffArtifact: null,
      },
      network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
      rollback: { required: false, status: 'not_required', evidenceRef: null },
      outputDigest: request.payloadDigest, errorCode: null,
      evidenceRefs: [], lateCompletionRejected: false,
    };
    environment.database.prepare(`
      INSERT INTO m2_effect_results (
        effect_id, run_id, project_id, request_digest, approval_grant_id,
        terminal_status, result_json, completed_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.effectId, result.runId, result.projectId, result.requestDigest,
      result.approvalGrantId, result.terminalStatus, JSON.stringify(result),
      claimedAtMs + 1,
    );
    applyEffectResultSemanticV2(environment.database);

    const restarted = environment.runtime();
    assert.equal(restarted.getPending(prepared.effectId).effectId, prepared.effectId);
    assert.equal(
      new EffectAuthorityRepository(environment.database)
        .getEffectResultQuarantine(prepared.effectId)?.reasonCode,
      'LEGACY_RESULT_V2_SEMANTIC_MISMATCH',
    );
  });
});

await testAsync('same operation retry is exact while changed bytes conflict under the same identity', async () => {
  await withEnvironment(async environment => {
    const runtime = environment.runtime();
    const input = requestInput(environment.projectRoot, { operationId: 'message:103' });
    const first = await runtime.requestFilesystemWrite(input);
    const retry = await runtime.requestFilesystemWrite({
      ...input,
      sessionId: 'session-after-reconnect',
    });

    assert.equal(retry.effectId, first.effectId);
    assert.equal(
      environment.database.prepare('SELECT count(*) AS count FROM m2_effect_requests').get().count,
      1,
    );
    assert.equal(runtime.getPending(first.effectId).sessionId, input.sessionId);
    await assert.rejects(
      runtime.requestFilesystemWrite({ ...input, content: 'different bytes\n' }),
      error => error?.code === 'EFFECT_REQUEST_CONFLICT',
    );
    assert.equal(
      environment.database.prepare('SELECT count(*) AS count FROM m2_pending_effect_payloads').get().count,
      1,
    );
  });
});

await testAsync('result commit followed by pending cleanup failure remains reachable and self-heals', async () => {
  await withEnvironment(async environment => {
    const input = requestInput(environment.projectRoot, {
      operationId: 'message:cleanup-window',
      relativePath: 'notes/cleanup-window.md',
      content: 'durable terminal survives cleanup failure\n',
    });
    const runtime = environment.runtime();
    const prepared = await runtime.requestFilesystemWrite(input);
    environment.database.exec(`
      CREATE TRIGGER force_m2_pending_cleanup_failure
      BEFORE DELETE ON m2_pending_effect_payloads
      BEGIN
        SELECT RAISE(ABORT, 'forced pending cleanup failure');
      END;
    `);

    const result = await runtime.approveFilesystemWrite({
      effectId: prepared.effectId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });
    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(runtime.getPending(prepared.effectId)?.effectId, prepared.effectId);
    assert.deepEqual(
      JSON.parse(environment.database.prepare(
        'SELECT result_json FROM m2_effect_results WHERE effect_id = ?',
      ).get(prepared.effectId).result_json),
      result,
    );

    environment.database.exec('DROP TRIGGER force_m2_pending_cleanup_failure');
    const sameRuntimeRetry = await runtime.approveFilesystemWrite({
      effectId: prepared.effectId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });
    assert.deepEqual(sameRuntimeRetry, result);
    assert.equal(runtime.getPending(prepared.effectId), null);

    environment.reopen();
    const restarted = environment.runtime();
    assert.equal(restarted.getPending(prepared.effectId), null);
    const reconnectRetry = await restarted.approveFilesystemWrite({
      effectId: prepared.effectId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });
    assert.deepEqual(reconnectRetry, result);
  });
});

await testAsync('restart turns a consumed grant without committed result into a durable non-replayed orphan', async () => {
  await withEnvironment(async environment => {
    const oldOwner = Object.freeze({
      ownerId: 'owner:old-process',
      pid: 4101,
      bootId: '11111111-1111-4111-8111-111111111111',
      startIdentity: '4101001',
    });
    const newOwner = Object.freeze({
      ownerId: 'owner:new-process',
      pid: 4102,
      bootId: '22222222-2222-4222-8222-222222222222',
      startIdentity: '4102001',
    });
    const input = requestInput(environment.projectRoot, {
      operationId: 'message:104',
      relativePath: 'notes/result-commit-failure.md',
      content: 'effect may have completed\n',
    });
    const runtime = environment.runtime({
      executionOwner: oldOwner,
      executionLiveness: { isProvablyDead: () => false },
    });
    const prepared = await runtime.requestFilesystemWrite(input);
    environment.database.exec(`
      CREATE TRIGGER force_m2_result_commit_failure
      BEFORE INSERT ON m2_effect_results
      BEGIN
        SELECT RAISE(ABORT, 'forced result commit failure');
      END;
    `);

    await assert.rejects(
      runtime.approveFilesystemWrite({
        effectId: prepared.effectId,
        conversationId: input.conversationId,
        subjectId: input.subjectId,
      }),
      error => error?.code === 'EFFECT_RESULT_UNCOMMITTED',
    );
    assert.equal(
      readFileSync(path.join(environment.projectRoot, input.relativePath), 'utf8'),
      input.content,
    );
    assert.equal(runtime.getPending(prepared.effectId)?.effectId, prepared.effectId);
    assert.equal(
      environment.database.prepare(`
        SELECT consumed_at_ms IS NOT NULL AS consumed
        FROM m2_approval_grants WHERE effect_id = ?
      `).get(prepared.effectId).consumed,
      1,
    );
    assert.equal(
      environment.database.prepare(
        'SELECT count(*) AS count FROM m2_effect_results WHERE effect_id = ?',
      ).get(prepared.effectId).count,
      0,
    );

    environment.database.exec('DROP TRIGGER force_m2_result_commit_failure');
    const concurrentRuntime = environment.runtime({
      executionOwner: newOwner,
      executionLiveness: { isProvablyDead: () => false },
    });
    assert.equal(
      environment.database.prepare(
        'SELECT count(*) AS count FROM m2_effect_results WHERE effect_id = ?',
      ).get(prepared.effectId).count,
      0,
      'a second live runtime must not turn IN_DOUBT into orphan',
    );
    assert.equal(concurrentRuntime.getPending(prepared.effectId)?.effectId, prepared.effectId);
    await assert.rejects(
      concurrentRuntime.approveFilesystemWrite({
        effectId: prepared.effectId,
        conversationId: input.conversationId,
        subjectId: input.subjectId,
      }),
      error => error?.code === 'EFFECT_EXECUTION_IN_DOUBT',
    );

    environment.reopen();
    const restarted = environment.runtime({
      executionOwner: newOwner,
      executionLiveness: {
        isProvablyDead: claim => claim.ownerId === oldOwner.ownerId,
      },
    });
    const stored = JSON.parse(environment.database.prepare(
      'SELECT result_json FROM m2_effect_results WHERE effect_id = ?',
    ).get(prepared.effectId).result_json);

    assert.equal(stored.terminalStatus, 'orphaned');
    assert.equal(stored.errorCode, 'EFFECT_RECOVERY_ORPHANED');
    assert.equal(stored.rollback.required, true);
    assert.equal(stored.rollback.status, 'pending');
    assert.equal(stored.lateCompletionRejected, true);
    assert.deepEqual(stored.changes.paths, [input.relativePath]);
    assert.equal(restarted.getPending(prepared.effectId), null);
    const secondRestart = environment.runtime({
      executionOwner: newOwner,
      executionLiveness: {
        isProvablyDead: claim => claim.ownerId === oldOwner.ownerId,
      },
    });
    assert.equal(secondRestart.recoverInterruptedFilesystemEffects().length, 0);
    assert.equal(
      environment.database.prepare(
        'SELECT count(*) AS count FROM m2_effect_results WHERE effect_id = ?',
      ).get(prepared.effectId).count,
      1,
      'competing restart recovery must converge on one immutable terminal',
    );
    assert.equal(
      readFileSync(path.join(environment.projectRoot, input.relativePath), 'utf8'),
      input.content,
      'restart recovery must never replay or rewrite the effect',
    );
  });
});

await testAsync('production defaults bind the registered ProjectContext revision through reconnect approval', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-effect-production-defaults-'));
  const projectRoot = path.join(directory, 'project');
  mkdirSync(path.join(projectRoot, 'notes'), { recursive: true });
  const projectName = `m2-effect-defaults-${path.basename(directory)}`;
  const projectId = Number(
    projects.create.run(projectName, projectRoot, 'M2 effect integration fixture').lastInsertRowid,
  );
  const input = requestInput(projectRoot, {
    sessionId: 'studio-session-before-reconnect',
    conversationId: `conversation-production-${projectId}`,
    operationId: `message:production-${projectId}`,
    projectId,
    relativePath: 'notes/production-defaults.md',
    content: 'production provider bytes\n',
  });

  try {
    const firstRuntime = createEffectFileRuntime();
    const prepared = await firstRuntime.requestFilesystemWrite(input);
    const storedRequest = applicationDatabase.prepare(
      'SELECT workspace_revision AS workspaceRevision FROM m2_effect_requests WHERE effect_id = ?',
    ).get(prepared.effectId);
    assert.match(storedRequest.workspaceRevision, /^wsr1:[0-9a-f]{64}$/);
    assert.equal(firstRuntime.getPending(prepared.effectId).sessionId, input.sessionId);

    const reconnectedRuntime = createEffectFileRuntime();
    const result = await reconnectedRuntime.approveFilesystemWrite({
      effectId: prepared.effectId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });

    assert.equal(result.terminalStatus, 'succeeded');
    assert.equal(
      readFileSync(path.join(projectRoot, input.relativePath), 'utf8'),
      input.content,
    );
    assert.equal(reconnectedRuntime.getPending(prepared.effectId), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

summary();
