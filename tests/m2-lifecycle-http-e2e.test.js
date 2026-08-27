#!/usr/bin/env node

// Current lifecycle HTTP E2E. The retired free-text/model lifecycle is
// deliberately not exercised: the only mutating authority is the strict M2
// prepare -> exact approval -> terminal chain.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
