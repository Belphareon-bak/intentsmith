#!/usr/bin/env node
// Private project acceptance through the production M2 service, real SQLite/Git
// effects, canonical process sandbox, and owned CPU loopback relays. No GPU/model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { providerRelay, createProviderProxy } from '../scripts/run-project-app-journey.js';
import { sqliteRevisionBlueprint, assertSchemaFailure, assertRetainedRevision } from '../scripts/project-app-revision.js';
import { REFERENCE_LEDGER_OUTPUTS, OBJECT_COMMAND_LAST_RESULT_CLI } from './helpers/project-app-reference.js';
import { REFERENCE_TASKFLOW_OUTPUTS, taskflowMutant } from './helpers/project-taskflow-reference.js';
import { REFERENCE_SQLITE_OUTPUTS, sqliteCatalogMutant } from './helpers/project-sqlite-catalog-reference.js';
import { initializeNewProject } from '../src/planner/project-onboarding.js';
import { createDefaultM2LifecycleApplicationService } from '../src/lifecycle/m2-lifecycle-application-service.js';
import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyExecutionAuthority } from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { up as applyLifecycleAuthority } from '../src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js';
import {
  ORACLE_PATH, ORACLE_BINARY, ORACLE_ARGV, ORACLE_SOURCE, ORACLE_SHA256, PROBE_PATH, PROBE_SOURCE, PROBE_SHA256,
  VALIDATE_PATH, VALIDATE_SOURCE, VALIDATE_SHA256, ENTRY_PATH, ENTRY_SOURCE, ENTRY_SHA256,
  sha256, ledgerBlueprint, policyForFrozenOracle,
} from '../scripts/project-app-acceptance.js';
import { TASKFLOW_FILES, TASKFLOW_ORACLE_ARGV, TASKFLOW_ORACLE_SOURCE, TASKFLOW_ORACLE_SHA256,
  TASKFLOW_PROBE_SOURCE, TASKFLOW_PROBE_SHA256, TASKFLOW_VALIDATE_SOURCE, TASKFLOW_VALIDATE_SHA256,
  taskflowBlueprint,
} from '../scripts/project-taskflow-acceptance.js';
import { SQLITE_FILES, SQLITE_ORACLE_ARGV, SQLITE_ORACLE_SOURCE, SQLITE_ORACLE_SHA256,
  SQLITE_ENTRY_SOURCE, SQLITE_ENTRY_SHA256, sqliteCatalogBlueprint, policyForSqliteCatalog, assertSqlitePreview,
} from '../scripts/project-sqlite-catalog-acceptance.js';

const PROJECT_ID = 6021;
const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'ledger-acceptance-operator' });
const ORIGIN = Object.freeze({ surface: 'http', sessionId: 'ledger-offline-session',
  conversationId: 'ledger-offline-conversation', projectId: PROJECT_ID });
const GENERATION_ORDER = ['src/totals.js', 'src/validate.js', 'src/storage.js',
  'src/service.js', 'src/cli.js', 'src/app.js'];
const TASKFLOW_GENERATION_ORDER = ['src/query.js', 'src/validate.js', 'src/store.js',
  'src/cli.js', 'src/app.js'];
const SQLITE_GENERATION_ORDER = ['src/query.js', 'src/schema.js', 'src/store.js',
  'src/validate.js', 'src/service.js', 'src/cli.js', 'src/app.js'];

function git(root, args) {
  return execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', env: {
    PATH: '/usr/bin:/bin', HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
  } }).trim();
}

function databaseAt(file) {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  if (!db.prepare("SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'm2_lifecycle_operations'").get()) {
    db.transaction(() => {
      applyEffectAuthority(db); applyEffectHardening(db); applyEffectClaims(db);
      applyEffectClaimTruth(db); applyExecutionAuthority(db); applyLifecycleAuthority(db);
    })();
  }
  return db;
}

async function fixture(defect, scenarioId = 'ledger') {
  const taskflow = scenarioId === 'taskflow';
  const sqlite = scenarioId === 'sqlite-catalog';
  assert.ok(taskflow || sqlite || scenarioId === 'ledger', 'only fixed scenarios');
  const frozen = sqlite
    ? { oracle: SQLITE_ORACLE_SOURCE, entry: SQLITE_ENTRY_SOURCE, order: SQLITE_GENERATION_ORDER }
    : taskflow
    ? { oracle: TASKFLOW_ORACLE_SOURCE, probe: TASKFLOW_PROBE_SOURCE,
      validate: TASKFLOW_VALIDATE_SOURCE, order: TASKFLOW_GENERATION_ORDER }
    : { oracle: ORACLE_SOURCE, probe: PROBE_SOURCE, validate: VALIDATE_SOURCE,
      order: GENERATION_ORDER };
  const folder = fs.mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'app-m2-'));
  const project = path.join(folder, 'project');
  await initializeNewProject(project, { name: sqlite ? 'SQLite Catalog' : taskflow ? 'TaskFlow' : 'Expense Ledger', type: 'general' });
  const policyPath = path.join(project, '.intentsmith/m2-governance-policy.json');
  const policy = (sqlite ? policyForSqliteCatalog : policyForFrozenOracle)(JSON.parse(fs.readFileSync(policyPath, 'utf8')));
  assert.ok(policy.externalImports.includes('node:child_process'));
  assert.ok(policy.externalImports.includes(sqlite ? 'node:sqlite' : 'node:vm'));
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n');
  const frozenFiles = sqlite
    ? [[ORACLE_PATH, frozen.oracle], [ENTRY_PATH, frozen.entry]]
    : [[ORACLE_PATH, frozen.oracle], [PROBE_PATH, frozen.probe],
      [VALIDATE_PATH, frozen.validate], [ENTRY_PATH, ENTRY_SOURCE]];
  for (const [relative, content] of frozenFiles) fs.writeFileSync(path.join(project, relative), content);
  git(project, ['add', '--', ...frozenFiles.map(([relative]) => relative), '.intentsmith/m2-governance-policy.json']);
  git(project, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
    '-c', 'user.name=IntentSmith Test', '-c', 'user.email=test@example.invalid',
    'commit', '-m', 'freeze operator oracle']);
  const baseline = git(project, ['rev-parse', 'HEAD']);
  const databasePath = path.join(folder, 'authority.sqlite');
  const db = databaseAt(databasePath);
  const outputs = sqlite ? defect ? sqliteCatalogMutant(defect) : { ...REFERENCE_SQLITE_OUTPUTS }
    : taskflow ? defect ? taskflowMutant(defect) : { ...REFERENCE_TASKFLOW_OUTPUTS }
    : { ...REFERENCE_LEDGER_OUTPUTS };
  if (!taskflow && !sqlite && defect === 'object-command-last-result') outputs['src/cli.js'] = OBJECT_COMMAND_LAST_RESULT_CLI;
  if (!taskflow && !sqlite && ['wrong-total', 'assert-noops', 'early-exit'].includes(defect)) {
    outputs['src/totals.js'] = outputs['src/totals.js'].replace('sum + row.amount', 'sum + 1');
  }
  if (!taskflow && !sqlite && defect === 'assert-noops') outputs['src/app.js'] = `import assert from 'node:assert/strict';
for (const key of ['ok', 'equal', 'deepEqual', 'throws']) assert[key] = () => {};
export { run } from './cli.js';
`;
  if (!taskflow && !sqlite && defect === 'early-exit') outputs['src/app.js'] = `console.log('PROJECT_APP_ORACLE_PASS');
process.exit(0);
export { run } from './cli.js';
`;
  if (!taskflow && !sqlite && defect === 'probe-json-forgery') {
    outputs['src/validate.js'] = outputs['src/validate.js'].replace('!Number.isFinite(amount) || ', '');
    outputs['src/app.js'] = `if (process.argv[1].endsWith('subject-probe.mjs')) {
  process.stdout.write(JSON.stringify({ failures: [true, true, true], distinct: true }) + '\\n');
  process.exit(0);
}
export { run } from './cli.js';
`;
  }
  if (!taskflow && !sqlite && ['storage-row-alias', 'storage-json-forgery'].includes(defect)) {
    outputs['src/storage.js'] = outputs['src/storage.js'].replace('rows.map(row => ({ ...row }))', 'rows.slice()');
  }
  if (!taskflow && !sqlite && defect === 'storage-json-forgery') {
    outputs['src/storage.js'] = `if (process.argv[1].endsWith('subject-probe.mjs')) {
  const row = JSON.parse(process.argv[2]);
  process.stdout.write(JSON.stringify({ before: row, after: row }) + '\\n');
  process.exit(0);
}
` + outputs['src/storage.js'];
  }
  const calls = [];
  const service = createDefaultM2LifecycleApplicationService({ database: db,
    projects: { findById: { get: id => id === PROJECT_ID ? { id, path: project, status: 'active' } : null } },
    generateCodeDraft: async ({ prompt }) => {
      const input = JSON.parse(prompt);
      assert.equal(input.contextEncoding, 'indexed-full/v1');
      assert.ok(Number.isSafeInteger(input.path) && input.path >= 0 && input.path < input.paths.length);
      input.path = input.paths[input.path];
      if (input.previousDraft) {
        assert.equal(sqlite && defect === 'schema-extra-import', true, 'only the declared revision fixture');
        assert.equal(calls.length, 7);
        assert.equal(input.path, 'src/schema.js');
        assert.equal(input.previousDraft.content, outputs[input.path]);
        assert.equal(input.previousDraft.state, 'unapplied_proposal');
        assert.equal(input.beforeContent, undefined);
        assert.equal(git(project, ['status', '--porcelain=v1']), '');
        calls.push(input.path);
        return { content: JSON.stringify({ replacements: [
          { before: "import { DatabaseSync } from 'node:sqlite';\n", after: '' },
        ] }), finishReason: 'stop' };
      }
      assert.equal(input.path, frozen.order[calls.length], 'dependency order');
      assert.equal(Object.hasOwn(input, 'focusedTest'), false, 'model cannot choose the oracle');
      assert.equal(fs.readFileSync(path.join(project, ORACLE_PATH), 'utf8'), frozen.oracle);
      assert.equal(git(project, ['status', '--porcelain=v1']), '', 'draft has no disk effect');
      calls.push(input.path);
      return { content: JSON.stringify({ afterContent: outputs[input.path] }), finishReason: 'stop' };
    },
  });
  return { folder, project, db, databasePath, outputs, calls, baseline, service, frozen };
}

test('M2 failed SQLite draft rolls back and revises one module with a new exact approval', async () => {
  const f = await fixture('schema-extra-import', 'sqlite-catalog');
  try {
    await f.service.recoverIncompleteSmallProjectChanges();
    const first = await f.service.draftSmallProjectChange({ authenticatedSubject: SUBJECT,
      projectId: PROJECT_ID, origin: ORIGIN, draft: sqliteCatalogBlueprint() });
    const failed = await f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
      origin: ORIGIN, lifecycleId: first.lifecycleId, planDigest: first.planDigest });
    assertSchemaFailure(failed, SQLITE_FILES.map(file => file.path), first.diff);
    assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
    for (const file of SQLITE_FILES) assert.equal(fs.existsSync(path.join(f.project, file.path)), false);
    const next = await f.service.draftSmallProjectChange({ authenticatedSubject: SUBJECT,
      projectId: PROJECT_ID, origin: ORIGIN, draft: sqliteRevisionBlueprint(first) });
    assertRetainedRevision(first.diff, next.diff);
    assert.notEqual(next.lifecycleId, first.lifecycleId);
    assert.notEqual(next.planDigest, first.planDigest);
    await assert.rejects(f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
      origin: ORIGIN, lifecycleId: next.lifecycleId, planDigest: first.planDigest }),
    { code: 'M2_LIFECYCLE_PLAN_DIGEST_MISMATCH' });
    const committed = await f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
      origin: ORIGIN, lifecycleId: next.lifecycleId, planDigest: next.planDigest });
    assert.equal(committed.state, 'succeeded');
    assert.equal(committed.result.git.status, 'committed');
    assert.deepEqual(f.calls, [...SQLITE_GENERATION_ORDER, 'src/schema.js']);
    for (const file of SQLITE_FILES) assert.equal(fs.readFileSync(path.join(f.project, file.path), 'utf8'),
      REFERENCE_SQLITE_OUTPUTS[file.path]);
    assert.equal(sha256(fs.readFileSync(path.join(f.project, ORACLE_PATH))), SQLITE_ORACLE_SHA256);
    f.db.close();
    const ro = new Database(f.databasePath, { readonly: true, fileMustExist: true });
    try {
      const rows = ro.prepare('SELECT terminal_status AS state FROM m2_lifecycle_terminals ORDER BY rowid').all();
      assert.deepEqual(rows.map(row => row.state), ['failed', 'succeeded']);
    } finally { ro.close(); }
  } finally { if (f.db.open) f.db.close(); }
});

for (const defect of [null, 'wrong-total', 'object-command-last-result', 'assert-noops', 'early-exit',
  'probe-json-forgery', 'storage-row-alias', 'storage-json-forgery']) {
  test(`M2 six-file project ${defect ? `rolls back ${defect}` : 'commits a functioning app'}`, async () => {
    const f = await fixture(defect);
    try {
      await f.service.recoverIncompleteSmallProjectChanges();
      let planned;
      try {
        planned = await f.service.draftSmallProjectChange({ authenticatedSubject: SUBJECT,
          projectId: PROJECT_ID, origin: ORIGIN, draft: ledgerBlueprint() });
      } catch (error) {
        if (error.code === 'M2_LIFECYCLE_GOVERNANCE_DENIED') {
          console.error(JSON.stringify(error.details?.decision?.findings));
        }
        throw error;
      }
      assert.equal(planned.state, 'awaiting_approval');
      assert.deepEqual(f.calls, GENERATION_ORDER);
      assert.deepEqual(planned.diff.map(row => row.path), Object.keys(f.outputs).sort());
      assert.deepEqual(planned.plan.focusedTest.argv, ORACLE_ARGV);
      assert.equal(planned.plan.focusedTest.binary, ORACLE_BINARY);
      assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      for (const relative of Object.keys(f.outputs)) assert.equal(fs.existsSync(path.join(f.project, relative)), false);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ORACLE_PATH))), ORACLE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, PROBE_PATH))), PROBE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, VALIDATE_PATH))), VALIDATE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ENTRY_PATH))), ENTRY_SHA256);
      await assert.rejects(f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
        origin: ORIGIN, lifecycleId: planned.lifecycleId, planDigest: `sha256:${'0'.repeat(64)}` }),
      { code: 'M2_LIFECYCLE_PLAN_DIGEST_MISMATCH' });
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      const result = await f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
        origin: ORIGIN, lifecycleId: planned.lifecycleId, planDigest: planned.planDigest });
      if (defect) {
        assert.notEqual(result.state, 'succeeded');
        assert.equal(result.result.focusedTest.terminalStatus, 'failed');
        assert.equal(result.result.errorCode, 'PROJECT_CHANGE_TEST_FAILED');
        if (defect === 'object-command-last-result') {
          const testOutput = result.audit.executionEvents.find(event => event.type === 'process_terminated')?.details?.testOutput;
          assert.match(testOutput?.stderr || '', /Unknown operation: undefined/,
            'the real tuple input rejects the object-command implementation');
          assert.equal(result.result.git.commitId, null, 'failing generated app cannot commit');
        }
        if (defect === 'probe-json-forgery') {
          const testOutput = result.audit.executionEvents.find(event => event.type === 'process_terminated')?.details?.testOutput;
          assert.match(testOutput?.stderr || '', /validate directly rejects nonfinite NaN/,
            'direct validator process status catches forged probe JSON');
        }
        if (defect === 'storage-row-alias' || defect === 'storage-json-forgery') {
          const testOutput = result.audit.executionEvents.find(event => event.type === 'process_terminated')?.details?.testOutput;
          assert.match(testOutput?.stderr || '',
            defect === 'storage-json-forgery' ? /process is not defined/ : /list returns independent row objects/,
            'trusted direct API observation rejects aliased storage');
        }
        assert.equal(result.result.rollback.status, 'succeeded');
        assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
        for (const relative of Object.keys(f.outputs)) assert.equal(fs.existsSync(path.join(f.project, relative)), false);
      } else {
        assert.equal(result.state, 'succeeded', JSON.stringify(result.result));
        assert.equal(result.result.focusedTest.terminalStatus, 'succeeded');
        const testOutput = result.audit.executionEvents.find(event => event.type === 'process_terminated')?.details?.testOutput;
        assert.match(testOutput?.stdout || '', /PROJECT_APP_ORACLE_PASS/);
        assert.equal(result.result.git.status, 'committed');
        assert.notEqual(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
        for (const [relative, bytes] of Object.entries(f.outputs)) {
          assert.deepEqual(fs.readFileSync(path.join(f.project, relative)), Buffer.from(bytes), relative);
        }
      }
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ORACLE_PATH))), ORACLE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, PROBE_PATH))), PROBE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, VALIDATE_PATH))), VALIDATE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ENTRY_PATH))), ENTRY_SHA256);
      f.db.close();
      const restartScript = `
        import Database from 'better-sqlite3';
        import { createDefaultM2LifecycleApplicationService } from './src/lifecycle/m2-lifecycle-application-service.js';
        const [databasePath, project, lifecycleId, subjectText, originText] = process.argv.slice(1);
        const db = new Database(databasePath); db.pragma('foreign_keys = ON');
        try {
          const subject = JSON.parse(subjectText), origin = JSON.parse(originText);
          const service = createDefaultM2LifecycleApplicationService({ database: db,
            projects: { findById: { get: id => id === origin.projectId ? { id, path: project, status: 'active' } : null } },
            generateCodeDraft: async () => { throw new Error('restart must not regenerate'); } });
          const recovered = await service.recoverIncompleteSmallProjectChanges();
          const view = service.getSmallProjectChangeStatus({ authenticatedSubject: subject, origin, lifecycleId });
          process.stdout.write(JSON.stringify({ pid: process.pid, recovered: recovered.length,
            state: view.state, resultDigest: view.terminal.resultDigest,
            errorCode: view.result?.errorCode, rollbackStatus: view.result?.rollback?.status,
            focusedTestStatus: view.result?.focusedTest?.terminalStatus }));
        } finally { db.close(); }
      `;
      const restarted = JSON.parse(execFileSync(process.execPath,
        ['--input-type=module', '-e', restartScript, '--', f.databasePath, f.project,
          planned.lifecycleId, JSON.stringify(SUBJECT), JSON.stringify(ORIGIN)],
        { cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000 }));
      assert.notEqual(restarted.pid, process.pid);
      assert.equal(restarted.recovered, 0);
      assert.equal(restarted.state, result.state);
      assert.equal(restarted.resultDigest, result.terminal.resultDigest);
      if (defect === 'object-command-last-result') {
        assert.equal(restarted.errorCode, 'PROJECT_CHANGE_TEST_FAILED');
        assert.equal(restarted.rollbackStatus, 'succeeded');
        assert.equal(restarted.focusedTestStatus, 'failed');
        assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
        assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
        for (const relative of Object.keys(f.outputs)) assert.equal(fs.existsSync(path.join(f.project, relative)), false);
      }
      assert.equal(f.calls.length, 6);
    } finally {
      if (f.db.open) f.db.close();
    }
  });
}

for (const defect of [null, 'shared-board', 'accept-nonplain', 'accept-nonplain-options',
  'ignore-status', 'wrong-priority', 'recycle-id', 'skip-transition',
  'alias-rows', 'no-op-remove', 'ignore-update', 'last-result']) {
  test(`M2 TaskFlow ${defect ? `rolls back ${defect}` : 'commits complete functional app'}`, async () => {
    const f = await fixture(defect, 'taskflow');
    try {
      await f.service.recoverIncompleteSmallProjectChanges();
      let planned;
      try {
        planned = await f.service.draftSmallProjectChange({ authenticatedSubject: SUBJECT,
          projectId: PROJECT_ID, origin: ORIGIN, draft: taskflowBlueprint() });
      } catch (error) {
        if (error.code === 'M2_LIFECYCLE_GOVERNANCE_DENIED') {
          console.error(JSON.stringify(error.details?.decision?.findings));
        }
        throw error;
      }
      assert.equal(planned.state, 'awaiting_approval');
      assert.deepEqual(f.calls, TASKFLOW_GENERATION_ORDER);
      assert.deepEqual(planned.diff.map(row => row.path), TASKFLOW_FILES.map(file => file.path).sort());
      assert.deepEqual(planned.plan.focusedTest.argv, TASKFLOW_ORACLE_ARGV);
      assert.equal(planned.plan.focusedTest.binary, ORACLE_BINARY);
      assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      for (const relative of Object.keys(f.outputs)) assert.equal(fs.existsSync(path.join(f.project, relative)), false);
      for (const [relative, digest] of [
        [ORACLE_PATH, TASKFLOW_ORACLE_SHA256], [PROBE_PATH, TASKFLOW_PROBE_SHA256],
        [VALIDATE_PATH, TASKFLOW_VALIDATE_SHA256], [ENTRY_PATH, ENTRY_SHA256],
      ]) assert.equal(sha256(fs.readFileSync(path.join(f.project, relative))), digest);
      await assert.rejects(f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
        origin: ORIGIN, lifecycleId: planned.lifecycleId, planDigest: `sha256:${'0'.repeat(64)}` }),
      { code: 'M2_LIFECYCLE_PLAN_DIGEST_MISMATCH' });
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      const result = await f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
        origin: ORIGIN, lifecycleId: planned.lifecycleId, planDigest: planned.planDigest });
      const testOutput = result.audit.executionEvents.find(event => event.type === 'process_terminated')?.details?.testOutput;
      if (defect) {
        assert.notEqual(result.state, 'succeeded', defect);
        assert.equal(result.result.focusedTest.terminalStatus, 'failed', defect);
        assert.equal(result.result.errorCode, 'PROJECT_CHANGE_TEST_FAILED', defect);
        assert.equal(result.result.git.commitId, null, defect);
        assert.equal(result.result.rollback.status, 'succeeded', defect);
        assert.doesNotMatch(testOutput?.stdout || '', /TASKFLOW_APP_ORACLE_PASS/, defect);
        if (defect === 'shared-board') assert.match(testOutput?.stderr || '', /fresh board per run/,
          'same-realm repeated run must expose module-scope board');
        if (defect === 'accept-nonplain') assert.match(testOutput?.stderr || '', /invalid patch new .*class Patch/,
          'VM class instance is rejected as a non-plain patch');
        if (defect === 'accept-nonplain-options') assert.match(testOutput?.stderr || '', /invalid options new Date/,
          'VM Date is rejected as a non-plain options object');
        assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
        for (const relative of Object.keys(f.outputs)) assert.equal(fs.existsSync(path.join(f.project, relative)), false);
      } else {
        assert.equal(result.state, 'succeeded', JSON.stringify(result.result));
        assert.equal(result.result.focusedTest.terminalStatus, 'succeeded');
        assert.match(testOutput?.stdout || '', /TASKFLOW_APP_ORACLE_PASS/);
        assert.equal(result.result.git.status, 'committed');
        assert.notEqual(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
        for (const [relative, bytes] of Object.entries(f.outputs)) {
          assert.deepEqual(fs.readFileSync(path.join(f.project, relative)), Buffer.from(bytes), relative);
        }
      }
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      f.db.close();
      // Reopen SQLite in another process and recheck exact generated bytes and
      // Git state after the service and initial connection are gone.
      const restartScript = `
        import fs from 'node:fs';
        import path from 'node:path';
        import Database from 'better-sqlite3';
        import { createDefaultM2LifecycleApplicationService } from './src/lifecycle/m2-lifecycle-application-service.js';
        const [databasePath, project, lifecycleId, subjectText, originText, outputsText] = process.argv.slice(1);
        const db = new Database(databasePath); db.pragma('foreign_keys = ON');
        try {
          const subject = JSON.parse(subjectText), origin = JSON.parse(originText), outputs = JSON.parse(outputsText);
          const service = createDefaultM2LifecycleApplicationService({ database: db,
            projects: { findById: { get: id => id === origin.projectId ? { id, path: project, status: 'active' } : null } },
            generateCodeDraft: async () => { throw new Error('restart must not regenerate'); } });
          const recovered = await service.recoverIncompleteSmallProjectChanges();
          const view = service.getSmallProjectChangeStatus({ authenticatedSubject: subject, origin, lifecycleId });
          const files = Object.fromEntries(Object.entries(outputs).map(([relative, bytes]) => {
            const file = path.join(project, relative);
            const exists = fs.existsSync(file);
            return [relative, { exists, exact: exists && fs.readFileSync(file, 'utf8') === bytes }];
          }));
          process.stdout.write(JSON.stringify({ pid: process.pid, recovered: recovered.length,
            state: view.state, resultDigest: view.terminal.resultDigest,
            errorCode: view.result?.errorCode, rollbackStatus: view.result?.rollback?.status,
            focusedTestStatus: view.result?.focusedTest?.terminalStatus, files }));
        } finally { db.close(); }
      `;
      const reopened = JSON.parse(execFileSync(process.execPath,
        ['--input-type=module', '-e', restartScript, '--', f.databasePath, f.project,
          planned.lifecycleId, JSON.stringify(SUBJECT), JSON.stringify(ORIGIN), JSON.stringify(f.outputs)],
        { cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000 }));
      assert.notEqual(reopened.pid, process.pid);
      assert.equal(reopened.recovered, 0);
      assert.equal(reopened.state, result.state);
      assert.equal(reopened.resultDigest, result.terminal.resultDigest);
      assert.equal(reopened.focusedTestStatus, defect ? 'failed' : 'succeeded');
      assert.deepEqual(reopened.files, Object.fromEntries(Object.keys(f.outputs)
        .map(file => [file, { exists: !defect, exact: !defect }])));
      if (defect) {
        assert.equal(reopened.errorCode, 'PROJECT_CHANGE_TEST_FAILED');
        assert.equal(reopened.rollbackStatus, 'succeeded');
        assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
      }
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
    } finally {
      if (f.db.open) f.db.close();
    }
  });
}

for (const defect of [null, 'schema-extra-import', 'schema-extra-reexport', 'cli-extra-import', 'store-extra-builtin',
  'wrong-schema', 'masked-quantity-check', 'no-db', 'forged-stdout', 'early-exit',
  'wrong-update', 'wrong-delete', 'wrong-search', 'alias-query-rows',
  'invalid-mutation', 'coerce-id', 'nonpersistence']) {
  test(`M2 SQLite catalog ${defect ? `rolls back ${defect}` : 'commits an independently observed DB app'}`, async () => {
    const f = await fixture(defect, 'sqlite-catalog');
    try {
      await f.service.recoverIncompleteSmallProjectChanges();
      let planned;
      try {
        planned = await f.service.draftSmallProjectChange({ authenticatedSubject: SUBJECT,
          projectId: PROJECT_ID, origin: ORIGIN, draft: sqliteCatalogBlueprint() });
      } catch (error) {
        if (error.code === 'M2_LIFECYCLE_GOVERNANCE_DENIED')
          console.error(JSON.stringify(error.details?.decision?.findings));
        throw error;
      }
      assert.equal(planned.state, 'awaiting_approval');
      assert.deepEqual(f.calls, SQLITE_GENERATION_ORDER);
      assert.deepEqual(planned.diff.map(row => row.path), SQLITE_FILES.map(file => file.path).sort());
      assert.deepEqual(planned.plan.focusedTest.argv, SQLITE_ORACLE_ARGV);
      assert.equal(planned.plan.focusedTest.binary, ORACLE_BINARY);
      assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ORACLE_PATH))), SQLITE_ORACLE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ENTRY_PATH))), SQLITE_ENTRY_SHA256);
      for (const relative of Object.keys(f.outputs)) assert.equal(fs.existsSync(path.join(f.project, relative)), false);
      assertSqlitePreview(planned.diff, f.project,
        (root, relative) => fs.readFileSync(path.join(root, relative)), (root, relative) => fs.existsSync(path.join(root, relative)));
      await assert.rejects(f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
        origin: ORIGIN, lifecycleId: planned.lifecycleId, planDigest: `sha256:${'0'.repeat(64)}` }),
      { code: 'M2_LIFECYCLE_PLAN_DIGEST_MISMATCH' });
      const result = await f.service.approveSmallProjectChange({ authenticatedSubject: SUBJECT,
        origin: ORIGIN, lifecycleId: planned.lifecycleId, planDigest: planned.planDigest });
      const testOutput = result.audit.executionEvents.find(event => event.type === 'process_terminated')?.details?.testOutput;
      if (defect) {
        assert.notEqual(result.state, 'succeeded', defect);
        assert.equal(result.result.focusedTest.terminalStatus, 'failed', defect);
        assert.equal(result.result.errorCode, 'PROJECT_CHANGE_TEST_FAILED', defect);
        assert.equal(result.result.git.commitId, null, defect);
        assert.equal(result.result.rollback.status, 'succeeded', defect);
        assert.doesNotMatch(testOutput?.stdout || '', /SQLITE_CATALOG_ORACLE_PASS/, defect);
        const expectedFailure = {
          'schema-extra-import': /SQLite declared dependencies: src\/schema.js/,
          'schema-extra-reexport': /SQLite declared dependencies: src\/schema.js/,
          'cli-extra-import': /SQLite declared dependencies: src\/cli.js/,
          'store-extra-builtin': /SQLite declared dependencies: src\/store.js/,
          'wrong-schema': /actual result|exact persisted schema/,
          'masked-quantity-check': /negative quantity: only the tested field triggers/,
          'no-db': /no such table: books/,
          'forged-stdout': /JSON|Unexpected token/,
          'early-exit': /JSON|Unexpected end/,
          'wrong-update': /update only named fields/,
          'wrong-delete': /delete persisted row/,
          'wrong-search': /literal case-sensitive SQL metacharacter search/,
          'alias-query-rows': /query returns a new row object/,
          'invalid-mutation': /entire batch rolled back/,
          'coerce-id': /string ID: invalid command exits nonzero/,
          nonpersistence: /ENOENT|no such file or directory/,
        }[defect];
        assert.match(testOutput?.stderr || '', expectedFailure, `${defect}: declared functional defect`);
        assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
      } else {
        assert.equal(result.state, 'succeeded', JSON.stringify(result.result));
        assert.equal(result.result.focusedTest.terminalStatus, 'succeeded');
        assert.match(testOutput?.stdout || '', /SQLITE_CATALOG_ORACLE_PASS/);
        assert.equal(result.result.git.status, 'committed');
        assert.notEqual(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
      }
      for (const [relative, bytes] of Object.entries(f.outputs)) {
        assert.equal(fs.existsSync(path.join(f.project, relative)), !defect, relative);
        if (!defect) assert.deepEqual(fs.readFileSync(path.join(f.project, relative)), Buffer.from(bytes), relative);
      }
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ORACLE_PATH))), SQLITE_ORACLE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ENTRY_PATH))), SQLITE_ENTRY_SHA256);
      f.db.close();
      // A distinct process opens the authority DB read-only after the first
      // service connection closes. Generated files are observed independently.
      const reader = `
        import fs from 'node:fs'; import path from 'node:path';
        import Database from 'better-sqlite3';
        import { createDefaultM2LifecycleApplicationService } from './src/lifecycle/m2-lifecycle-application-service.js';
        const [databasePath, project, lifecycleId, subjectText, originText, outputsText] = process.argv.slice(1);
        const db = new Database(databasePath, { readonly: true, fileMustExist: true });
        try {
          const subject = JSON.parse(subjectText), origin = JSON.parse(originText), outputs = JSON.parse(outputsText);
          const service = createDefaultM2LifecycleApplicationService({ database: db,
            projects: { findById: { get: id => id === origin.projectId ? { id, path: project, status: 'active' } : null } },
            generateCodeDraft: async () => { throw new Error('read-only reopened service cannot generate'); } });
          const view = service.getSmallProjectChangeStatus({ authenticatedSubject: subject, origin, lifecycleId });
          const files = Object.fromEntries(Object.entries(outputs).map(([relative, bytes]) => {
            const file = path.join(project, relative); const exists = fs.existsSync(file);
            return [relative, { exists, exact: exists && fs.readFileSync(file, 'utf8') === bytes }];
          }));
          process.stdout.write(JSON.stringify({ pid: process.pid, readOnly: db.readonly,
            state: view.state, resultDigest: view.terminal.resultDigest,
            errorCode: view.result?.errorCode, focusedTestStatus: view.result?.focusedTest?.terminalStatus,
            rollbackStatus: view.result?.rollback?.status, files }));
        } finally { db.close(); }
      `;
      const reopened = JSON.parse(execFileSync(process.execPath,
        ['--input-type=module', '-e', reader, '--', f.databasePath, f.project,
          planned.lifecycleId, JSON.stringify(SUBJECT), JSON.stringify(ORIGIN), JSON.stringify(f.outputs)],
        { cwd: isolatedTestRuntime.repositoryRoot, encoding: 'utf8', timeout: 15_000 }));
      assert.notEqual(reopened.pid, process.pid);
      assert.equal(reopened.readOnly, true);
      assert.equal(reopened.state, result.state);
      assert.equal(reopened.resultDigest, result.terminal.resultDigest);
      assert.equal(reopened.focusedTestStatus, defect ? 'failed' : 'succeeded');
      assert.deepEqual(reopened.files, Object.fromEntries(Object.keys(f.outputs)
        .map(file => [file, { exists: !defect, exact: !defect }])));
      if (defect) {
        assert.equal(reopened.errorCode, 'PROJECT_CHANGE_TEST_FAILED');
        assert.equal(reopened.rollbackStatus, 'succeeded');
        assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
      }
    } finally { if (f.db.open) f.db.close(); }
  });
}

function listenOwned(server, ...address) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(...address, () => { server.off('error', reject); resolve(); });
  });
}

async function observe(predicate, label) {
  const deadline = Date.now() + 3_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function relayFixture(t, { complete = false } = {}) {
  const requests = [], model = 'owned-loopback-qualification';
  const terminal = { model, done: true, done_reason: 'stop', provider_version: '0.34.0',
    model_digest_sha256: 'a'.repeat(64), message: { content: '{"afterContent":"owned output"}' } };
  let observedUpstream = 0, closedUpstream = 0, modelCalls = 0, closedParentSockets = 0;
  const upstream = http.createServer((incoming, outgoing) => {
    observedUpstream++;
    incoming.socket.once('close', () => { closedUpstream++; });
    incoming.resume();
    incoming.on('end', () => {
      outgoing.writeHead(200, { 'Content-Type': 'application/json' });
      if (complete) outgoing.end(JSON.stringify(terminal));
      else outgoing.write('{"pending":'); // An actual unfinished owned response.
    });
  });
  t.after(async () => {
    await inner?.close(); await parent?.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  });
  let parent = null, inner = null;
  await listenOwned(upstream, 0, '127.0.0.1');
  parent = createProviderProxy({ model, requests, upstreamPort: upstream.address().port,
    onModelCall: () => { modelCalls++; } });
  parent.server.on('connection', socket => socket.once('close', () => { closedParentSockets++; }));
  // Linux abstract Unix address avoids exposing a filesystem socket outside
  // the private bootstrap, while exercising the runner's real Unix relay hop.
  const socket = '\0is-project-app-' + randomUUID();
  await listenOwned(parent.server, socket);
  inner = providerRelay(socket);
  await listenOwned(inner.server, 0, '127.0.0.1');
  return { parent, inner, requests, terminal,
    get observedUpstream() { return observedUpstream; },
    get closedUpstream() { return closedUpstream; },
    get modelCalls() { return modelCalls; },
    get closedParentSockets() { return closedParentSockets; },
    request() {
      const request = http.request({ hostname: '127.0.0.1', port: inner.server.address().port,
        path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json' } });
      request.on('error', () => {}); // Cancellation is deliberately asserted below.
      t.after(() => request.destroy());
      request.end(JSON.stringify({ model, stream: false }));
      return request;
    },
  };
}

test('both real relay tiers preserve a completed response after normal downstream request close', { timeout: 10_000 }, async t => {
  const fixture = await relayFixture(t, { complete: true });
  const request = fixture.request();
  const body = await new Promise((resolve, reject) => {
    request.once('error', reject);
    request.once('response', response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('end', () => resolve(Buffer.concat(chunks)));
      response.once('error', reject);
    });
  });
  assert.deepEqual(JSON.parse(body), fixture.terminal);
  await observe(() => fixture.inner.activeRequestCount === 0 && fixture.parent.activeRequestCount === 0,
    'completed relay exchanges must settle');
  assert.equal(fixture.modelCalls, 1);
  assert.equal(fixture.observedUpstream, 1);
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.requests[0].error, undefined);
  assert.equal(fixture.requests[0].responseTruncated, false);
  assert.deepEqual(fixture.requests[0].terminal, fixture.terminal);
  t.diagnostic(JSON.stringify({ controlledLoopback: true, observedUpstream: fixture.observedUpstream,
    activeInner: fixture.inner.activeRequestCount, activeParent: fixture.parent.activeRequestCount,
    responseSha256: fixture.requests[0].responseSha256, terminalComplete: true }));
});

test('downstream response close cancels the actual upstream through both owned relay tiers', { timeout: 10_000 }, async t => {
  const fixture = await relayFixture(t);
  const request = fixture.request();
  await new Promise((resolve, reject) => {
    request.once('error', reject);
    request.once('response', response => response.once('data', () => { response.destroy(); resolve(); }));
  });
  await observe(() => fixture.closedUpstream === 1
    && fixture.inner.activeRequestCount === 0 && fixture.parent.activeRequestCount === 0,
  'actual upstream socket and both relay exchanges must close after downstream cancellation');
  assert.equal(fixture.observedUpstream, 1);
  assert.equal(fixture.modelCalls, 1);
  assert.match(fixture.requests[0].error, /closed|aborted/);
  assert.equal(fixture.requests[0].terminal, undefined, 'cancelled generation cannot gain a terminal attestation');
  t.diagnostic(JSON.stringify({ controlledLoopback: true, observedUpstream: fixture.observedUpstream,
    closedUpstream: fixture.closedUpstream, activeInner: fixture.inner.activeRequestCount,
    activeParent: fixture.parent.activeRequestCount, error: fixture.requests[0].error, terminalComplete: false }));
});

test('explicit cleanup of each real relay tier awaits its unfinished owned upstream before returning', { timeout: 15_000 }, async t => {
  for (const tier of ['inner', 'parent']) {
    await t.test(tier, async child => {
      const fixture = await relayFixture(child);
      fixture.request();
      await observe(() => fixture.observedUpstream === 1 && fixture.parent.activeRequestCount === 1
        && fixture.inner.activeRequestCount === 1, 'one actual owned upstream must be active before cleanup');
      const cleanup = await fixture[tier].close();
      assert.deepEqual(cleanup, { activeRequests: 0 });
      assert.equal(fixture[tier].activeRequestCount, 0, 'subsequent unload/lease cleanup sees no owned request');
      await observe(() => fixture.closedUpstream === 1, 'cleanup must close the actual owned upstream socket');
      await fixture.inner.close(); await fixture.parent.close();
      assert.equal(fixture.inner.activeRequestCount + fixture.parent.activeRequestCount, 0);
      assert.equal(fixture.requests[0].terminal, undefined);
      assert.match(fixture.requests[0].error, /cleanup|closed|aborted/);
      child.diagnostic(JSON.stringify({ controlledLoopback: true, cleanupTier: tier,
        cleanup, closedUpstream: fixture.closedUpstream, activeInner: fixture.inner.activeRequestCount,
        activeParent: fixture.parent.activeRequestCount, terminalComplete: false }));
    });
  }
});

test('an aborted downstream upload closes the inner relay upstream and settles the parent body reader without forwarding', { timeout: 10_000 }, async t => {
  const fixture = await relayFixture(t);
  const request = http.request({ hostname: '127.0.0.1', port: fixture.inner.server.address().port,
    path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 200 } });
  request.on('error', () => {});
  t.after(() => request.destroy());
  request.write('{"model":'); // Deliberately incomplete request body.
  await observe(() => fixture.inner.activeRequestCount === 1 && fixture.parent.activeRequestCount === 1,
    'both real relay handlers must own the unfinished upload before abort');
  request.destroy();
  await observe(() => fixture.inner.activeRequestCount === 0 && fixture.parent.activeRequestCount === 0
    && fixture.closedParentSockets === 1,
    'aborted inner upstream and asynchronous parent body handler must settle');
  assert.equal(fixture.observedUpstream, 0, 'no completed request exists to forward to the upstream provider');
  assert.equal(fixture.modelCalls, 0);
  assert.deepEqual(fixture.requests, []);
  t.diagnostic(JSON.stringify({ controlledLoopback: true, closedParentSockets: fixture.closedParentSockets,
    activeInner: fixture.inner.activeRequestCount, activeParent: fixture.parent.activeRequestCount,
    observedUpstream: fixture.observedUpstream, modelCalls: fixture.modelCalls }));
});
