// Sandbox v46.0 Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for tool sandboxing:
// - Capability manifest
// - Scope validation
// - Dry-run mode
// - Approval gates
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  Capability,
  RiskLevel,
  getToolCapabilities,
  requiresApproval,
  hasSideEffects,
  supportsDryRun,
  isPathAllowed,
  listTools,
} from '../src/sandbox/capabilities.js';

import {
  SandboxedExecutor,
  SandboxMode,
} from '../src/sandbox/executor.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Sandbox v46.0 Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Capability Manifest
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Capability Manifest');

test('Capability enum has filesystem capabilities', () => {
  assertTrue(Capability.FS_READ, 'Has FS_READ');
  assertTrue(Capability.FS_WRITE, 'Has FS_WRITE');
  assertTrue(Capability.FS_DELETE, 'Has FS_DELETE');
});

test('Capability enum has network capabilities', () => {
  assertTrue(Capability.NET_HTTP_GET, 'Has NET_HTTP_GET');
  assertTrue(Capability.NET_HTTP_POST, 'Has NET_HTTP_POST');
});

test('RiskLevel enum has all levels', () => {
  assertEqual(RiskLevel.SAFE, 'safe', 'SAFE');
  assertEqual(RiskLevel.LOW, 'low', 'LOW');
  assertEqual(RiskLevel.MEDIUM, 'medium', 'MEDIUM');
  assertEqual(RiskLevel.HIGH, 'high', 'HIGH');
  assertEqual(RiskLevel.CRITICAL, 'critical', 'CRITICAL');
});

test('getToolCapabilities returns capabilities for known tool', () => {
  const caps = getToolCapabilities('web.search');
  assertTrue(caps !== null, 'Has capabilities');
  assertTrue(caps.requires.includes(Capability.NET_HTTP_GET), 'Requires NET_HTTP_GET');
  assertEqual(caps.riskLevel, RiskLevel.SAFE, 'Risk level');
  assertEqual(caps.sideEffects, false, 'No side effects');
});

test('getToolCapabilities returns null for unknown tool', () => {
  const caps = getToolCapabilities('unknown.tool');
  assertEqual(caps, null, 'Should be null');
});

test('listTools returns all registered tools', () => {
  const tools = listTools();
  assertTrue(tools.length > 0, 'Has tools');
  assertTrue(tools.some(t => t.name === 'web.search'), 'Has web.search');
  assertTrue(tools.some(t => t.name === 'fs.write'), 'Has fs.write');
});

// ────────────────────────────────────────────────────────────────────────────
// Risk Assessment
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Risk Assessment');

test('web.search is safe (no approval needed)', () => {
  assertEqual(requiresApproval('web.search'), false, 'No approval');
  assertEqual(hasSideEffects('web.search'), false, 'No side effects');
});

test('fs.write requires approval', () => {
  assertEqual(requiresApproval('fs.write'), true, 'Requires approval');
  assertEqual(hasSideEffects('fs.write'), true, 'Has side effects');
});

test('fs.read does not require approval', () => {
  assertEqual(requiresApproval('fs.read'), false, 'No approval');
  assertEqual(hasSideEffects('fs.read'), false, 'No side effects');
});

test('unknown tool defaults to high risk', () => {
  // Uses default behavior
  assertEqual(requiresApproval('some.unknown'), true, 'Requires approval by default');
  assertEqual(hasSideEffects('some.unknown'), true, 'Has side effects by default');
});

// ────────────────────────────────────────────────────────────────────────────
// Scope Validation
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Scope Validation');

test('fs.read allows paths in ./data scope', () => {
  assertTrue(isPathAllowed('fs.read', './data/test.txt'), './data path');
  assertTrue(isPathAllowed('fs.read', 'data/test.txt'), 'data path');
});

test('fs.read allows paths in /tmp scope', () => {
  assertTrue(isPathAllowed('fs.read', '/tmp/test.txt'), '/tmp path');
});

test('fs.write allows paths in ./projects scope', () => {
  assertTrue(isPathAllowed('fs.write', './projects/myproject/file.js'), './projects path');
});

test('web.search has no scope restrictions', () => {
  assertTrue(isPathAllowed('web.search', '/any/path'), 'Any path allowed');
});

// ────────────────────────────────────────────────────────────────────────────
// Dry-Run Support
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Dry-Run Support');

test('most tools support dry-run', () => {
  assertTrue(supportsDryRun('web.search'), 'web.search');
  assertTrue(supportsDryRun('fs.write'), 'fs.write');
  assertTrue(supportsDryRun('fs.read'), 'fs.read');
  assertTrue(supportsDryRun('data.parse'), 'data.parse');
});

// ────────────────────────────────────────────────────────────────────────────
// Sandboxed Executor
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Sandboxed Executor');

test('executor can be created with custom mode', () => {
  const executor = new SandboxedExecutor({ mode: SandboxMode.STRICT });
  assertEqual(executor.mode, SandboxMode.STRICT, 'Mode is STRICT');
});

test('executor can grant capabilities', () => {
  const executor = new SandboxedExecutor();
  executor.grantCapability(Capability.FS_WRITE);

  const status = executor.getStatus();
  assertTrue(status.grantedCapabilities.includes(Capability.FS_WRITE), 'Has FS_WRITE');
});

test('executor can approve tools', () => {
  const executor = new SandboxedExecutor();
  executor.approveTool('fs.write');

  const status = executor.getStatus();
  assertTrue(status.approvedTools.includes('fs.write'), 'Has fs.write approved');
});

test('executor can reset approvals', () => {
  const executor = new SandboxedExecutor();
  executor.approveTool('fs.write');
  executor.resetApprovals();

  const status = executor.getStatus();
  assertEqual(status.approvedTools.length, 0, 'No approvals');
});

test('SandboxMode has all modes', () => {
  assertTrue(SandboxMode.STRICT, 'Has STRICT');
  assertTrue(SandboxMode.NORMAL, 'Has NORMAL');
  assertTrue(SandboxMode.PERMISSIVE, 'Has PERMISSIVE');
  assertTrue(SandboxMode.DRY_RUN, 'Has DRY_RUN');
});

await asyncTest('executor rejects unknown tool', async () => {
  const executor = new SandboxedExecutor();
  const result = await executor.execute({ tool: 'unknown.tool', params: {} });

  assertEqual(result.ok, false, 'Not ok');
  assertEqual(result.code, 'UNKNOWN_TOOL', 'Error code');
});

await asyncTest('executor dry-run mode returns simulation', async () => {
  const executor = new SandboxedExecutor({ mode: SandboxMode.DRY_RUN });
  executor.grantCapability(Capability.NET_HTTP_GET);

  const result = await executor.execute({
    tool: 'web.search',
    params: { query: 'test' },
  });

  assertEqual(result.ok, true, 'Ok');
  assertEqual(result.dry_run, true, 'Is dry-run');
  assertTrue(result.simulated, 'Has simulated result');
  assertTrue(result.simulated.would_search, 'Simulated search');
});

await asyncTest('executor checks capabilities', async () => {
  const executor = new SandboxedExecutor();
  // Don't grant FS_WRITE capability

  const result = await executor.execute({
    tool: 'fs.write',
    params: { path: './data/test.txt', content: 'test' },
  });

  assertEqual(result.ok, false, 'Not ok');
  assertEqual(result.code, 'CAPABILITY_DENIED', 'Capability denied');
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('Failed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}
