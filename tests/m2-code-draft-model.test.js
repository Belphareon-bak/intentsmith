// Real CODE inference -> production M2 service -> explicit approval -> sandboxed
// behavioural test. Run only in the contained model launcher with private DB.
import { resolveIsolatedProjectPath, resolveIsolatedArtifactPath } from './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db/database.js';
import { config } from '../src/config.js';
import { MODEL_RUNTIME_PROFILE } from '../src/llm/model-runtime-profile.js';
import { createDefaultM2LifecycleApplicationService } from '../src/lifecycle/m2-lifecycle-application-service.js';

assert.equal(process.env.C3_AUDIT_RUN, '1', 'requires isolated registered audit runner');
assert.equal(config.models.CODE, MODEL_RUNTIME_PROFILE.model);
assert.equal(MODEL_RUNTIME_PROFILE.contextWindowTokens, 4096, 'production context, no diagnostic uplift');
const root = resolveIsolatedProjectPath('bounded-code-draft');
const evidence = resolveIsolatedArtifactPath('bounded-code-draft-model.json');
const report = { sourceRevision: process.env.INTENTSMITH_TEST_SOURCE_REVISION, startedAt: new Date().toISOString(),
  model: config.models.CODE, digestSha256: MODEL_RUNTIME_PROFILE.digestSha256, contextTokens: 4096,
  status: 'RUNNING', scope: 'production-service-real-model-and-execution; UI verified separately' };
const sha = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8', env: {
  PATH: '/usr/bin:/bin', HOME: process.env.HOME, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
} }).trim();
try {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.c3'), { recursive: true });
  const before = 'export function isLeapYear(year) { return year % 4 === 0; }\n';
  fs.writeFileSync(path.join(root, 'src/calendar.mjs'), before);
  fs.writeFileSync(path.join(root, '.c3/m2-governance-policy.json'), JSON.stringify({
    policyId: 'bounded-draft-policy', layers: [{ name: 'app', roots: ['src'] }],
    rules: [{ from: 'app', canImport: ['app'] }], externalImports: [], sourceExtensions: ['.mjs'],
    requiredChecks: ['imports.allowed', 'inventory.complete', 'layers.mapped'], unmappedFilePolicy: 'unavailable',
  }));
  git(['init', '-b', 'main']);
  git(['add', '--', 'src/calendar.mjs', '.c3/m2-governance-policy.json']);
  git(['-c', 'user.name=IntentSmith Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  const projectId = 9927;
  const projects = { findById: { get: id => id === projectId ? { id, path: root, status: 'active' } : null } };
  const service = createDefaultM2LifecycleApplicationService({ database: db, projects });
  await service.recoverIncompleteSmallProjectChanges();
  const subject = { actorType: 'user', actorId: 'local-operator' };
  const origin = { surface: 'studio', projectId, sessionId: 'draft-model-9927', conversationId: 'draft-model-9927' };
  const planned = await service.draftSmallProjectChange({
    authenticatedSubject: subject, projectId, origin,
    draft: {
      path: 'src/calendar.mjs', instruction: 'Fix isLeapYear to implement the Gregorian leap-year rule, including century years. Preserve the exported function name.',
      // This exact behaviour test is operator/fixture supplied, never invented
      // by the model. Imported code runs only inside the accepted M2 sandbox.
      focusedTest: { binary: process.execPath, argv: ['--input-type=module', '-e',
        "import assert from 'node:assert/strict';import {isLeapYear} from './src/calendar.mjs';for(const [year,want] of [[1900,false],[2000,true],[2024,true],[2023,false],[2100,false],[2400,true]])assert.equal(isLeapYear(year),want,String(year));console.log('6 Gregorian cases passed');"],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' }, timeoutMs: 30_000 },
    },
  });
  assert.equal(planned.state, 'awaiting_approval');
  assert.equal(planned.diff.length, 1);
  assert.equal(planned.diff[0].path, 'src/calendar.mjs');
  assert.equal(fs.readFileSync(path.join(root, 'src/calendar.mjs'), 'utf8'), before);
  report.planDigest = planned.planDigest;
  report.lifecycleId = planned.lifecycleId;
  report.beforeSha256 = sha(before);
  report.afterSha256 = sha(planned.diff[0].after.content);
  report.approval = 'explicit exact plan digest supplied by isolated test operator';
  const result = await service.approveSmallProjectChange({
    authenticatedSubject: subject, origin, lifecycleId: planned.lifecycleId, planDigest: planned.planDigest,
  });
  report.execution = result;
  assert.equal(result.state, 'succeeded');
  assert.equal(result.result.focusedTest.terminalStatus, 'succeeded');
  assert.equal(fs.readFileSync(path.join(root, 'src/calendar.mjs'), 'utf8'), planned.diff[0].after.content);
  const restarted = createDefaultM2LifecycleApplicationService({ database: db, projects });
  await restarted.recoverIncompleteSmallProjectChanges();
  const durable = restarted.getSmallProjectChangeStatus({ authenticatedSubject: subject, origin, lifecycleId: planned.lifecycleId });
  assert.equal(durable.terminal.resultDigest, result.terminal.resultDigest);
  report.status = 'PASS';
  report.behaviouralCases = 6;
  console.log('PASS: actual CODE draft, no write before approval, exact approval, six sandboxed behaviour assertions and durable terminal');
} catch (error) {
  report.status = 'FAIL'; report.error = { code: error.code, message: error.message };
  throw error;
} finally {
  report.endedAt = new Date().toISOString();
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n');
  db.close();
}
