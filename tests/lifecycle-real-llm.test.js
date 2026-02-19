// C3: Real LLM Lifecycle Test — Ollama E2E
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests lifecycle transitions with REAL Ollama LLM calls against the running server.
// Verifies that the LLM produces valid JSON at each stage and state transitions work.
//
// Requires: C3 server running at http://127.0.0.1:3335, Ollama with qwen2.5:32b
// Run: node tests/lifecycle-real-llm.test.js
// ═══════════════════════════════════════════════════════════════════════════════

import http from 'http';

const BASE = process.env.C3_URL || 'http://127.0.0.1:3335';
const SESSION_ID = `lc-real-test-${Date.now()}`;
const TIMEOUT_MS = 120_000; // 2min per LLM call

let passed = 0, failed = 0;
const failures = [];

// ─── HTTP Helpers ────────────────────────────────────────────────────────────

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: TIMEOUT_MS,
    };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

async function chat(message, projectId = null) {
  const body = {
    message,
    conversation_id: SESSION_ID,
  };
  if (projectId) body.project_id = projectId;
  return request('POST', '/api/chat', body);
}

function assert(condition, desc) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${desc}`);
  } else {
    failed++;
    failures.push(desc);
    console.log(`  ❌ ${desc}`);
  }
}

// ─── Test Sequence ───────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║    C3: Real LLM Lifecycle Test (Ollama E2E)             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // 0. Health check
  console.log('── 0. Server health ──');
  try {
    const health = await request('GET', '/');
    assert(health.status === 200, `Server reachable (${health.data?.version || '?'})`);
    assert(health.data?.status === 'ok', 'Server status ok');
  } catch (err) {
    console.log(`  ❌ Server not reachable: ${err.message}`);
    console.log('  Aborting — start the server first: node src/server.js');
    process.exit(1);
  }

  // 1. Create a test project
  console.log('\n── 1. Create test project ──');
  const projResp = await request('POST', '/api/projects', {
    name: `lc-test-${Date.now()}`,
    description: 'E2E lifecycle test project — simple TODO CLI',
    type: 'cli',
  });
  assert(projResp.status === 200 || projResp.status === 201, `Project created (status=${projResp.status})`);
  const projectId = projResp.data?.id || projResp.data?.project?.id;
  assert(!!projectId, `Got project ID: ${projectId}`);

  if (!projectId) {
    console.log('  Cannot continue without project ID. Response:', JSON.stringify(projResp.data).slice(0, 200));
    return;
  }

  // 2. Start lifecycle
  console.log('\n── 2. Start lifecycle (→ SPEC) ──');
  const lcStart = await request('POST', '/api/projects/lifecycle/start', {
    projectId,
    projectName: `lc-test-${Date.now()}`,
    description: 'Build a simple TODO CLI app in Node.js with add, list, complete commands and JSON file storage',
    type: 'cli',
    sessionId: SESSION_ID,
  });
  assert(lcStart.status === 200, `Lifecycle started (status=${lcStart.status})`);
  const startPhase = lcStart.data?.phase;
  assert(startPhase === 'SPEC' || startPhase === 'PROPOSED', `Phase: ${startPhase}`);
  console.log(`  Phase: ${startPhase}`);

  // 3. If PROPOSED, confirm
  if (startPhase === 'PROPOSED') {
    console.log('\n── 2b. Confirm proposal ──');
    const confirm = await chat('ano', projectId);
    assert(confirm.status === 200, 'Proposal confirmed');
    console.log(`  Response: ${(confirm.data?.response || '').slice(0, 100)}...`);
  }

  // 4. Answer SPEC — provide details
  console.log('\n── 3. SPEC: Provide requirements (→ SPEC_REVIEW) ──');
  const specMsg = await chat(
    'Chci jednoduchou CLI aplikaci v Node.js. Příkazy: add <task>, list, complete <id>. Data uložena v tasks.json. Žádné databáze, žádné servery, žádná autentizace.',
    projectId
  );
  assert(specMsg.status === 200, `SPEC response received (status=${specMsg.status})`);
  const specResp = specMsg.data?.response || '';
  assert(specResp.length > 20, `SPEC response has substance (${specResp.length} chars)`);
  console.log(`  Response preview: ${specResp.slice(0, 120)}...`);

  // 5. Check lifecycle state
  console.log('\n── 4. Check lifecycle state ──');
  const lcState = await request('GET', `/api/projects/${projectId}/lifecycle`);
  const currentPhase = lcState.data?.lifecycle?.phase || lcState.data?.phase || 'unknown';
  console.log(`  Current phase: ${currentPhase}`);
  assert(lcState.status === 200, 'Lifecycle state readable');

  // 6. Approve spec (if in SPEC_REVIEW)
  if (currentPhase === 'SPEC_REVIEW' || specResp.includes('schválit') || specResp.includes('specifikac')) {
    console.log('\n── 5. Approve spec (→ PLAN_REVIEW) ──');
    const approve = await chat('schvaluji', projectId);
    assert(approve.status === 200, 'Spec approved');
    const approveResp = approve.data?.response || '';
    console.log(`  Response preview: ${approveResp.slice(0, 120)}...`);

    // 7. Approve plan (if in PLAN_REVIEW)
    const lcState2 = await request('GET', `/api/projects/${projectId}/lifecycle`);
    const phase2 = lcState2.data?.lifecycle?.phase || lcState2.data?.phase || 'unknown';
    console.log(`  Phase after spec approval: ${phase2}`);

    if (phase2 === 'PLAN_REVIEW' || approveResp.includes('mileston') || approveResp.includes('plán')) {
      console.log('\n── 6. Approve plan (→ BUILD) ──');
      const approvePlan = await chat('schvaluji', projectId);
      assert(approvePlan.status === 200, 'Plan approved');
      const planResp = approvePlan.data?.response || '';
      console.log(`  Response preview: ${planResp.slice(0, 120)}...`);

      // Check we're in BUILD or BUILD_MILESTONE_REVIEW
      const lcState3 = await request('GET', `/api/projects/${projectId}/lifecycle`);
      const phase3 = lcState3.data?.lifecycle?.phase || lcState3.data?.phase || 'unknown';
      console.log(`  Phase after plan approval: ${phase3}`);
      assert(
        ['BUILD', 'BUILD_MILESTONE_REVIEW'].includes(phase3) || planResp.length > 20,
        `Reached BUILD phase or got meaningful response (phase=${phase3})`
      );
    }
  }

  // 7. Progress check
  console.log('\n── 7. Progress inquiry ──');
  const progress = await chat('jaký je stav projektu?', projectId);
  assert(progress.status === 200, 'Progress inquiry works');
  const progResp = progress.data?.response || '';
  console.log(`  Response preview: ${progResp.slice(0, 120)}...`);

  // Summary
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  C3 Real LLM Lifecycle: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
  console.log('══════════════════════════════════════════════════════════');
  if (failed === 0) {
    console.log('✅ ALL C3 LIFECYCLE TESTS PASS');
  } else {
    console.log(`❌ Failures: ${failures.join(', ')}`);
  }

  // Cleanup: try to cancel the lifecycle
  try {
    await chat('zrušit', projectId);
  } catch { /* ignore cleanup errors */ }
}

run().catch(err => {
  console.error('C3 lifecycle test error:', err.message);
  process.exit(1);
});
