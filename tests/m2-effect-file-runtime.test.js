import { isolatedTestRuntime } from './helpers/isolated-test-db.js';

import { pruneAllData, DEFAULT_STORAGE_CONFIG } from '../src/db/data-retention.js';
import { computeM2ToolValueDigest, canonicalizeM2ToolValue } from '../contracts/m2/tool-v1.js';
import { up as applyFileReadOutputs } from '../src/db/migrations/2026_09_09_109_m2_file_read_outputs.js';
import { M2ToolAuthorityRepository } from '../src/tools/m2-tool-authority-repository.js';
import { createM2ToolBroker } from '../src/tools/m2-tool-broker.js';
import { createM2ToolEffectAdapter } from '../src/tools/m2-tool-effect-adapter.js';
import { getM2ToolDescriptor, getCurrentM2ToolDescriptor } from '../src/tools/m2-tool-registry.js';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { up as applyEffectAuthorityMigration } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectAuthorityHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectExecutionClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyToolAuthority } from '../src/db/migrations/2026_08_24_074_m2_tool_authority.js';
import { up as applyToolEffectLinks } from '../src/db/migrations/2026_08_24_075_m2_tool_effect_links.js';
import { up as applyToolTruth } from '../src/db/migrations/2026_08_24_076_m2_tool_authority_truth.js';
import { up as applyEffectInvalidations } from '../src/db/migrations/2026_08_24_077_m2_effect_invalidations.js';
import { up as applyExecutionAuthority } from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { up as applyEffectSemanticAuthority } from '../src/db/migrations/2026_08_24_080_m2_effect_semantic_authority.js';
import { up as applyEffectResultSemanticV2 } from '../src/db/migrations/2026_08_24_093_m2_effect_result_semantic_authority_v2.js';
import { up as applyPreexecutionApprovalTerminals } from '../src/db/migrations/2026_08_25_094_m2_preexecution_approval_terminals.js';
import { up as applyEffectRollbackReceipts } from '../src/db/migrations/2026_08_25_095_m2_effect_rollback_receipts.js';
import { createEffectFileRuntime } from '../src/effects/effect-file-runtime.js';
import { EffectAuthorityRepository } from '../src/effects/effect-authority-repository.js';
import { createApprovalGrantIssuer } from '../src/effects/approval-grant-issuer.js';
import { processExecutionOwner } from '../src/effects/execution-owner.js';
import { computeEffectRequestDigest } from '../contracts/m2/effect-v1.js';
import { db as applicationDatabase, projects } from '../src/db/database.js';
import { suite, testAsync, summary } from './harness.js';

void isolatedTestRuntime;

function installAuthoritySchema(database) {
  database.exec("CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY, path TEXT, status TEXT, updated_at TEXT); CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, state TEXT, deleted_at TEXT); CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE, content TEXT);");
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
    applyExecutionAuthority(database);
    applyEffectSemanticAuthority(database);
    applyEffectResultSemanticV2(database);
  }
  applyPreexecutionApprovalTerminals(database);
  applyEffectRollbackReceipts(database);
  applyFileReadOutputs(database);
}

const authorityTemplatePath = path.join(
  tmpdir(),
  'm2-effect-file-runtime-authority-template.sqlite',
);
{
  const template = new Database(authorityTemplatePath);
  template.pragma('foreign_keys = ON');
  installAuthoritySchema(template);
  template.close();
}

function openDatabase(filename) {
  if (!existsSync(filename)) copyFileSync(authorityTemplatePath, filename);
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  return database;
}

async function withEnvironment(callback) {
  const directory = mkdtempSync(path.join(tmpdir(), 'intentsmith-effect-runtime-'));
  const projectRoot = path.join(directory, 'project');
  const databasePath = path.join(directory, 'authority.sqlite');
  mkdirSync(path.join(projectRoot, 'notes'), { recursive: true });
  let database = openDatabase(databasePath);
  database.prepare("INSERT INTO projects(id,path,status) VALUES(17,?,'active')").run(projectRoot);
  database.prepare("INSERT INTO conversations(id,project_id,state) VALUES('conversation-1',17,'active')").run();
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

await testAsync('startup terminalizes an expired unconsumed grant without starting or writing', async () => {
  await withEnvironment(async environment => {
    let now = 1_777_000_000_000;
    const input = requestInput(environment.projectRoot, {
      operationId: 'message:expired-approval',
      relativePath: 'notes/expired-approval.md',
      content: 'must never be written\n',
    });
    const runtime = environment.runtime({ clock: () => now });
    const prepared = await runtime.requestFilesystemWrite(input);
    const repository = new EffectAuthorityRepository(environment.database, { clock: () => now });
    const grant = createApprovalGrantIssuer(repository, {
      clock: () => now,
      defaultTtlMs: 10,
    }).issue({
      effectId: prepared.effectId,
      authenticatedSubject: { actorType: 'user', actorId: input.subjectId },
    }).grant;

    now += 10;
    environment.reopen();
    const restarted = environment.runtime({ clock: () => now });
    const stored = new EffectAuthorityRepository(environment.database, { clock: () => now });
    const terminal = stored.getEffectResult(prepared.effectId);

    assert.equal(terminal.terminalStatus, 'cancelled');
    assert.equal(terminal.errorCode, 'APPROVAL_GRANT_EXPIRED');
    assert.equal(terminal.rollback.required, false);
    assert.equal(terminal.lateCompletionRejected, false);
    assert.equal(stored.getApprovalGrant(grant.grantId).consumedAt, null);
    assert.equal(stored.getExecutionClaim(prepared.effectId), null);
    assert.equal(
      stored.getPreexecutionTerminalClaim(prepared.effectId).reasonCode,
      'APPROVAL_GRANT_EXPIRED',
    );
    assert.equal(restarted.getPending(prepared.effectId), null);
    assert.throws(
      () => readFileSync(path.join(environment.projectRoot, input.relativePath)),
      /ENOENT/,
    );
    const reconnect = await restarted.approveFilesystemWrite({
      effectId: prepared.effectId,
      conversationId: input.conversationId,
      subjectId: input.subjectId,
    });
    assert.deepEqual(reconnect, terminal);
  });
});

await testAsync('revocation mints one cancelled terminal and never consumes the grant', async () => {
  await withEnvironment(async environment => {
    const now = 1_777_000_100_000;
    const input = requestInput(environment.projectRoot, {
      operationId: 'message:revoked-approval',
      relativePath: 'notes/revoked-approval.md',
      content: 'must never be written either\n',
    });
    const runtime = environment.runtime({ clock: () => now });
    const prepared = await runtime.requestFilesystemWrite(input);
    const repository = new EffectAuthorityRepository(environment.database, { clock: () => now });
    const grant = createApprovalGrantIssuer(repository, { clock: () => now }).issue({
      effectId: prepared.effectId,
      authenticatedSubject: { actorType: 'user', actorId: input.subjectId },
    }).grant;
    const revoked = repository.revokeApprovalGrant({
      grantId: grant.grantId,
      reason: 'operator_cancelled',
    });

    assert.equal(revoked.revoked, true);
    const terminal = repository.getEffectResult(prepared.effectId);
    assert.equal(terminal.terminalStatus, 'cancelled');
    assert.equal(terminal.errorCode, 'APPROVAL_GRANT_REVOKED');
    assert.equal(repository.getApprovalGrant(grant.grantId).consumedAt, null);
    assert.equal(repository.getExecutionClaim(prepared.effectId), null);
    assert.equal(runtime.getPending(prepared.effectId), null);
    assert.throws(
      () => readFileSync(path.join(environment.projectRoot, input.relativePath)),
      /ENOENT/,
    );
    const replay = repository.revokeApprovalGrant({
      grantId: grant.grantId,
      reason: 'operator_cancelled',
    });
    assert.equal(replay.revoked, false);
    assert.deepEqual(repository.getEffectResult(prepared.effectId), terminal);
    assert.equal(
      environment.database.prepare(`
        SELECT count(*) AS count FROM m2_effect_results WHERE effect_id = ?
      `).get(prepared.effectId).count,
      1,
    );
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
    // Simulate a v1-accepted row already present when 081 was installed. The
    // current test database is already at 082, so seed the historical bytes
    // through the frozen non-semantic triggers and then add the exact 081
    // quarantine evidence explicitly.
    environment.database.exec('DROP TRIGGER trg_m2_effect_results_semantic_authority');
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
    environment.database.exec(`
      CREATE TRIGGER trg_m2_effect_results_semantic_authority
      BEFORE INSERT ON m2_effect_results
      WHEN NOT EXISTS (
        SELECT 1 FROM m2_effect_requests request
        WHERE request.effect_id = NEW.effect_id
          AND m2_effect_result_matches_request_v2(
            request.request_json,
            NEW.result_json
          ) = 1
      )
      BEGIN
        SELECT RAISE(ABORT, 'M2_EFFECT_RESULT_SEMANTIC_AUTHORITY_MISMATCH');
      END;
    `);
    const stored = environment.database.prepare(`
      SELECT request_digest AS requestDigest,
             m2_effect_result_json_digest_v1(result_json) AS resultDigest
      FROM m2_effect_results WHERE effect_id = ?
    `).get(prepared.effectId);
    environment.database.prepare(`
      INSERT INTO m2_effect_result_semantic_quarantine (
        effect_id, request_digest, result_digest, reason_code,
        rejected_by_validator, source_migration
      ) VALUES (?, ?, ?, 'LEGACY_RESULT_V2_SEMANTIC_MISMATCH', 2,
        '2026_08_24_081_m2_effect_result_semantic_authority_v2')
    `).run(prepared.effectId, stored.requestDigest, stored.resultDigest);

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
    const settlement = restarted.getEffectSettlement(prepared.effectId);
    assert.equal(settlement.rollbackReceipt.observationCode, 'matches_forward');
    assert.equal(settlement.rollbackDebt.required, false);
    assert.equal(settlement.rollbackDebt.status, 'settled_by_observation');
    assert.equal(restarted.getLastRollbackReconciliation().recorded.length, 1);
    assert.equal(restarted.getPending(prepared.effectId), null);
    const secondRestart = environment.runtime({
      executionOwner: newOwner,
      executionLiveness: {
        isProvablyDead: claim => claim.ownerId === oldOwner.ownerId,
      },
    });
    assert.equal(secondRestart.recoverInterruptedFilesystemEffects().length, 0);
    assert.equal(secondRestart.getLastRollbackReconciliation().recorded.length, 0);
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

await testAsync('rollback receipts settle exact before images, retain foreign debt and never write', async () => {
  await withEnvironment(async environment => {
    const preparationRuntime = environment.runtime();
    const seedPendingRollback = async ({ operationId, relativePath, before, after }) => {
      const target = path.join(environment.projectRoot, relativePath);
      writeFileSync(target, before);
      const prepared = await preparationRuntime.requestFilesystemWrite(requestInput(environment.projectRoot, {
        operationId,
        relativePath,
        content: after,
      }));
      const repository = new EffectAuthorityRepository(environment.database);
      const grant = createApprovalGrantIssuer(repository).issue({
        effectId: prepared.effectId,
        authenticatedSubject: { actorType: 'user', actorId: 'local-operator' },
      }).grant;
      const request = repository.getEffectRequest(prepared.effectId);
      repository.consumeApprovalGrant({
        grantId: grant.grantId,
        request,
        executionOwner: processExecutionOwner,
      });
      const claimedAtMs = repository.getExecutionClaim(prepared.effectId).claimedAtMs;
      const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
      repository.recordEffectResult({
        contract: 'EffectResult', version: 1,
        effectId: request.effectId, runId: request.runId,
        projectId: request.origin.projectId,
        requestDigest: computeEffectRequestDigest(request),
        approvalGrantId: grant.grantId, terminalStatus: 'orphaned',
        startedAt: new Date(claimedAtMs).toISOString(),
        completedAt: new Date(claimedAtMs).toISOString(),
        process: { pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null },
        changes: {
          paths: [relativePath], beforeDigest: digest(before),
          afterDigest: request.payloadDigest, diffArtifact: null,
        },
        network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
        rollback: {
          required: true, status: 'pending',
          evidenceRef: `effect:${request.effectId}:rollback-pending`,
        },
        outputDigest: request.payloadDigest,
        errorCode: 'EFFECT_FS_WRITE_VERIFICATION_FAILED',
        evidenceRefs: [`effect:${request.effectId}:fs-write-post-commit-verification-failed`],
        lateCompletionRejected: true,
      });
      return { effectId: prepared.effectId, target };
    };

    const beforeCase = await seedPendingRollback({
      operationId: 'message:receipt-before',
      relativePath: 'notes/receipt-before.md',
      before: 'before image\n',
      after: 'authorized forward image\n',
    });
    const foreignCase = await seedPendingRollback({
      operationId: 'message:receipt-foreign',
      relativePath: 'notes/receipt-foreign.md',
      before: 'original image\n',
      after: 'authorized image\n',
    });
    writeFileSync(foreignCase.target, 'unrelated foreign drift\n');
    const unknownInput = requestInput(environment.projectRoot, {
      operationId: 'message:receipt-unknown-before',
      relativePath: 'notes/receipt-unknown-before.md',
      content: 'possibly applied bytes\n',
    });
    const unknownPrepared = await preparationRuntime.requestFilesystemWrite(unknownInput);
    const unknownRepository = new EffectAuthorityRepository(environment.database);
    const unknownGrant = createApprovalGrantIssuer(unknownRepository).issue({
      effectId: unknownPrepared.effectId,
      authenticatedSubject: { actorType: 'user', actorId: unknownInput.subjectId },
    }).grant;
    const unknownRequest = unknownRepository.getEffectRequest(unknownPrepared.effectId);
    unknownRepository.consumeApprovalGrant({
      grantId: unknownGrant.grantId,
      request: unknownRequest,
      executionOwner: processExecutionOwner,
    });
    const unknownClaimedAt = unknownRepository
      .getExecutionClaim(unknownPrepared.effectId).claimedAtMs;
    unknownRepository.recordEffectResult({
      contract: 'EffectResult', version: 1,
      effectId: unknownRequest.effectId, runId: unknownRequest.runId,
      projectId: unknownRequest.origin.projectId,
      requestDigest: computeEffectRequestDigest(unknownRequest),
      approvalGrantId: unknownGrant.grantId, terminalStatus: 'orphaned',
      startedAt: new Date(unknownClaimedAt).toISOString(),
      completedAt: new Date(unknownClaimedAt).toISOString(),
      process: { pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null },
      changes: {
        paths: [unknownInput.relativePath], beforeDigest: null,
        afterDigest: null, diffArtifact: null,
      },
      network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
      rollback: {
        required: true, status: 'pending',
        evidenceRef: `effect:${unknownRequest.effectId}:rollback-pending`,
      },
      outputDigest: null,
      errorCode: 'EFFECT_RECOVERY_ORPHANED',
      evidenceRefs: [`effect:${unknownRequest.effectId}:restart-recovery`],
      lateCompletionRejected: true,
    });
    const beforeBytes = readFileSync(beforeCase.target);
    const foreignBytes = readFileSync(foreignCase.target);

    environment.reopen();
    const restarted = environment.runtime();
    const beforeSettlement = restarted.getEffectSettlement(beforeCase.effectId);
    const foreignSettlement = restarted.getEffectSettlement(foreignCase.effectId);
    const unknownSettlement = restarted.getEffectSettlement(unknownPrepared.effectId);

    assert.equal(beforeSettlement.rollbackReceipt.observationCode, 'matches_before');
    assert.equal(beforeSettlement.rollbackDebt.required, false);
    assert.equal(beforeSettlement.rollbackDebt.status, 'settled_by_observation');
    assert.equal(foreignSettlement.rollbackReceipt.observationCode, 'foreign');
    assert.equal(foreignSettlement.rollbackDebt.required, true);
    assert.equal(foreignSettlement.rollbackDebt.status, 'foreign');
    assert.equal(unknownSettlement.rollbackReceipt.observationCode, 'foreign');
    assert.equal(unknownSettlement.rollbackDebt.required, true);
    assert.equal(unknownSettlement.rollbackDebt.status, 'foreign');
    assert.deepEqual(readFileSync(beforeCase.target), beforeBytes);
    assert.deepEqual(readFileSync(foreignCase.target), foreignBytes);
    assert.equal(restarted.getLastRollbackReconciliation().recorded.length, 3);
    assert.throws(
      () => environment.database.prepare(`
        UPDATE m2_effect_rollback_receipts SET observation_code = 'foreign'
        WHERE effect_id = ?
      `).run(beforeCase.effectId),
      /append-only/,
    );
    assert.throws(
      () => environment.database.prepare(
        'DELETE FROM m2_effect_rollback_receipts WHERE effect_id = ?',
      ).run(beforeCase.effectId),
      /append-only/,
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


function insertToolResultDirect(db, value) {
  const claim = db.prepare(`
    SELECT * FROM tool_v1_execution_claims
    WHERE request_id = ? ORDER BY generation DESC LIMIT 1
  `).get(value.requestId);
  db.prepare(`
    INSERT INTO tool_v1_results (
      request_id, request_digest, run_id, project_id, tool_id, tool_version,
      status, output_schema, output_json, output_digest, effect_request_id,
      error_json, started_at_ms, completed_at_ms, evidence_json,
      late_completion_rejected, execution_generation, execution_owner_id,
      result_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.requestId,
    value.requestDigest,
    value.runId,
    value.projectId,
    value.toolId,
    value.toolVersion,
    value.status,
    value.outputSchema,
    value.output === null ? null : canonicalizeM2ToolValue(value.output),
    value.outputDigest,
    value.effectRequestId,
    value.error === null ? null : canonicalizeM2ToolValue(value.error),
    Date.parse(value.startedAt),
    Date.parse(value.completedAt),
    canonicalizeM2ToolValue(value.evidenceRefs),
    value.lateCompletionRejected ? 1 : 0,
    claim.generation,
    claim.owner_id,
    canonicalizeM2ToolValue(value),
  );
}

suite('file.read@2 durable runtime and content authority');

await testAsync('actual tool read requires exact approval then resolves stored bytes with actor/project/conversation binding', async () => {
  await withEnvironment(async environment => {
    const bytes = Buffer.from('private-canary: e\u0301\n');
    writeFileSync(path.join(environment.projectRoot, 'notes/result.md'), bytes);
    const runtime = environment.runtime();
    const repository = new M2ToolAuthorityRepository(environment.database);
    const broker = createM2ToolBroker({ repository, effectAdapter: createM2ToolEffectAdapter({ effectRuntime: runtime }) });
    const context = { sessionId: 'ws-1', conversationId: 'conversation-1', userMessageId: 10,
      authenticatedSubject: { actorType: 'user', actorId: 'local-operator' },
      project: { id: 17, path: environment.projectRoot } };
    const input = { toolId: 'file.read', input: { path: 'notes/result.md' }, context };
    const pending = await broker.execute(input);
    assert.equal(pending.state, 'approval_required');
    assert.equal(pending.request.toolVersion, 2);
    assert.equal(environment.database.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
    await assert.rejects(async () => runtime.approveFilesystemWrite({ effectId: pending.effectRequestId, conversationId: context.conversationId, subjectId: 'local-operator' }), { code: 'EFFECT_RUNTIME_INPUT_INVALID' });
    const effect = await runtime.approveFilesystemEffect({ effectId: pending.effectRequestId, conversationId: context.conversationId, subjectId: 'local-operator' });
    assert.equal(effect.terminalStatus, 'succeeded');
    const record = repository.recordToolResult.bind(repository);
    let checkedSql = false;
    repository.recordToolResult = (result, options) => {
      for (const output of [
        { ...result.output, contentDigest: 'sha256:' + '0'.repeat(64) },
        { ...result.output, path: 'notes/other.md' },
        { ...result.output, byteLength: result.output.byteLength + 1 },
      ]) {
        const forged = { ...result, output, outputDigest: computeM2ToolValueDigest(output) };
        assert.throws(() => insertToolResultDirect(environment.database, forged), /M2_TOOL_LINKED_TERMINAL_PROJECTION_MISMATCH/);
        assert.throws(() => record(forged, options), /does not exactly project/);
      }
      checkedSql = true;
      return record(result, options);
    };
    const settled = broker.settleEffect({ effectId: effect.effectId, context });
    assert.equal(checkedSql, true);
    assert.equal(settled.result.status, 'ok');
    assert.equal(settled.result.output.byteLength, bytes.length);
    const query = { requestId: settled.request.requestId, contentRef: settled.result.output.contentRef, context };
    const content = broker.resolveFileReadContent(query);
    assert.deepEqual(content.bytes, bytes);
    assert.equal(JSON.stringify(settled.result).includes('private-canary'), false);
    assert.equal(content.output.contentDigest, effect.outputDigest);
    assert.notEqual(settled.result.outputDigest, effect.outputDigest);
    for (const changed of [
      { ...context, authenticatedSubject: { actorType: 'user', actorId: 'other' } },
      { ...context, conversationId: 'other' }, { ...context, project: { id: 18 } },
      { ...context, project: undefined, projectId: null },
    ]) assert.throws(() => broker.resolveFileReadContent({ ...query, context: changed }));
    assert.throws(() => broker.resolveFileReadContent({ ...query, contentRef: query.contentRef + ':other' }));
    rmSync(path.join(environment.projectRoot, 'notes/result.md'));
    const replay = await broker.execute({ ...input, context: { ...context, sessionId: 'reconnected' } });
    assert.deepEqual(replay.result, settled.result);
    assert.deepEqual(broker.resolveFileReadContent(query).bytes, bytes);
    assert.equal(environment.database.prepare('SELECT count(*) AS n FROM m2_approval_grants').get().n, 1);
    assert.equal(environment.database.prepare('SELECT count(*) AS n FROM m2_effect_execution_claims').get().n, 1);
  });
});

await testAsync('read@1 request replay retains its original version and identity without a second operation', async () => {
  await withEnvironment(async environment => {
    const repository = new M2ToolAuthorityRepository(environment.database);
    const legacy = createM2ToolBroker({ repository, descriptorResolver: getM2ToolDescriptor });
    const context = { sessionId: 'ws-1', conversationId: 'conversation-1', userMessageId: 10,
      authenticatedSubject: { actorType: 'user', actorId: 'local-operator' },
      project: { id: 17, path: environment.projectRoot } };
    const input = { toolId: 'file.read', input: { path: 'notes/result.md' }, context };
    const original = legacy.createRequest(input);
    const current = createM2ToolBroker({ repository });
    assert.equal(original.toolVersion, 1);
    assert.equal(original.effectBinding.payloadBytes, 0);
    assert.deepEqual(current.createRequest(input), original);
    assert.throws(() => current.createRequest({ ...input, context: { ...context, project: { id: 18 } } }));
    assert.throws(() => current.createRequest({ ...input, timeoutMs: 40_000 }));
    assert.equal(current.createRequest({ ...input, context: { ...context, userMessageId: 11 } }).toolVersion, 2);
    assert.equal(environment.database.prepare('SELECT count(*) AS n FROM tool_v1_requests').get().n, 2);
    assert.equal(getM2ToolDescriptor('file.list').authorityMode, 'unavailable');
    assert.equal(getCurrentM2ToolDescriptor('file.list').authorityMode, 'unavailable');
    assert.equal(getM2ToolDescriptor('file.read', 3), null);
  });
});

await testAsync('dead read execution is recovered without rollback or output and cannot be re-executed', async () => {
  await withEnvironment(async environment => {
    const runtime = environment.runtime();
    const prepared = await runtime.requestFilesystemRead(requestInput(environment.projectRoot));
    const repository = new EffectAuthorityRepository(environment.database);
    const issuer = createApprovalGrantIssuer(repository);
    const grant = issuer.issue({ effectId: prepared.effectId, authenticatedSubject: { actorType: 'user', actorId: 'local-operator' } }).grant;
    repository.consumeApprovalGrant({ grantId: grant.grantId, request: { ...prepared.request, approvalGrantId: grant.grantId }, executionOwner: processExecutionOwner });
    const recovered = environment.runtime({ executionLiveness: { isProvablyDead() { return true; } } });
    const result = await recovered.approveFilesystemRead({ effectId: prepared.effectId, conversationId: 'conversation-1', subjectId: 'local-operator' });
    assert.equal(result.terminalStatus, 'orphaned');
    assert.equal(result.outputDigest, null);
    assert.equal(result.rollback.required, false);
    assert.equal(result.lateCompletionRejected, false);
    assert.deepEqual(result.changes.paths, []);
    assert.equal(environment.database.prepare('SELECT count(*) AS n FROM m2_file_read_outputs').get().n, 0);
    assert.equal(recovered.getPending(prepared.effectId), null);
  });
});


async function withCompletedRead(callback) {
  await withEnvironment(async environment => {
    const bytes = Buffer.from('private-delete-canary');
    writeFileSync(path.join(environment.projectRoot, 'notes/result.md'), bytes);
    const runtime = environment.runtime();
    const repository = new M2ToolAuthorityRepository(environment.database);
    const broker = createM2ToolBroker({ repository, effectAdapter: createM2ToolEffectAdapter({ effectRuntime: runtime }) });
    const context = { sessionId: 'ws-1', conversationId: 'conversation-1', userMessageId: 10,
      authenticatedSubject: { actorType: 'user', actorId: 'local-operator' },
      project: { id: 17, path: environment.projectRoot } };
    const pending = await broker.execute({ toolId: 'file.read', input: { path: 'notes/result.md' }, context });
    const effect = await runtime.approveFilesystemEffect({ effectId: pending.effectRequestId, conversationId: context.conversationId, subjectId: 'local-operator' });
    const settled = broker.settleEffect({ effectId: effect.effectId, context });
    assert.equal(settled.result.status, 'ok');
    const query = { requestId: settled.request.requestId, contentRef: settled.result.output.contentRef, context };
    await callback({ ...environment, database: environment.database, bytes, repository, broker, query, effect, settled });
  });
}

await testAsync('soft delete and reassignment deny current content without destroying restorable history', async () => {
  await withCompletedRead(({ database, broker, query, bytes }) => {
    const resolve = () => broker.resolveFileReadContent(query);
    const deny = () => assert.throws(resolve, { code: 'EFFECT_FILE_READ_CONTENT_UNAVAILABLE' });
    database.exec("UPDATE conversations SET state='deleted' WHERE id='conversation-1'");
    deny();
    assert.deepEqual(database.prepare('SELECT payload FROM m2_file_read_outputs').get().payload, bytes);
    database.exec("UPDATE conversations SET state='active' WHERE id='conversation-1'");
    assert.deepEqual(resolve().bytes, bytes);
    database.exec("UPDATE projects SET status='deleted' WHERE id=17");
    deny();
    database.exec("UPDATE projects SET status='active' WHERE id=17");
    assert.deepEqual(resolve().bytes, bytes);
    database.exec("INSERT INTO projects(id,path,status) VALUES(18,'/other','active'); UPDATE conversations SET project_id=18 WHERE id='conversation-1'");
    deny();
    assert.equal(database.prepare('SELECT count(*) AS n FROM m2_file_read_output_tombstones').get().n, 0);
    database.exec("UPDATE conversations SET project_id=17 WHERE id='conversation-1'; UPDATE projects SET path='/moved' WHERE id=17");
    deny();
    database.prepare('UPDATE projects SET path=? WHERE id=17').run(query.context.project.path);
    assert.deepEqual(resolve().bytes, bytes);
  });
});

await testAsync('hard conversation deletion atomically purges bytes while historical success remains valid', async () => {
  await withCompletedRead(({ database, broker, query, bytes, repository, settled, effect }) => {
    database.prepare('INSERT INTO messages(id,conversation_id,content) VALUES(1,?,?)').run('conversation-1', bytes.toString('utf8'));
    database.exec("UPDATE conversations SET state='deleted' WHERE id='conversation-1'");
    const remove = () => {
      database.prepare('DELETE FROM messages WHERE conversation_id=?').run('conversation-1');
      database.prepare('DELETE FROM conversations WHERE id=?').run('conversation-1');
    };
    assert.throws(database.transaction(() => { remove(); throw new Error('rollback-delete'); }), /rollback-delete/);
    assert.deepEqual(database.prepare('SELECT payload FROM m2_file_read_outputs').get().payload, bytes);
    assert.equal(database.prepare('SELECT count(*) AS n FROM messages').get().n, 1);
    database.transaction(remove)();
    assert.equal(database.prepare('SELECT payload FROM m2_file_read_outputs').get().payload, null);
    assert.equal(database.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
    assert.equal(database.prepare('SELECT reason FROM m2_file_read_output_tombstones').get().reason, 'CONVERSATION_REMOVED');
    assert.deepEqual(repository.getToolResult(settled.request.requestId), settled.result);
    assert.deepEqual(new EffectAuthorityRepository(database).getEffectResult(effect.effectId), effect);
    assert.throws(() => broker.resolveFileReadContent(query), { code: 'EFFECT_FILE_READ_CONTENT_UNAVAILABLE' });
    database.exec("INSERT INTO conversations(id,project_id,state) VALUES('conversation-1',17,'active')");
    assert.throws(() => broker.resolveFileReadContent(query), { code: 'EFFECT_FILE_READ_CONTENT_UNAVAILABLE' });
    assert.throws(() => database.exec('DELETE FROM m2_file_read_output_tombstones'), /IMMUTABLE/);
  });
});

await testAsync('hard project deletion purges bytes and typed deletion cannot precede actual owner removal', async () => {
  await withCompletedRead(({ database, broker, query, effect, repository, settled }) => {
    assert.throws(() => database.prepare('INSERT INTO m2_file_read_output_tombstones VALUES(?,?,?)').run(effect.effectId, 'PROJECT_REMOVED', 1), /SCOPE_NOT_REMOVED/);
    assert.throws(() => database.exec('UPDATE m2_file_read_outputs SET payload=NULL'), /IMMUTABLE/);
    database.exec("UPDATE projects SET status='deleted' WHERE id=17; DELETE FROM projects WHERE id=17");
    assert.equal(database.prepare('SELECT payload FROM m2_file_read_outputs').get().payload, null);
    assert.equal(database.prepare('SELECT reason FROM m2_file_read_output_tombstones').get().reason, 'PROJECT_REMOVED');
    assert.equal(database.prepare("SELECT project_id FROM conversations WHERE id='conversation-1'").get().project_id, null);
    assert.deepEqual(repository.getToolResult(settled.request.requestId), settled.result);
    assert.throws(() => broker.resolveFileReadContent(query), { code: 'EFFECT_FILE_READ_CONTENT_UNAVAILABLE' });
  });
});

await testAsync('existing retention hard-delete path purges read bytes after the existing grace period', async () => {
  await withCompletedRead(({ database, broker, query, repository, settled }) => {
    database.exec("UPDATE conversations SET state='deleted', deleted_at=datetime('now','-30 days') WHERE id='conversation-1'; INSERT INTO messages(id,conversation_id,content) VALUES(1,'conversation-1','private-delete-canary')");
    const stats = pruneAllData(database, { config: DEFAULT_STORAGE_CONFIG });
    assert.ok(stats.deletedConvIds.includes('conversation-1'));
    assert.equal(database.prepare('SELECT payload FROM m2_file_read_outputs').get().payload, null);
    assert.equal(database.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
    assert.deepEqual(repository.getToolResult(settled.request.requestId), settled.result);
    assert.throws(() => broker.resolveFileReadContent(query), { code: 'EFFECT_FILE_READ_CONTENT_UNAVAILABLE' });
  });
});

summary();
