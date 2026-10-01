#!/usr/bin/env node
// Offline six-file project acceptance through the production M2 service,
// real SQLite/Git effects and its canonical process sandbox. No GPU/model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { REFERENCE_LEDGER_OUTPUTS } from './helpers/project-app-reference.js';
import { initializeNewProject } from '../src/planner/project-onboarding.js';
import { createDefaultM2LifecycleApplicationService } from '../src/lifecycle/m2-lifecycle-application-service.js';
import { up as applyEffectAuthority } from '../src/db/migrations/2026_08_23_092_m2_effect_authority.js';
import { up as applyEffectHardening } from '../src/db/migrations/2026_08_24_071_m2_effect_authority_hardening.js';
import { up as applyEffectClaims } from '../src/db/migrations/2026_08_24_072_m2_effect_execution_claims.js';
import { up as applyEffectClaimTruth } from '../src/db/migrations/2026_08_24_073_m2_effect_claim_truth.js';
import { up as applyExecutionAuthority } from '../src/db/migrations/2026_08_24_078_m2_execution_authority.js';
import { up as applyLifecycleAuthority } from '../src/db/migrations/2026_08_24_079_m2_lifecycle_authority.js';
import {
  ORACLE_PATH, ORACLE_SOURCE, ORACLE_SHA256, PROBE_PATH, PROBE_SOURCE, PROBE_SHA256,
  ENTRY_PATH, ENTRY_SOURCE, ENTRY_SHA256,
  sha256, ledgerBlueprint, policyForFrozenOracle,
} from '../scripts/project-app-acceptance.js';

const PROJECT_ID = 6021;
const SUBJECT = Object.freeze({ actorType: 'user', actorId: 'ledger-acceptance-operator' });
const ORIGIN = Object.freeze({ surface: 'http', sessionId: 'ledger-offline-session',
  conversationId: 'ledger-offline-conversation', projectId: PROJECT_ID });
const GENERATION_ORDER = ['src/totals.js', 'src/validate.js', 'src/storage.js',
  'src/service.js', 'src/cli.js', 'src/app.js'];

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

async function fixture(defect) {
  const folder = fs.mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'app-m2-'));
  const project = path.join(folder, 'project');
  await initializeNewProject(project, { name: 'Expense Ledger', type: 'general' });
  const policyPath = path.join(project, '.intentsmith/m2-governance-policy.json');
  const policy = policyForFrozenOracle(JSON.parse(fs.readFileSync(policyPath, 'utf8')));
  assert.ok(policy.externalImports.includes('node:child_process'));
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n');
  fs.writeFileSync(path.join(project, ORACLE_PATH), ORACLE_SOURCE);
  fs.writeFileSync(path.join(project, PROBE_PATH), PROBE_SOURCE);
  fs.writeFileSync(path.join(project, ENTRY_PATH), ENTRY_SOURCE);
  git(project, ['add', '--', ORACLE_PATH, PROBE_PATH, ENTRY_PATH, '.intentsmith/m2-governance-policy.json']);
  git(project, ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
    '-c', 'user.name=IntentSmith Test', '-c', 'user.email=test@example.invalid',
    'commit', '-m', 'freeze operator oracle']);
  const baseline = git(project, ['rev-parse', 'HEAD']);
  const databasePath = path.join(folder, 'authority.sqlite');
  const db = databaseAt(databasePath);
  const outputs = { ...REFERENCE_LEDGER_OUTPUTS };
  if (defect) outputs['src/totals.js'] = outputs['src/totals.js'].replace('sum + row.amount', 'sum + 1');
  if (defect === 'assert-noops') outputs['src/app.js'] = `import assert from 'node:assert/strict';
for (const key of ['ok', 'equal', 'deepEqual', 'throws']) assert[key] = () => {};
export { run } from './cli.js';
`;
  if (defect === 'early-exit') outputs['src/app.js'] = `console.log('PROJECT_APP_ORACLE_PASS');
process.exit(0);
export { run } from './cli.js';
`;
  const calls = [];
  const service = createDefaultM2LifecycleApplicationService({ database: db,
    projects: { findById: { get: id => id === PROJECT_ID ? { id, path: project, status: 'active' } : null } },
    generateCodeDraft: async ({ prompt }) => {
      const input = JSON.parse(prompt);
      assert.equal(input.path, GENERATION_ORDER[calls.length], 'dependency order');
      assert.equal(Object.hasOwn(input, 'focusedTest'), false, 'model cannot choose the oracle');
      assert.equal(fs.readFileSync(path.join(project, ORACLE_PATH), 'utf8'), ORACLE_SOURCE);
      assert.equal(git(project, ['status', '--porcelain=v1']), '', 'draft has no disk effect');
      calls.push(input.path);
      return { content: JSON.stringify({ afterContent: outputs[input.path] }), finishReason: 'stop' };
    },
  });
  return { folder, project, db, databasePath, outputs, calls, baseline, service };
}

for (const defect of [null, 'wrong-total', 'assert-noops', 'early-exit']) {
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
      assert.deepEqual(planned.plan.focusedTest.argv, [ORACLE_PATH]);
      assert.equal(planned.plan.focusedTest.binary, '/usr/bin/node');
      assert.equal(git(f.project, ['rev-parse', 'HEAD']), f.baseline);
      assert.equal(git(f.project, ['status', '--porcelain=v1']), '');
      for (const relative of Object.keys(f.outputs)) assert.equal(fs.existsSync(path.join(f.project, relative)), false);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, ORACLE_PATH))), ORACLE_SHA256);
      assert.equal(sha256(fs.readFileSync(path.join(f.project, PROBE_PATH))), PROBE_SHA256);
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
            state: view.state, resultDigest: view.terminal.resultDigest }));
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
      assert.equal(f.calls.length, 6);
    } finally {
      if (f.db.open) f.db.close();
    }
  });
}
