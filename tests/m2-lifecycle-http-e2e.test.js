#!/usr/bin/env node

// Current lifecycle HTTP E2E. The retired free-text/model lifecycle is
// deliberately not exercised: the only mutating authority is the strict M2
// prepare -> exact approval -> terminal chain.

import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import strictAssert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  HTTP_BUILD_PROJECT_ID, HTTP_BUILD_BEFORE, HTTP_BUILD_OUTPUTS, httpBuildBlueprint,
  startControlledM2HttpFixture, stopControlledM2HttpFixture, controlledM2Request,
} from './helpers/m2-http-build-fixture.js';

const BASE = process.env.C3_URL || 'http://127.0.0.1:3335';
const RUN_ID = `m2-lifecycle-http-${Date.now()}`;
const TIMEOUT_MS = 300_000;
const HOME = process.env.HOME;

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, description) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${description}`);
  } else {
    failed++;
    failures.push(description);
    console.log(`  ❌ ${description}`);
  }
}

async function request(method, requestPath, body = null) {
  const response = await fetch(new URL(requestPath, BASE), {
    method,
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: body === null ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

function git(root, args) {
  return execFileSync('/usr/bin/git', args, {
    cwd: root,
    env: {
      PATH: '/usr/bin:/bin',
      HOME,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
    encoding: 'utf8',
  }).trim();
}

function writeGovernanceFixture(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'module.exports = { value: 1 };\n');
  fs.writeFileSync(path.join(root, '.c3', 'm2-governance-policy.json'), `${JSON.stringify({
    policyId: 'm2-policy-v1',
    layers: [{ name: 'app', roots: ['src'] }],
    rules: [{ from: 'app', canImport: ['app'] }],
    externalImports: [],
    sourceExtensions: ['.js'],
    requiredChecks: ['imports.allowed', 'inventory.complete', 'layers.mapped'],
    unmappedFilePolicy: 'unavailable',
  }, null, 2)}\n`);
  git(root, ['add', '--', '.gitignore', 'README.md', 'ROADMAP.md', 'src/app.js']);
  git(root, ['add', '-f', '--', '.c3/m2-governance-policy.json']);
  git(root, [
    '-c', 'user.name=IntentSmith Test',
    '-c', 'user.email=intentsmith@example.invalid',
    'commit', '-m', 'baseline',
  ]);
}

function proposal() {
  return {
    intent: 'Update the exact exported application value',
    changes: [{ path: 'src/app.js', afterContent: 'module.exports = { value: 2 };\n' }],
    focusedTest: {
      binary: '/usr/bin/node',
      argv: ['--check', 'src/app.js'],
      environment: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NO_COLOR: '1' },
      timeoutMs: 30_000,
    },
    gitCommit: {
      message: 'M2 governed lifecycle HTTP change',
      identity: {
        authorName: 'IntentSmith Runtime',
        authorEmail: 'runtime@example.invalid',
        authorDate: '2026-08-27T10:00:00Z',
        committerName: 'IntentSmith Runtime',
        committerEmail: 'runtime@example.invalid',
        committerDate: '2026-08-27T10:00:00Z',
      },
    },
  };
}

async function controlledHttpBuildRestart(defect) {
  const fixtureRoot = fs.mkdtempSync(path.join(isolatedTestRuntime.artifacts, 'm2-http-build-restart-'));
  const root = path.join(fixtureRoot, 'project');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.c3'));
  fs.writeFileSync(path.join(root, 'src/app.mjs'), HTTP_BUILD_BEFORE);
  fs.writeFileSync(path.join(root, '.c3/m2-governance-policy.json'), JSON.stringify({
    policyId: 'm2-http-build-fixture', layers: [{ name: 'app', roots: ['src'] }],
    rules: [{ from: 'app', canImport: ['app'] }], externalImports: [], sourceExtensions: ['.mjs'],
    requiredChecks: ['imports.allowed', 'inventory.complete', 'layers.mapped'], unmappedFilePolicy: 'unavailable',
  }));
  git(root, ['init', '-b', 'main']);
  git(root, ['add', '--', 'src/app.mjs', '.c3/m2-governance-policy.json']);
  git(root, ['-c', 'user.name=IntentSmith Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'controlled HTTP baseline']);
  const baselineHead = git(root, ['rev-parse', 'HEAD']);
  const origin = { surface: 'http', projectId: HTTP_BUILD_PROJECT_ID,
    sessionId: `${RUN_ID}-${defect ? 'rollback' : 'success'}`, conversationId: `${RUN_ID}-${defect ? 'rollback' : 'success'}` };
  const evidence = { fixture: 'controlled-auth-project-registry-and-model',
    scope: 'production M2 routes/service and real SQLite/Git/bwrap over two HTTP child processes; not src/server.js startup or physical model',
    sourceRevision: process.env.INTENTSMITH_TEST_SOURCE_REVISION ?? null,
    scenario: defect ? 'failed behavioural test and rollback' : 'successful build and exact commit',
    baselineHead, fixtureRoot, status: 'RUNNING' };
  let server;
  const check = (condition, description) => {
    assert(condition, `controlled HTTP ${defect ? 'rollback' : 'success'}: ${description}`);
    strictAssert.ok(condition, description);
  };
  const fileSnapshot = () => Object.keys(HTTP_BUILD_OUTPUTS).sort().map(relative => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) return { path: relative, exists: false };
    const stat = fs.statSync(file, { bigint: true });
    return { path: relative, exists: true, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      inode: String(stat.ino), modifiedNs: String(stat.mtimeNs) };
  });
  try {
    server = await startControlledM2HttpFixture({ fixtureRoot, defect });
    evidence.firstPid = server.child.pid;
    const denied = await controlledM2Request(server, 'POST', '/api/m2/lifecycle/draft', {
      projectId: HTTP_BUILD_PROJECT_ID, origin, draft: httpBuildBlueprint(),
    }, 'wrong-fixture-token');
    check(denied.status === 403, 'unauthenticated fixture request cannot generate a plan');
    const empty = await controlledM2Request(server, 'GET', '/fixture/evidence');
    check(empty.data.generationCalls.length === 0 && empty.data.authority.every(table => table.count === 0),
      'unauthenticated request has no model or authority effects');
    const planned = await controlledM2Request(server, 'POST', '/api/m2/lifecycle/draft', {
      projectId: HTTP_BUILD_PROJECT_ID, origin, draft: httpBuildBlueprint(),
    });
    check(planned.status === 200 && planned.data.state === 'awaiting_approval', 'HTTP generation prepares a single plan for both dependent files');
    check(JSON.stringify(planned.data.diff.map(file => file.path)) === JSON.stringify(Object.keys(HTTP_BUILD_OUTPUTS).sort()), 'complete preview contains exactly both targets');
    const outputs = { ...HTTP_BUILD_OUTPUTS };
    if (defect) outputs['src/calendar.mjs'] = 'export const isLeapYear = year => year % 4 === 0;\n';
    check(planned.data.diff.every(file => file.after.content === outputs[file.path]), 'preview contains the complete generated fixture bytes');
    check(fs.readFileSync(path.join(root, 'src/app.mjs'), 'utf8') === HTTP_BUILD_BEFORE
      && !fs.existsSync(path.join(root, 'src/calendar.mjs')) && git(root, ['rev-parse', 'HEAD']) === baselineHead,
    'generation and preview leave project files and Git unchanged');
    const approve = { lifecycleId: planned.data.lifecycleId, planDigest: planned.data.planDigest, origin };
    const wrongDigest = await controlledM2Request(server, 'POST', '/api/m2/lifecycle/approve', {
      ...approve, planDigest: `sha256:${'0'.repeat(64)}`,
    });
    check(wrongDigest.status === 409 && wrongDigest.data.code === 'M2_LIFECYCLE_PLAN_DIGEST_MISMATCH', 'wrong plan digest fails before execution');
    check(fs.readFileSync(path.join(root, 'src/app.mjs'), 'utf8') === HTTP_BUILD_BEFORE
      && !fs.existsSync(path.join(root, 'src/calendar.mjs')), 'rejected approval preserves all target bytes');
    const completed = await controlledM2Request(server, 'POST', '/api/m2/lifecycle/approve', approve);
    check(completed.status === 200, 'exact approval returns a truthful terminal over HTTP');
    if (defect) {
      check(completed.data.state !== 'succeeded' && completed.data.result.focusedTest.terminalStatus === 'failed', 'real behavioural test rejects the generated century-rule defect');
      check(completed.data.result.rollback.status === 'succeeded', 'rollback succeeds for the whole two-file change');
      check(fs.readFileSync(path.join(root, 'src/app.mjs'), 'utf8') === HTTP_BUILD_BEFORE
        && !fs.existsSync(path.join(root, 'src/calendar.mjs')) && git(root, ['rev-parse', 'HEAD']) === baselineHead,
      'rollback restores the old entrypoint, removes the new dependency and preserves Git HEAD');
    } else {
      check(completed.data.state === 'succeeded' && completed.data.result.focusedTest.terminalStatus === 'succeeded', 'six real sandboxed behavioural assertions pass');
      check(completed.data.result.git.status === 'committed' && git(root, ['rev-parse', 'HEAD']) !== baselineHead, 'approved exact Git commit completes');
      check(Object.entries(outputs).every(([relative, content]) => fs.readFileSync(path.join(root, relative), 'utf8') === content), 'approved bytes of both generated files are on disk');
    }
    check(git(root, ['status', '--porcelain=v1']) === '', 'terminal leaves a clean fixture Git worktree');
    const statusQuery = new URLSearchParams({ id: planned.data.lifecycleId, surface: origin.surface,
      sessionId: origin.sessionId, conversationId: origin.conversationId, projectId: String(HTTP_BUILD_PROJECT_ID) });
    const statusPath = `/api/m2/lifecycle/status?${statusQuery}`;
    const beforeRestart = await controlledM2Request(server, 'GET', statusPath);
    check(beforeRestart.status === 200 && beforeRestart.raw === completed.raw, 'HTTP status preserves the byte-identical terminal before shutdown');
    const beforeAuthority = await controlledM2Request(server, 'GET', '/fixture/evidence');
    check(JSON.stringify(beforeAuthority.data.generationCalls) === JSON.stringify(['src/calendar.mjs', 'src/app.mjs']), 'fixture generation followed dependency order exactly once');
    const beforeFiles = fileSnapshot();
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const token = server.token;
    const firstStopped = await stopControlledM2HttpFixture(server);
    evidence.firstExit = firstStopped;
    check(firstStopped.code === 0 && firstStopped.signal === null && firstStopped.forced === false, 'first server process exits cleanly before restart');
    server = null;
    server = await startControlledM2HttpFixture({ fixtureRoot, defect, restart: true, token });
    evidence.secondPid = server.child.pid;
    check(server.child.pid !== evidence.firstPid && server.child.pid !== process.pid, 'restart starts a distinct child process');
    check(server.ready.databasePath === beforeAuthority.data.databasePath && server.ready.recovered === 0, 'new process opens the same database with no incomplete operation to replay');
    const durable = await controlledM2Request(server, 'GET', statusPath);
    check(durable.status === 200 && durable.raw === beforeRestart.raw, 'full durable HTTP status is byte-identical after process restart');
    const duplicate = await controlledM2Request(server, 'POST', '/api/m2/lifecycle/approve', approve);
    check(duplicate.status === 200 && duplicate.raw === durable.raw, 'repeat exact approval returns the durable terminal without new execution');
    const afterAuthority = await controlledM2Request(server, 'GET', '/fixture/evidence');
    check(afterAuthority.data.generationCalls.length === 0, 'restarted process performs no model regeneration');
    check(JSON.stringify(afterAuthority.data.authority) === JSON.stringify(beforeAuthority.data.authority), 'every durable authority table retains the same rows and hashes after reads and repeated approval');
    check(JSON.stringify(fileSnapshot()) === JSON.stringify(beforeFiles), 'restart/repeated approval preserves file contents, inodes and modification times');
    check(git(root, ['rev-parse', 'HEAD']) === beforeHead && git(root, ['status', '--porcelain=v1']) === '', 'restart/repeated approval preserves exact Git HEAD and clean state');
    evidence.resultDigest = completed.data.terminal.resultDigest;
    evidence.lifecycleId = planned.data.lifecycleId;
    evidence.databasePath = server.ready.databasePath;
    evidence.terminalState = durable.data.state;
    evidence.authorityBefore = beforeAuthority.data.authority;
    evidence.authorityAfter = afterAuthority.data.authority;
    evidence.fileSnapshot = beforeFiles;
    evidence.finalHead = beforeHead;
    evidence.modelFixtureCalls = beforeAuthority.data.generationCalls;
    evidence.modelFixtureCallsAfterRestart = afterAuthority.data.generationCalls;
    evidence.status = 'PASS';
  } catch (error) {
    evidence.status = 'FAIL'; evidence.error = error.stack || error.message;
    throw error;
  } finally {
    if (server) {
      evidence.lastServerOutput = server.output();
      evidence.lastExit = await stopControlledM2HttpFixture(server);
      if (evidence.lastExit.code !== 0 || evidence.lastExit.signal !== null || evidence.lastExit.forced) {
        evidence.status = 'FAIL';
        assert(false, 'controlled HTTP restarted fixture must exit cleanly');
      }
    }
    fs.writeFileSync(path.join(fixtureRoot, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
    console.log(`  Controlled fixture evidence: ${path.join(fixtureRoot, 'evidence.json')}`);
  }
}

async function run() {
  if (typeof HOME !== 'string' || !path.isAbsolute(HOME)) {
    throw new Error('The lifecycle E2E requires an absolute isolated HOME');
  }
  const projectsRoot = path.join(HOME, 'm2-lifecycle-e2e');
  fs.mkdirSync(projectsRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(projectsRoot, 'project-'));

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║    IntentSmith: M2 Lifecycle HTTP Authority E2E         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  try {
    const health = await request('GET', '/api/health');
    assert(health.status === 200 && health.data?.status === 'ok', 'owned server health is ready');

    const created = await request('POST', '/api/projects', {
      name: RUN_ID,
      description: 'Isolated M2 lifecycle HTTP evidence project',
      type: 'general',
      path: root,
    });
    assert(created.status === 201, `project registration returned 201 (got ${created.status})`);
    const projectId = created.data?.project?.id;
    assert(Number.isSafeInteger(projectId), `project registry returned an integer id (${projectId})`);
    if (!Number.isSafeInteger(projectId)) throw new Error('Project registration did not return an id');

    writeGovernanceFixture(root);
    const origin = {
      surface: 'http',
      sessionId: RUN_ID,
      conversationId: RUN_ID,
      projectId,
    };

    const rejectedDraft = await request('POST', '/api/m2/lifecycle/draft', {
      projectId, origin,
      draft: { path: '../outside.js', instruction: 'Change value to 42' },
      projectPath: '/forged',
    });
    assert(rejectedDraft.status === 400 && rejectedDraft.data?.code === 'M2_PROPOSAL_CHANGE_PATH_INVALID',
      'production draft HTTP endpoint rejects traversal before model invocation');
    assert(fs.readFileSync(path.join(root, 'src/app.js'), 'utf8') === 'module.exports = { value: 1 };\n',
      'rejected draft preserves the original file');

    for (const [draft, expected] of [
      [{ paths: ['src/app.js', '../outside.js'], instruction: 'Update both.' }, 'M2_PROPOSAL_CHANGE_PATH_INVALID'],
      [{ paths: ['src/app.js', 'src/app.js'], instruction: 'Update both.' }, 'M2_PROPOSAL_CHANGE_PATH_DUPLICATE'],
      [{ paths: ['src/app.js', '.c3/private.js'], instruction: 'Update both.' }, 'M2_CODE_DRAFT_PATH_INVALID'],
    ]) {
      const invalid = await request('POST', '/api/m2/lifecycle/draft', { projectId, origin, draft });
      assert(invalid.status === 400 && invalid.data?.code === expected,
        `production HTTP rejects multi-file scope before inference: ${expected}`);
    }


    for (const [draft, expected] of [
      [{ instruction: 'Build.', files: [{ path: 'src/app.js', instruction: 'Export.', dependsOn: [] }] }, 'M2_CODE_DRAFT_INPUT_INVALID'],
      [{ instruction: 'Build.', files: [{ path: 'src/app.js', instruction: 'Export.', dependsOn: ['src/app.js'] }], focusedTest: proposal().focusedTest }, 'M2_CODE_DRAFT_DEPENDENCY_CYCLE'],
      [{ instruction: 'Build.', files: [{ path: 'src/app.js', instruction: 'Export.', dependsOn: ['src/unknown.js'] }], focusedTest: proposal().focusedTest }, 'M2_CODE_DRAFT_INPUT_INVALID'],
    ]) {
      const invalid = await request('POST', '/api/m2/lifecycle/draft', { projectId, origin, draft });
      assert(invalid.status === 400 && invalid.data?.code === expected,
        `production HTTP rejects incomplete or cyclic blueprint before inference: ${expected}`);
    }

    const prepared = await request('POST', '/api/m2/lifecycle/prepare', {
      projectId,
      origin,
      proposal: proposal(),
    });
    assert(prepared.status === 200, `prepare returned 200 (got ${prepared.status})`);
    assert(prepared.data?.state === 'awaiting_approval', 'prepare produced awaiting_approval');
    assert(typeof prepared.data?.lifecycleId === 'string', 'prepare returned lifecycle identity');
    assert(/^sha256:[0-9a-f]{64}$/.test(prepared.data?.planDigest || ''), 'prepare returned exact plan digest');
    assert(prepared.data?.audit?.governanceDecision?.verdict === 'allow', 'pre-effect governance allowed exact material');
    if (prepared.status !== 200 || typeof prepared.data?.lifecycleId !== 'string') {
      throw new Error(`Prepare failed: ${JSON.stringify(prepared.data).slice(0, 500)}`);
    }

    const statusQuery = new URLSearchParams({
      id: prepared.data.lifecycleId,
      surface: origin.surface,
      sessionId: origin.sessionId,
      conversationId: origin.conversationId,
      projectId: String(projectId),
    });
    const pending = await request('GET', `/api/m2/lifecycle/status?${statusQuery}`);
    assert(pending.status === 200 && pending.data?.state === 'awaiting_approval', 'status preserves the pending plan');

    const completed = await request('POST', '/api/m2/lifecycle/approve', {
      lifecycleId: prepared.data.lifecycleId,
      planDigest: prepared.data.planDigest,
      origin,
    });
    assert(completed.status === 200, `exact approval returned 200 (got ${completed.status})`);
    assert(completed.data?.state === 'succeeded', 'lifecycle reached succeeded terminal');
    assert(completed.data?.result?.terminalStatus === 'succeeded', 'project change terminal is succeeded');
    assert(completed.data?.result?.focusedTest?.terminalStatus === 'succeeded', 'focused test terminal is succeeded');
    assert(completed.data?.result?.git?.status === 'committed', 'exact Git commit completed');
    assert(completed.data?.audit?.governanceReceipt?.status === 'accepted', 'post-result governance receipt is accepted');
    assert(
      fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8') === 'module.exports = { value: 2 };\n',
      'approved bytes are on disk',
    );
    assert(git(root, ['status', '--porcelain=v1']) === '', 'fixture Git worktree is clean after exact commit');

    const durable = await request('GET', `/api/m2/lifecycle/status?${statusQuery}`);
    assert(durable.status === 200 && durable.data?.state === 'succeeded', 'durable status returns the same terminal');
    assert(
      durable.data?.terminal?.resultDigest === completed.data?.terminal?.resultDigest,
      'durable status preserves the exact result digest',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // Separate controlled composition: preserve the original production-server
  // checks above and join generation/approval/effects with a real process restart.
  await controlledHttpBuildRestart(false);
  await controlledHttpBuildRestart(true);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  M2 Lifecycle HTTP E2E: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
  console.log('══════════════════════════════════════════════════════════');
  if (failed > 0) console.log(`❌ Failures: ${failures.join(', ')}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run().catch(error => {
  console.error('M2 lifecycle HTTP E2E error:', error.stack || error.message);
  process.exitCode = 1;
});
