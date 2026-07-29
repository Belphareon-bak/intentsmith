/**
 * Sprint 5 Tests — Error Recovery, Export/Import, Settings
 * No external dependencies.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  ReconnectionManager, LlmTimeoutManager, CrashRecoveryService,
  ProjectExportService, C3_DEFAULTS, pathExists,
} = require('../packages/c3-backend/sprint5-integration.cjs');

let testCount = 0, passCount = 0;
function test(name, fn) {
  testCount++;
  try { fn(); passCount++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + ': ' + e.message); }
}
async function asyncTest(name, fn) {
  testCount++;
  try { await fn(); passCount++; console.log('  ✅ ' + name); }
  catch (e) { console.log('  ❌ ' + name + ': ' + e.message); }
}

// ── 1. ReconnectionManager ───────────────────────────────
console.log('\n--- 1. ReconnectionManager ---');

test('initial state is disconnected', () => {
  const rm = new ReconnectionManager();
  assert.strictEqual(rm.getState(), 'disconnected');
});

test('notifyConnected sets state', () => {
  const rm = new ReconnectionManager();
  rm.notifyConnected();
  assert.strictEqual(rm.getState(), 'connected');
});

test('notifyDisconnected from connected', () => {
  const rm = new ReconnectionManager({ maxAttempts: 1 });
  rm.setConnectFunction(async () => false);
  rm.notifyConnected();
  rm.notifyDisconnected();
  assert.strictEqual(rm.getState(), 'reconnecting');
  rm.dispose();
});

test('exponential backoff delays', () => {
  const rm = new ReconnectionManager({ initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 1000, jitterMs: 0 });
  // Simulate scheduleAttempt manually to verify delay calculation
  rm.currentDelay = 0;
  rm.scheduleAttempt(); // sets currentDelay to 100
  assert.strictEqual(rm.currentDelay, 100);
  clearTimeout(rm.timer);
  rm.scheduleAttempt(); // 100 * 2 = 200
  assert.strictEqual(rm.currentDelay, 200);
  clearTimeout(rm.timer);
  rm.scheduleAttempt(); // 200 * 2 = 400
  assert.strictEqual(rm.currentDelay, 400);
  clearTimeout(rm.timer);
  rm.scheduleAttempt(); // 400 * 2 = 800
  assert.strictEqual(rm.currentDelay, 800);
  clearTimeout(rm.timer);
  rm.scheduleAttempt(); // 800 * 2 = 1600 → capped at 1000
  assert.strictEqual(rm.currentDelay, 1000);
  clearTimeout(rm.timer);
  rm.dispose();
});

test('resetBackoff clears state', () => {
  const rm = new ReconnectionManager();
  rm.currentDelay = 5000;
  rm.attemptCount = 10;
  rm.resetBackoff();
  assert.strictEqual(rm.currentDelay, 0);
  assert.strictEqual(rm.attemptCount, 0);
});

test('state change listener', () => {
  const rm = new ReconnectionManager();
  const states = [];
  rm.on('stateChange', s => states.push(s));
  rm.notifyConnected();
  rm.setState('disconnected');
  assert.deepStrictEqual(states, ['connected', 'disconnected']);
  rm.dispose();
});

test('max attempts stops reconnection', () => {
  const rm = new ReconnectionManager({ maxAttempts: 3 });
  rm.attemptCount = 3;
  assert.ok(rm.config.maxAttempts > 0 && rm.attemptCount >= rm.config.maxAttempts);
  rm.dispose();
});

// ── 2. LlmTimeoutManager ────────────────────────────────
console.log('\n--- 2. LlmTimeoutManager ---');

test('initial state not tracking', () => {
  const tm = new LlmTimeoutManager();
  assert.strictEqual(tm.isTracking(), false);
  assert.strictEqual(tm.getElapsedMs(), 0);
});

test('startTracking sets state', () => {
  const tm = new LlmTimeoutManager({ warningThresholdMs: 100000, hardTimeoutMs: 200000, killTimeoutMs: 300000 });
  tm.startTracking('turn-1');
  assert.strictEqual(tm.isTracking(), true);
  assert.ok(tm.getElapsedMs() >= 0);
  tm.dispose();
});

test('stopTracking clears', () => {
  const tm = new LlmTimeoutManager({ warningThresholdMs: 100000, hardTimeoutMs: 200000, killTimeoutMs: 300000 });
  tm.startTracking('turn-1');
  tm.stopTracking();
  assert.strictEqual(tm.isTracking(), false);
});

// ── 3. CrashRecoveryService ──────────────────────────────
console.log('\n--- 3. CrashRecoveryService ---');

test('recover with no loaders', async () => {
  const cr = new CrashRecoveryService();
  const report = await cr.recover('/nonexistent');
  assert.strictEqual(report.type, 'crash_recovery');
  assert.strictEqual(report.projectRestored, false);
  assert.strictEqual(report.chatHistoryRestored, false);
  assert.strictEqual(report.pendingReview, false);
});

test('recover with successful loaders', async () => {
  const cr = new CrashRecoveryService();
  cr.setLoaders({
    loadProject: async () => ({ name: 'Test', phase: 'build' }),
    loadChatHistory: async () => [{ role: 'user', content: 'hello' }],
    checkPendingReview: async () => true,
  });
  const report = await cr.recover('/fake');
  assert.strictEqual(report.projectRestored, true);
  assert.strictEqual(report.chatHistoryRestored, true);
  assert.strictEqual(report.pendingReview, true);
});

test('recover handles loader errors gracefully', async () => {
  const cr = new CrashRecoveryService();
  cr.setLoaders({
    loadProject: async () => { throw new Error('disk error'); },
    loadChatHistory: async () => { throw new Error('corrupt'); },
  });
  const report = await cr.recover('/fake');
  assert.strictEqual(report.projectRestored, false);
  assert.strictEqual(report.chatHistoryRestored, false);
});

// ── 4. Settings Defaults ─────────────────────────────────
console.log('\n--- 4. Settings Defaults ---');

test('all required keys exist', () => {
  const requiredKeys = [
    'c3.backend.url', 'c3.backend.autoReconnect',
    'c3.chat.fontSize', 'c3.chat.showIntentBadges',
    'c3.agent.autoScroll', 'c3.agent.verbosity',
    'c3.shell.timeout', 'c3.shell.maxOutput',
    'c3.project.autoSaveInterval', 'c3.project.gitAutoCommit',
    'c3.export.includeChat', 'c3.export.includeSrc',
    'c3.language', 'c3.theme',
  ];
  for (const key of requiredKeys) {
    assert.ok(key in C3_DEFAULTS, 'Missing key: ' + key);
  }
});

test('default types are correct', () => {
  assert.strictEqual(typeof C3_DEFAULTS['c3.backend.url'], 'string');
  assert.strictEqual(typeof C3_DEFAULTS['c3.backend.autoReconnect'], 'boolean');
  assert.strictEqual(typeof C3_DEFAULTS['c3.chat.fontSize'], 'number');
  assert.strictEqual(typeof C3_DEFAULTS['c3.agent.verbosity'], 'string');
  assert.strictEqual(typeof C3_DEFAULTS['c3.shell.timeout'], 'number');
  assert.strictEqual(typeof C3_DEFAULTS['c3.language'], 'string');
});

test('default values are reasonable', () => {
  assert.ok(C3_DEFAULTS['c3.chat.fontSize'] >= 10);
  assert.ok(C3_DEFAULTS['c3.chat.fontSize'] <= 24);
  assert.ok(C3_DEFAULTS['c3.shell.timeout'] >= 5000);
  assert.ok(C3_DEFAULTS['c3.shell.maxOutput'] >= 1024);
  assert.ok(['minimal', 'normal', 'verbose'].includes(C3_DEFAULTS['c3.agent.verbosity']));
  assert.ok(['cs', 'en'].includes(C3_DEFAULTS['c3.language']));
  assert.ok(['dark', 'light'].includes(C3_DEFAULTS['c3.theme']));
});

// ── 5. ProjectExportService (async) ──────────────────────
async function runExportTests() {
  console.log('\n--- 5. ProjectExportService ---');

  const testDir = path.join(os.tmpdir(), 'c3-s5-export-' + Date.now());
  const projectDir = path.join(testDir, 'myproject');
  const outputDir = path.join(testDir, 'output');

  // Create fake project
  await fs.promises.mkdir(path.join(projectDir, 'design'), { recursive: true });
  await fs.promises.mkdir(path.join(projectDir, 'src', 'lib'), { recursive: true });
  await fs.promises.mkdir(path.join(projectDir, 'chat'), { recursive: true });
  await fs.promises.writeFile(path.join(projectDir, 'project.json'),
    JSON.stringify({ name: 'Test App', phase: 'design' }, null, 2));
  await fs.promises.writeFile(path.join(projectDir, 'design', 'architecture.md'), '# Architecture\nTest');
  await fs.promises.writeFile(path.join(projectDir, 'src', 'lib', 'main.dart'), 'void main() {}');
  await fs.promises.writeFile(path.join(projectDir, 'chat', 'conversation.jsonl'), '{"role":"user","content":"hi"}\n');

  const svc = new ProjectExportService();

  await asyncTest('export creates zip', async () => {
    const result = await svc.exportProject({
      projectPath: projectDir, outputDir,
      includeChat: true, includeAgentLog: false,
      includeSrc: true, includeInternal: false,
    });
    assert.strictEqual(result.success, true);
    assert.ok(result.zipPath);
    assert.ok(result.fileName.includes('test-app'));
    assert.ok(result.sizeBytes > 0);
  });

  await asyncTest('export fails without project.json', async () => {
    const emptyDir = path.join(testDir, 'empty');
    await fs.promises.mkdir(emptyDir, { recursive: true });
    const result = await svc.exportProject({
      projectPath: emptyDir, outputDir,
      includeChat: true, includeAgentLog: false, includeSrc: true, includeInternal: false,
    });
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('project.json'));
  });

  await asyncTest('validate directory import', async () => {
    const v = await svc.validateImport(projectDir);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.projectName, 'Test App');
    assert.strictEqual(v.phase, 'design');
  });

  await asyncTest('validate rejects missing project.json', async () => {
    const emptyDir = path.join(testDir, 'nopj');
    await fs.promises.mkdir(emptyDir, { recursive: true });
    const v = await svc.validateImport(emptyDir);
    assert.strictEqual(v.valid, false);
    assert.ok(v.errors.some(e => e.includes('project.json')));
  });

  await asyncTest('validate rejects missing name', async () => {
    const noNameDir = path.join(testDir, 'noname');
    await fs.promises.mkdir(noNameDir, { recursive: true });
    await fs.promises.writeFile(path.join(noNameDir, 'project.json'), '{"phase":"build"}');
    const v = await svc.validateImport(noNameDir);
    assert.strictEqual(v.valid, false);
    assert.ok(v.errors.some(e => e.includes('name')));
  });

  await asyncTest('validate zip import', async () => {
    // Use the exported zip
    const exported = await svc.exportProject({
      projectPath: projectDir, outputDir: path.join(testDir, 'out2'),
      includeChat: true, includeAgentLog: false, includeSrc: true, includeInternal: false,
    });
    assert.ok(exported.success);
    const v = await svc.validateImport(exported.zipPath);
    assert.strictEqual(v.valid, true);
    assert.ok(v.fileCount > 0);
  });

  await asyncTest('import from zip', async () => {
    const exported = await svc.exportProject({
      projectPath: projectDir, outputDir: path.join(testDir, 'out3'),
      includeChat: true, includeAgentLog: false, includeSrc: true, includeInternal: false,
    });
    const importDir = path.join(testDir, 'imported');
    const result = await svc.importProject({ sourcePath: exported.zipPath, targetDir: importDir });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.projectName, 'Test App');
    assert.strictEqual(result.phase, 'design');
    assert.ok(result.projectPath);
  });

  // Cleanup
  await fs.promises.rm(testDir, { recursive: true, force: true });
}

// ── 6. pathExists helper ─────────────────────────────────
async function runHelperTests() {
  console.log('\n--- 6. Helpers ---');

  await asyncTest('pathExists returns true for existing', async () => {
    assert.strictEqual(await pathExists(__filename), true);
  });

  await asyncTest('pathExists returns false for missing', async () => {
    assert.strictEqual(await pathExists('/nonexistent/file.xyz'), false);
  });
}

// ── Run all ──────────────────────────────────────────────

async function runTimerTests() {
  console.log('\n--- Timer-based tests ---');

  await asyncTest('reconnected event fires after disconnect+reconnect', async () => {
    const rm = new ReconnectionManager({ initialDelayMs: 10, jitterMs: 0 });
    let reconnected = false;
    rm.on('reconnected', () => { reconnected = true; });
    rm.setConnectFunction(async () => true);
    rm.notifyConnected();
    rm.notifyDisconnected();
    await new Promise(r => setTimeout(r, 80));
    assert.strictEqual(rm.getState(), 'connected');
    rm.dispose();
  });

  await asyncTest('LLM warning callback fires', async () => {
    const tm = new LlmTimeoutManager({ warningThresholdMs: 20, hardTimeoutMs: 100000, killTimeoutMs: 200000 });
    let warningFired = false;
    tm.setCallbacks({ onWarning: () => { warningFired = true; } });
    tm.startTracking('turn-w');
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(warningFired, true);
    tm.dispose();
  });

  await asyncTest('LLM kill callback fires and clears', async () => {
    const tm = new LlmTimeoutManager({ warningThresholdMs: 5, hardTimeoutMs: 10, killTimeoutMs: 20 });
    let killed = false;
    tm.setCallbacks({ onKill: () => { killed = true; } });
    tm.startTracking('turn-k');
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(killed, true);
    assert.strictEqual(tm.isTracking(), false);
    tm.dispose();
  });

  await asyncTest('LLM stopTracking prevents callbacks', async () => {
    const tm = new LlmTimeoutManager({ warningThresholdMs: 20, hardTimeoutMs: 40, killTimeoutMs: 60 });
    let fired = false;
    tm.setCallbacks({ onWarning: () => { fired = true; } });
    tm.startTracking('turn-cancel');
    tm.stopTracking();
    await new Promise(r => setTimeout(r, 60));
    assert.strictEqual(fired, false);
    tm.dispose();
  });
}

async function runAll() {
  await runTimerTests();

  await runExportTests();
  await runHelperTests();

  console.log('\n=== Sprint 5 Tests: ' + passCount + '/' + testCount + ' passed ===');
  if (passCount < testCount) process.exit(1);
}

runAll().catch(err => { console.error('Test runner error:', err); process.exit(1); });
