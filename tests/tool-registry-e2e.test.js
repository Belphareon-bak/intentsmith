// tests/tool-registry-e2e.test.js — E2E tests for tool registry
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
//   1. Registry structure & API
//   2. Metadata integrity for ALL tools
//   3. Risk classification & query methods
//   4. Execute safe tools (pure/read category)
//   5. Structural tools (profiling, api, deps, guards)
//
// Run: node tests/tool-registry-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';
import { toolRegistry as registry } from '../src/tools/registry.js';
import { runNpmAuditReport } from '../src/tools/npm-audit.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ═══════════════════════════════════════════════════════════════════════════
// 1. REGISTRY STRUCTURE & API
// ═══════════════════════════════════════════════════════════════════════════

suite('Registry — Structure');

test('registry is an object with tools', () => {
  assert(registry, 'registry exists');
  const list = registry.list();
  assert(Array.isArray(list), 'list() returns array');
  assert(list.length >= 150, `Expected >= 150 tools, got ${list.length}`);
});

test('get() returns tool definition', () => {
  const tool = registry.get('math.eval');
  assert(tool, 'math.eval exists');
  assertEqual(tool.name, 'math.eval');
  assert(typeof tool.description === 'string', 'has description');
  assert(typeof tool.execute === 'function', 'has execute fn');
  assert(tool.params, 'has params');
  assert(Array.isArray(tool.params.required), 'has required params');
  assert(Array.isArray(tool.params.optional), 'has optional params');
  assert(Array.isArray(tool.permissions), 'has permissions');
});

test('has() checks existence', () => {
  assert(registry.has('fs.read'), 'fs.read exists');
  assert(registry.has('git.status'), 'git.status exists');
  assert(!registry.has('nonexistent.tool'), 'nonexistent returns false');
});

test('list() returns all tool names', () => {
  const list = registry.list();
  assert(list.includes('math.eval'), 'includes math.eval');
  assert(list.includes('fs.read'), 'includes fs.read');
  assert(list.includes('guard.watchdog'), 'includes guard.watchdog');
  assert(list.includes('profile.cpu'), 'includes profile.cpu');
});

test('get() returns undefined for missing tool', () => {
  assertEqual(registry.get('does.not.exist'), undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. METADATA INTEGRITY — ALL TOOLS
// ═══════════════════════════════════════════════════════════════════════════

suite('Registry — Metadata Integrity');

const VALID_CATEGORIES = ['read', 'write', 'exec', 'net', 'pure'];
const VALID_COSTS = ['free', 'low', 'medium', 'high'];

test('every tool has valid meta', () => {
  const list = registry.list();
  const errors = [];

  for (const name of list) {
    const tool = registry.get(name);
    if (!tool.meta) { errors.push(`${name}: missing meta`); continue; }

    const m = tool.meta;
    if (typeof m.sideEffects !== 'boolean') errors.push(`${name}: sideEffects not boolean`);
    if (typeof m.idempotent !== 'boolean') errors.push(`${name}: idempotent not boolean`);
    if (typeof m.destructive !== 'boolean') errors.push(`${name}: destructive not boolean`);
    if (typeof m.requiresConfirmation !== 'boolean') errors.push(`${name}: requiresConfirmation not boolean`);
    if (!VALID_COSTS.includes(m.costLevel)) errors.push(`${name}: invalid costLevel "${m.costLevel}"`);
    if (!VALID_CATEGORIES.includes(m.category)) errors.push(`${name}: invalid category "${m.category}"`);
  }

  assert(errors.length === 0, `Metadata errors:\n  ${errors.join('\n  ')}`);
});

test('every tool has name matching key', () => {
  const list = registry.list();
  const mismatched = [];

  for (const name of list) {
    const tool = registry.get(name);
    if (tool.name !== name) mismatched.push(`key=${name}, tool.name=${tool.name}`);
  }

  assert(mismatched.length === 0, `Name mismatches:\n  ${mismatched.join('\n  ')}`);
});

test('every tool has description (non-empty string)', () => {
  const list = registry.list();
  const empty = list.filter(n => {
    const t = registry.get(n);
    return !t.description || typeof t.description !== 'string' || t.description.length < 5;
  });
  assert(empty.length === 0, `Tools with bad description: ${empty.join(', ')}`);
});

test('every tool has execute function', () => {
  const list = registry.list();
  const missing = list.filter(n => typeof registry.get(n).execute !== 'function');
  assert(missing.length === 0, `Tools without execute: ${missing.join(', ')}`);
});

test('destructive tools require confirmation', () => {
  const list = registry.list();
  const violations = [];

  for (const name of list) {
    const m = registry.get(name).meta;
    if (m.destructive && !m.requiresConfirmation) {
      violations.push(name);
    }
  }

  assert(violations.length === 0,
    `Destructive tools without requiresConfirmation: ${violations.join(', ')}`);
});

test('pure category tools have no sideEffects', () => {
  const list = registry.list();
  const violations = [];

  for (const name of list) {
    const m = registry.get(name).meta;
    if (m.category === 'pure' && m.sideEffects) {
      violations.push(name);
    }
  }

  assert(violations.length === 0,
    `Pure tools with sideEffects: ${violations.join(', ')}`);
});

test('read category tools have no sideEffects', () => {
  const list = registry.list();
  const violations = [];

  for (const name of list) {
    const m = registry.get(name).meta;
    if (m.category === 'read' && m.sideEffects) {
      violations.push(name);
    }
  }

  assert(violations.length === 0,
    `Read tools with sideEffects: ${violations.join(', ')}`);
});

test('npm audit tools declare the optional fix capability as mutating', () => {
  for (const name of ['npm.audit', 'deps.vuln']) {
    const tool = registry.get(name);
    assert(tool.params.optional.includes('fix'), `${name} exposes fix`);
    assert(tool.permissions.includes('fs.write'), `${name} declares fs.write`);
    assert(tool.permissions.includes('process.exec'), `${name} declares process.exec`);
    assertEqual(tool.meta.sideEffects, true, `${name} has side effects`);
    assertEqual(tool.meta.idempotent, false, `${name} is not idempotent`);
    assertEqual(tool.meta.requiresConfirmation, true, `${name} requires confirmation`);
    assertEqual(tool.meta.category, 'exec', `${name} is an exec capability`);
    assert(!registry.safeForAutoExec().includes(name), `${name} is not auto-executable`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. RISK CLASSIFICATION & QUERY METHODS
// ═══════════════════════════════════════════════════════════════════════════

suite('Registry — Risk Classification');

test('safeForAutoExec() returns array of safe tools', () => {
  const safe = registry.safeForAutoExec();
  assert(Array.isArray(safe), 'returns array');
  assert(safe.length > 50, `Expected > 50 safe tools, got ${safe.length}`);

  // All safe tools should not require confirmation and not be destructive
  for (const name of safe) {
    const m = registry.get(name).meta;
    assert(!m.requiresConfirmation, `${name} is in safeForAutoExec but requiresConfirmation=true`);
    assert(!m.destructive, `${name} is in safeForAutoExec but destructive=true`);
  }
});

test('requiresConfirmation() returns tools needing approval', () => {
  const confirmed = registry.requiresConfirmation();
  assert(Array.isArray(confirmed), 'returns array');
  assert(confirmed.length > 20, `Expected > 20, got ${confirmed.length}`);

  for (const name of confirmed) {
    assert(registry.get(name).meta.requiresConfirmation, `${name} has requiresConfirmation=false`);
  }
});

test('destructive() returns data-loss tools', () => {
  const destr = registry.destructive();
  assert(Array.isArray(destr), 'returns array');
  assert(destr.length >= 5, `Expected >= 5 destructive, got ${destr.length}`);

  // Known destructive tools
  assert(destr.includes('fs.delete'), 'fs.delete is destructive');
  assert(destr.includes('git.reset'), 'git.reset is destructive');
});

test('byCategory() filters correctly', () => {
  for (const cat of VALID_CATEGORIES) {
    const tools = registry.byCategory(cat);
    assert(Array.isArray(tools), `${cat} returns array`);
    assert(tools.length > 0, `${cat} has tools`);
    for (const name of tools) {
      assertEqual(registry.get(name).meta.category, cat, `${name} category mismatch`);
    }
  }
});

test('byCost() filters correctly', () => {
  for (const cost of VALID_COSTS) {
    const tools = registry.byCost(cost);
    assert(Array.isArray(tools), `${cost} returns array`);
    for (const name of tools) {
      assertEqual(registry.get(name).meta.costLevel, cost, `${name} cost mismatch`);
    }
  }
});

test('isSafe() returns boolean', () => {
  assert(registry.isSafe('math.eval') === true, 'math.eval is safe');
  assert(registry.isSafe('git.reset') === false, 'git.reset is not safe');
  assert(registry.isSafe('fs.read') === true, 'fs.read is safe');
  assert(registry.isSafe('fs.delete') === false, 'fs.delete is not safe');
});

test('riskAssessment() returns structured report', () => {
  const r = registry.riskAssessment('git.rebase');
  assert(r, 'returns result');
  assert(r.risk, 'has risk level');
  assert(Array.isArray(r.reasons), 'has reasons');
  assert(r.meta, 'has meta');
  assert(r.reasons.length > 0, 'has at least one reason');

  // Safe tool should have 'safe' risk
  const rs = registry.riskAssessment('math.eval');
  assertEqual(rs.risk, 'safe', 'math.eval risk is safe');
});

test('riskAssessment() for unknown tool returns falsy', () => {
  const r = registry.riskAssessment('nonexistent.tool');
  assert(!r, 'returns falsy for unknown');
});

test('capabilitySummary() returns dashboard', () => {
  const cs = registry.capabilitySummary();
  assert(cs.total > 150, `total: ${cs.total}`);
  assertEqual(cs.total, cs.withMeta, 'all tools have meta');
  assert(cs.categories, 'has categories');
  assert(cs.costs, 'has costs');
  assert(typeof cs.safeForAutoExec === 'number', 'has safeForAutoExec count');
  assert(typeof cs.requiresConfirmation === 'number', 'has requiresConfirmation count');
  assert(typeof cs.destructive === 'number', 'has destructive count');

  // Sum of categories = total
  const catSum = Object.values(cs.categories).reduce((s, v) => s + v, 0);
  assertEqual(catSum, cs.total, 'category sum matches total');

  // Sum of costs = total
  const costSum = Object.values(cs.costs).reduce((s, v) => s + v, 0);
  assertEqual(costSum, cs.total, 'cost sum matches total');
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. EXECUTE SAFE TOOLS (pure/read)
// ═══════════════════════════════════════════════════════════════════════════

suite('Tool Execution — Pure/Math');

await testAsync('math.eval — basic arithmetic', async () => {
  const r = await registry.get('math.eval').execute({ expression: '2 + 3 * 4' });
  assertEqual(r.result, 14);
});

await testAsync('math.eval — power expression', async () => {
  const r = await registry.get('math.eval').execute({ expression: '2 ** 10' });
  assertEqual(r.result, 1024);
});

await testAsync('math.stats — basic statistics', async () => {
  const r = await registry.get('math.stats').execute({ data: [1, 2, 3, 4, 5] });
  assertEqual(r.mean, 3);
  assertEqual(r.min, 1);
  assertEqual(r.max, 5);
  assertEqual(r.count, 5);
  assertEqual(r.sum, 15);
});

await testAsync('math.convert — unit conversion', async () => {
  const r = await registry.get('math.convert').execute({ value: 1, from: 'km', to: 'm' });
  assertEqual(r.result, 1000);
});

suite('Tool Execution — Date');

await testAsync('date.now — returns current timestamp', async () => {
  const r = await registry.get('date.now').execute({});
  assert(r.iso, 'has iso');
  assert(r.unix > 0, 'has unix timestamp');
  assert(r.utc, 'has utc');
});

await testAsync('date.parse — parses date string', async () => {
  const r = await registry.get('date.parse').execute({ input: '2025-01-15T10:30:00Z' });
  assert(r.iso, 'has iso');
  assertEqual(r.year, 2025);
  assertEqual(r.month, 1);
  assertEqual(r.day, 15);
});

await testAsync('date.diff — calculates date difference', async () => {
  const r = await registry.get('date.diff').execute({
    from: '2025-01-01', to: '2025-01-31'
  });
  assertEqual(r.days, 30);
  assert(r.hours > 0, 'has hours');
});

suite('Tool Execution — Regex');

await testAsync('regex.test — matches pattern', async () => {
  const r = await registry.get('regex.test').execute({
    pattern: '^\\d{3}-\\d{4}$', text: '123-4567'
  });
  assertEqual(r.match, true);
});

await testAsync('regex.test — no match', async () => {
  const r = await registry.get('regex.test').execute({
    pattern: '^\\d{3}$', text: 'abc'
  });
  assertEqual(r.match, false);
});

await testAsync('regex.extract — extracts matches', async () => {
  const r = await registry.get('regex.extract').execute({
    pattern: '\\d+', text: 'foo 42 bar 99 baz', global: true
  });
  assert(Array.isArray(r.matches), 'has matches');
  assert(r.matches.length === 2, `expected 2, got ${r.matches.length}`);
});

suite('Tool Execution — URL');

await testAsync('url.parse — parses URL', async () => {
  const r = await registry.get('url.parse').execute({ url: 'https://example.com:8080/path?q=1#frag' });
  assertEqual(r.protocol, 'https:');
  assertEqual(r.hostname, 'example.com');
  assertEqual(r.port, '8080');
  assertEqual(r.pathname, '/path');
  assertEqual(r.hash, '#frag');
});

await testAsync('url.encode — encodes component', async () => {
  const r = await registry.get('url.encode').execute({ input: 'hello world & foo=bar' });
  assertEqual(r.encoded, 'hello%20world%20%26%20foo%3Dbar');
});

await testAsync('url.decode — decodes component', async () => {
  const r = await registry.get('url.decode').execute({ input: 'hello%20world%20%26%20foo%3Dbar' });
  assertEqual(r.decoded, 'hello world & foo=bar');
});

suite('Tool Execution — Crypto');

await testAsync('crypto.uuid — generates UUID v4', async () => {
  const r = await registry.get('crypto.uuid').execute({});
  assert(r.uuid, 'has uuid');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.uuid), 'valid v4 format');
});

await testAsync('crypto.randomBytes — generates random bytes', async () => {
  const r = await registry.get('crypto.randomBytes').execute({ length: 16 });
  assert(r.value, 'has value');
  assertEqual(r.value.length, 32, 'hex is 32 chars for 16 bytes');
  assertEqual(r.length, 16, 'correct byte length');
});

await testAsync('crypto.generatePassword — generates password', async () => {
  const r = await registry.get('crypto.generatePassword').execute({ length: 20 });
  assert(r.password, 'has password');
  assertEqual(r.password.length, 20, 'correct length');
});

await testAsync('crypto.encrypt + decrypt roundtrip', async () => {
  const key = 'my-secret-key-for-testing-aes256';
  const plaintext = 'Hello, World! 42';
  const enc = await registry.get('crypto.encrypt').execute({ text: plaintext, key });
  assert(enc.encrypted, 'has encrypted');
  assert(enc.iv, 'has iv');
  assert(enc.tag, 'has tag');

  const dec = await registry.get('crypto.decrypt').execute({
    encrypted: enc.encrypted, key, iv: enc.iv, tag: enc.tag
  });
  assertEqual(dec.text, plaintext, 'decrypted matches original');
});

suite('Tool Execution — Validation');

await testAsync('validate.json — valid JSON', async () => {
  const r = await registry.get('validate.json').execute({ input: '{"a":1}' });
  assert(r.valid, 'valid json');
});

await testAsync('validate.json — invalid JSON', async () => {
  const r = await registry.get('validate.json').execute({ input: '{bad}' });
  assert(!r.valid, 'invalid json');
  assert(r.error, 'has error message');
});

await testAsync('validate.email — valid email', async () => {
  const r = await registry.get('validate.email').execute({ email: 'test@example.com' });
  assert(r.valid, 'valid email');
});

await testAsync('validate.email — invalid email', async () => {
  const r = await registry.get('validate.email').execute({ email: 'not-an-email' });
  assert(!r.valid, 'invalid email');
});

await testAsync('validate.semver — valid version', async () => {
  const r = await registry.get('validate.semver').execute({ version: '1.2.3' });
  assert(r.valid, 'valid semver');
  assertEqual(r.major, 1);
  assertEqual(r.minor, 2);
  assertEqual(r.patch, 3);
});

await testAsync('validate.url — valid URL', async () => {
  const r = await registry.get('validate.url').execute({ url: 'https://example.com' });
  assert(r.valid, 'valid url');
});

suite('Tool Execution — Text');

await testAsync('text.count — word/line/char count via file', async () => {
  // text.count reads from a file path, so write a temp file
  const countFile = path.join(os.tmpdir(), 'c3-text-count-test.txt');
  fs.writeFileSync(countFile, 'hello world\nfoo bar baz');
  const r = await registry.get('text.count').execute({ input: countFile });
  assert(!r.error, `error: ${r.error}`);
  try { fs.unlinkSync(countFile); } catch {}
});

suite('Tool Execution — Base64');

await testAsync('base64.encode + decode roundtrip', async () => {
  const original = 'Hello, World!';
  const enc = await registry.get('base64.encode').execute({ input: original });
  assert(enc.output, 'has output');
  const dec = await registry.get('base64.decode').execute({ input: enc.output });
  assertEqual(dec.output, original, 'roundtrip matches');
});

suite('Tool Execution — JSON / YAML');

await testAsync('yaml.parse — basic YAML', async () => {
  const r = await registry.get('yaml.parse').execute({
    input: 'name: test\nversion: 1.0'
  });
  assert(r.data, 'has data');
  assertEqual(r.data.name, 'test');
});

await testAsync('yaml.stringify — serializes to YAML', async () => {
  const r = await registry.get('yaml.stringify').execute({
    data: { name: 'test', version: 1 }
  });
  assert(!r.error, `error: ${r.error}`);
  assert(r.yaml || r.output, 'has yaml output');
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. FILE SYSTEM TOOLS (in temp dir)
// ═══════════════════════════════════════════════════════════════════════════

suite('Tool Execution — FS (temp dir)');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-test-'));
const npmAuditFixtureRoot = path.join(tmpDir, 'npm-audit-fixture');
const fakeNpmBinDir = path.join(npmAuditFixtureRoot, 'bin');
const fakeNpmCacheDir = path.join(npmAuditFixtureRoot, 'npm-cache');
const fakeNpmScenarioPath = path.join(npmAuditFixtureRoot, 'scenario.json');
const fakeNpmObservedPath = path.join(npmAuditFixtureRoot, 'observed.json');
const fakeNpmPath = path.join(fakeNpmBinDir, 'npm');

fs.mkdirSync(fakeNpmBinDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(fakeNpmCacheDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(fakeNpmPath, `#!${process.execPath}
const fs = require('node:fs');
const scenario = JSON.parse(fs.readFileSync(
  process.env.INTENTSMITH_NPM_AUDIT_SCENARIO,
  'utf8',
));
fs.writeFileSync(
  process.env.INTENTSMITH_NPM_AUDIT_OBSERVED,
  JSON.stringify({
    argv: process.argv.slice(2),
    cache: process.env.npm_config_cache,
  }),
);
if (scenario.delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, scenario.delayMs);
}
if (scenario.signal) process.kill(process.pid, scenario.signal);
if (scenario.stdout) process.stdout.write(scenario.stdout);
if (scenario.stderr) process.stderr.write(scenario.stderr);
process.exit(Number.isInteger(scenario.status) ? scenario.status : 0);
`, { mode: 0o700 });
fs.chmodSync(fakeNpmPath, 0o700);

function makeAuditReport(vulnerabilities = {}) {
  const counts = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0,
    total: 0,
  };
  for (const vulnerability of Object.values(vulnerabilities)) {
    counts[vulnerability.severity] += 1;
    counts.total += 1;
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: counts,
      totalDependencies: 17,
    },
  };
}

function fakeNpmEnvironment(scenario) {
  fs.writeFileSync(fakeNpmScenarioPath, JSON.stringify(scenario));
  try { fs.rmSync(fakeNpmObservedPath); } catch {}
  return {
    ...process.env,
    PATH: `${fakeNpmBinDir}${path.delimiter}${process.env.PATH || ''}`,
    npm_config_cache: fakeNpmCacheDir,
    INTENTSMITH_NPM_AUDIT_SCENARIO: fakeNpmScenarioPath,
    INTENTSMITH_NPM_AUDIT_OBSERVED: fakeNpmObservedPath,
  };
}

async function withFakeNpmEnvironment(scenario, fn) {
  const keys = [
    'PATH',
    'npm_config_cache',
    'INTENTSMITH_NPM_AUDIT_SCENARIO',
    'INTENTSMITH_NPM_AUDIT_OBSERVED',
  ];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, fakeNpmEnvironment(scenario));
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function readFakeNpmObservation() {
  return JSON.parse(fs.readFileSync(fakeNpmObservedPath, 'utf8'));
}

await testAsync('fs.write + fs.read roundtrip', async () => {
  const filePath = path.join(tmpDir, 'test.txt');
  const w = await registry.get('fs.write').execute({ path: filePath, content: 'Hello, World!' });
  assert(!w.error, `write error: ${w.error}`);

  const r = await registry.get('fs.read').execute({ path: filePath });
  assert(!r.error, `read error: ${r.error}`);
  assertEqual(r.content.trim(), 'Hello, World!');
});

await testAsync('fs.exists — true for existing file', async () => {
  const filePath = path.join(tmpDir, 'test.txt');
  const r = await registry.get('fs.exists').execute({ path: filePath });
  assert(r.exists, 'file exists');
});

await testAsync('fs.exists — false for missing file', async () => {
  const r = await registry.get('fs.exists').execute({ path: path.join(tmpDir, 'nope.txt') });
  assert(!r.exists, 'file does not exist');
});

await testAsync('fs.list — lists directory', async () => {
  const r = await registry.get('fs.list').execute({ path: tmpDir });
  assert(!r.error, `error: ${r.error}`);
  assert(Array.isArray(r.files) || Array.isArray(r.entries), 'has files/entries');
});

await testAsync('fs.mkdir — creates directory', async () => {
  const dirPath = path.join(tmpDir, 'subdir', 'nested');
  const r = await registry.get('fs.mkdir').execute({ path: dirPath });
  assert(!r.error, `mkdir error: ${r.error}`);
  assert(fs.existsSync(dirPath), 'directory created');
});

await testAsync('fs.append — appends to file', async () => {
  const filePath = path.join(tmpDir, 'append-test.txt');
  await registry.get('fs.write').execute({ path: filePath, content: 'line1\n' });
  await registry.get('fs.append').execute({ path: filePath, content: 'line2\n' });
  const r = await registry.get('fs.read').execute({ path: filePath });
  assertIncludes(r.content, 'line1');
  assertIncludes(r.content, 'line2');
});

await testAsync('fs.readJson + fs.writeJson roundtrip', async () => {
  const filePath = path.join(tmpDir, 'test.json');
  const data = { name: 'test', version: 42, items: [1, 2, 3] };
  await registry.get('fs.writeJson').execute({ path: filePath, data });
  const r = await registry.get('fs.readJson').execute({ path: filePath });
  assert(!r.error, `error: ${r.error}`);
  assertEqual(r.data.name, 'test');
  assertEqual(r.data.version, 42);
  assertEqual(r.data.items.length, 3);
});

await testAsync('fs.head — reads first N lines', async () => {
  const filePath = path.join(tmpDir, 'multiline.txt');
  await registry.get('fs.write').execute({
    path: filePath, content: 'line1\nline2\nline3\nline4\nline5\n'
  });
  const r = await registry.get('fs.head').execute({ path: filePath, lines: 3 });
  assert(!r.error, `error: ${r.error}`);
  const resultLines = (r.content || r.lines || '').toString().trim().split('\n');
  assert(resultLines.length <= 3, `expected <= 3 lines, got ${resultLines.length}`);
});

await testAsync('fs.tail — reads last N lines', async () => {
  const filePath = path.join(tmpDir, 'multiline.txt');
  const r = await registry.get('fs.tail').execute({ path: filePath, lines: 2 });
  assert(!r.error, `error: ${r.error}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. DIFF TOOLS
// ═══════════════════════════════════════════════════════════════════════════

suite('Tool Execution — Diff');

await testAsync('diff.create — creates unified diff', async () => {
  const r = await registry.get('diff.create').execute({
    a: 'line1\nline2\nline3\n',
    b: 'line1\nmodified\nline3\nnew line\n',
  });
  assert(!r.error, `error: ${r.error}`);
  assert(r.diff, 'has diff output');
  assertIncludes(r.diff, '-line2', 'shows removed line');
  assertIncludes(r.diff, '+modified', 'shows added line');
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. SYSTEM / ENV TOOLS
// ═══════════════════════════════════════════════════════════════════════════

suite('Tool Execution — System');

await testAsync('system.info — returns system information', async () => {
  const r = await registry.get('system.info').execute({});
  assert(!r.error, `error: ${r.error}`);
  assert(r.platform || r.os, 'has platform info');
  assert(r.arch || r.architecture, 'has architecture');
  assert(r.nodeVersion || r.node, 'has node version');
});

await testAsync('env.get — reads env variable', async () => {
  const r = await registry.get('env.get').execute({ key: 'PATH' });
  assert(!r.error, `error: ${r.error}`);
  assert(r.value, 'PATH has value');
  assertEqual(r.key, 'PATH', 'key matches');
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. PROFILING / OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════

suite('Tool Execution — Profiling');

await testAsync('profile.eventloop — measures event loop lag', async () => {
  const r = await registry.get('profile.eventloop').execute({ duration: 1 });
  assert(r.samples > 0, `has samples: ${r.samples}`);
  assert(r.avg, 'has avg');
  assert(r.p50, 'has p50');
  assert(r.p95, 'has p95');
  assert(typeof r.healthy === 'boolean', 'has healthy flag');
});

await testAsync('profile.benchmark — microbenchmark', async () => {
  const r = await registry.get('profile.benchmark').execute({
    code: '() => { let s = 0; for (let i = 0; i < 100; i++) s += i; return s; }',
    iterations: 1000,
  });
  assert(!r.error, `error: ${r.error}`);
  assert(r.opsPerSec > 0, 'has ops/sec');
  assert(r.iterations === 1000, 'correct iterations');
  assert(r.avgNs, 'has avg nanoseconds');
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. RESOURCE GUARDS
// ═══════════════════════════════════════════════════════════════════════════

suite('Tool Execution — Resource Guards');

await testAsync('guard.disk — checks disk space', async () => {
  const r = await registry.get('guard.disk').execute({});
  assert(!r.error, `error: ${r.error}`);
  assert(r.total, 'has total');
  assert(r.available, 'has available');
  assert(r.usePercent, 'has usePercent');
  assert(typeof r.warning === 'boolean', 'has warning flag');
  assert(r.message, 'has message');
});

await testAsync('guard.memory — checks memory pressure', async () => {
  const r = await registry.get('guard.memory').execute({});
  assert(!r.error, `error: ${r.error}`);
  assert(r.system, 'has system');
  assert(r.system.total, 'has system.total');
  assert(r.system.free, 'has system.free');
  assert(r.process, 'has process');
  assert(r.process.rss, 'has process.rss');
  assert(r.process.heapUsed, 'has process.heapUsed');
  assert(typeof r.warning === 'boolean', 'has warning flag');
});

await testAsync('guard.fd — checks file descriptors', async () => {
  const r = await registry.get('guard.fd').execute({});
  assert(!r.error, `error: ${r.error}`);
  assert(typeof r.openFds === 'number', 'has openFds');
  assert(typeof r.fdLimit === 'number', 'has fdLimit');
  assert(r.usePercent, 'has usePercent');
  assert(typeof r.warning === 'boolean', 'has warning flag');
});

await testAsync('guard.watchdog — combined health check', async () => {
  const r = await registry.get('guard.watchdog').execute({});
  assert(!r.error, `error: ${r.error}`);
  assert(r.status, 'has status');
  assert(['healthy', 'warning', 'critical'].includes(r.status), `valid status: ${r.status}`);
  assert(r.disk, 'has disk');
  assert(r.memory, 'has memory');
  assert(r.fd, 'has fd');
  assert(r.timestamp, 'has timestamp');
  assert(Array.isArray(r.warnings), 'has warnings array');
  assert(Array.isArray(r.criticals), 'has criticals array');
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. CODE ANALYSIS TOOLS
// ═══════════════════════════════════════════════════════════════════════════

suite('Tool Execution — Code Analysis');

await testAsync('code.analyze — analyzes JS project', async () => {
  const r = await registry.get('code.analyze').execute({
    path: path.join(process.cwd(), 'src')
  });
  assert(!r.error, `error: ${r.error}`);
  assert(r.totalFiles > 0 || r.files > 0, 'has file count');
  assert(r.totalLines > 0 || r.lines > 0 || r.loc > 0, 'has line count');
});

await testAsync('code.imports — analyzes import graph', async () => {
  // Create a small test project
  const testDir = path.join(tmpDir, 'import-test');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'a.js'), "import { foo } from './b.js';\nconsole.log(foo);\n");
  fs.writeFileSync(path.join(testDir, 'b.js'), "export const foo = 42;\n");

  const r = await registry.get('code.imports').execute({ path: testDir });
  assert(!r.error, `error: ${r.error}`);
  assert(r.files >= 2, `expected >= 2 files, got ${r.files}`);
  assert(r.localImports >= 1, `expected >= 1 local import, got ${r.localImports}`);
});

await testAsync('code.deadcode — detects unused exports', async () => {
  const testDir = path.join(tmpDir, 'deadcode-test');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'a.js'), "import { used } from './b.js';\nconsole.log(used);\n");
  fs.writeFileSync(path.join(testDir, 'b.js'), "export const used = 1;\nexport const unused = 2;\n");

  const r = await registry.get('code.deadcode').execute({ path: testDir });
  assert(!r.error, `error: ${r.error}`);
  assert(r.totalExports >= 2, 'has total exports');
  assert(r.unusedExports >= 1, 'found unused export');
  const unusedNames = r.unused.map(u => u.symbol);
  assert(unusedNames.includes('unused'), 'unused identified');
});

await testAsync('code.duplicates — detects duplicate code', async () => {
  const testDir = path.join(tmpDir, 'dup-test');
  fs.mkdirSync(testDir, { recursive: true });
  const sharedBlock = 'const x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\nreturn z;\n';
  fs.writeFileSync(path.join(testDir, 'a.js'), `function a() {\n${sharedBlock}}\n`);
  fs.writeFileSync(path.join(testDir, 'b.js'), `function b() {\n${sharedBlock}}\n`);

  const r = await registry.get('code.duplicates').execute({ path: testDir });
  assert(!r.error, `error: ${r.error}`);
  assert(r.filesScanned >= 2, 'scanned files');
  assert(r.duplicatesFound >= 1, 'found duplicates');
});

await testAsync('code.rename — dry run rename', async () => {
  const testDir = path.join(tmpDir, 'rename-test');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'a.js'), 'const oldName = 1;\nconsole.log(oldName);\n');
  fs.writeFileSync(path.join(testDir, 'b.js'), 'import { oldName } from "./a.js";\n');

  const r = await registry.get('code.rename').execute({
    path: testDir, oldName: 'oldName', newName: 'newName', dryRun: true
  });
  assert(!r.error, `error: ${r.error}`);
  assert(r.dryRun === true, 'is dry run');
  assert(r.filesChanged >= 2, `expected >= 2 files changed, got ${r.filesChanged}`);
  assert(r.totalOccurrences >= 3, `expected >= 3 occurrences, got ${r.totalOccurrences}`);

  // Verify files unchanged (dry run)
  const content = fs.readFileSync(path.join(testDir, 'a.js'), 'utf-8');
  assertIncludes(content, 'oldName', 'original file unchanged in dry run');
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. DEPENDENCY INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════

suite('Tool Execution — Dependency Intelligence');

await testAsync('deps.tree — shows dependency tree', async () => {
  const r = await registry.get('deps.tree').execute({ depth: 1 });
  assert(!r.error, `error: ${r.error}`);
  assert(r.totalPackages > 0, 'has packages');
  assert(r.tree, 'has tree');
});

await testAsync('deps.licenses — scans licenses', async () => {
  const r = await registry.get('deps.licenses').execute({});
  if (r.error && r.error.includes('node_modules not found')) {
    // Skip if no node_modules
    assert(true, 'skipped — no node_modules');
  } else {
    assert(!r.error, `error: ${r.error}`);
    assert(r.totalPackages > 0, 'has packages');
    assert(r.summary, 'has license summary');
    assert(typeof r.clean === 'boolean', 'has clean flag');
  }
});

await testAsync('deps.size — analyzes package sizes', async () => {
  const r = await registry.get('deps.size').execute({ top: 5 });
  if (r.error && r.error.includes('node_modules not found')) {
    assert(true, 'skipped — no node_modules');
  } else {
    assert(!r.error, `error: ${r.error}`);
    assert(r.totalPackages > 0, 'has packages');
    assert(r.totalSize, 'has total size');
    assert(Array.isArray(r.top), 'has top packages');
  }
});

await testAsync('deps.vuln accepts npm exit 1 only with a valid vulnerability report', async () => {
  const report = makeAuditReport({
    'intentsmith-sentinel': {
      severity: 'critical',
      via: [{ title: 'INTENTSMITH_SENTINEL_VULNERABILITY' }],
      fixAvailable: true,
      range: '<1.0.0',
    },
  });
  await withFakeNpmEnvironment({
    stdout: JSON.stringify(report),
    status: 1,
  }, async () => {
    const r = await registry.get('deps.vuln').execute({ cwd: tmpDir });
    assert(!r.error, `error: ${r.error}`);
    assertEqual(r.clean, false, 'vulnerability report is not clean');
    assertEqual(r.summary.total, 1, 'one vulnerability is counted');
    assertEqual(r.summary.critical, 1, 'critical severity is preserved');
    assertEqual(r.vulnerabilities.length, 1, 'one detail is returned');
    assertEqual(r.vulnerabilities[0].name, 'intentsmith-sentinel');
    assertEqual(r.vulnerabilities[0].title, 'INTENTSMITH_SENTINEL_VULNERABILITY');

    const observed = readFakeNpmObservation();
    assertEqual(observed.argv.join(','), 'audit,--json');
    assertEqual(observed.cache, fakeNpmCacheDir);
    assert(observed.cache.startsWith(`${tmpDir}${path.sep}`), 'npm cache stays below the owned test root');
  });
});

await testAsync('npm.audit shares the validated offline report contract', async () => {
  const report = makeAuditReport();
  await withFakeNpmEnvironment({
    stdout: JSON.stringify(report),
    status: 0,
  }, async () => {
    const r = await registry.get('npm.audit').execute({
      cwd: tmpDir,
      production: true,
    });
    assert(!r.error, `error: ${r.error}`);
    assertEqual(r.vulnerabilities.total, 0);
    assertEqual(r.totalDeps, 17);
    assertEqual(readFakeNpmObservation().argv.join(','), 'audit,--json,--production');
  });
});

await testAsync('both audit aliases reject npm error JSON', async () => {
  const scenario = {
    stdout: JSON.stringify({
      error: {
        code: 'ENOAUDIT',
        summary: 'audit endpoint returned an error',
      },
    }),
    status: 1,
  };
  for (const [name, code] of [
    ['npm.audit', 'NPM_ERROR'],
    ['deps.vuln', 'VULN_ERROR'],
  ]) {
    await withFakeNpmEnvironment(scenario, async () => {
      const r = await registry.get(name).execute({ cwd: tmpDir });
      assertEqual(r.code, code, `${name} returns its terminal error code`);
      assertEqual(r.reason, 'NPM_ERROR_RESPONSE', `${name} rejects the npm error envelope`);
      assertEqual(r.npmErrorCode, 'ENOAUDIT', `${name} preserves only the bounded npm error code`);
      assert(!r.summary, `${name} does not manufacture a vulnerability summary`);
      assert(!r.clean, `${name} does not manufacture a clean result`);
    });
  }
});

await testAsync('deps.vuln rejects malformed output and unexpected nonzero status', async () => {
  await withFakeNpmEnvironment({
    stdout: 'not-json',
    status: 1,
  }, async () => {
    const malformed = await registry.get('deps.vuln').execute({ cwd: tmpDir });
    assertEqual(malformed.code, 'VULN_ERROR');
    assertEqual(malformed.reason, 'INVALID_JSON');
  });

  await withFakeNpmEnvironment({
    stdout: JSON.stringify(makeAuditReport()),
    status: 2,
  }, async () => {
    const failed = await registry.get('deps.vuln').execute({ cwd: tmpDir });
    assertEqual(failed.code, 'VULN_ERROR');
    assertEqual(failed.reason, 'PROCESS_FAILED');
    assertEqual(failed.status, 2);
  });
});

await testAsync('audit report and exit status must agree', async () => {
  await withFakeNpmEnvironment({
    stdout: JSON.stringify(makeAuditReport()),
    status: 1,
  }, async () => {
    const r = await registry.get('npm.audit').execute({ cwd: tmpDir });
    assertEqual(r.code, 'NPM_ERROR');
    assertEqual(r.reason, 'INCONSISTENT_STATUS');
  });
});

await testAsync('npm audit timeout, signal, and spawn failure are terminal', async () => {
  const timeoutResult = runNpmAuditReport({
    cwd: tmpDir,
    timeoutMs: 20,
  }, {
    env: fakeNpmEnvironment({
      delayMs: 250,
      stdout: JSON.stringify(makeAuditReport()),
      status: 0,
    }),
  });
  assertEqual(timeoutResult.ok, false);
  assertEqual(timeoutResult.reason, 'TIMEOUT');

  const signalResult = runNpmAuditReport({
    cwd: tmpDir,
  }, {
    env: fakeNpmEnvironment({ signal: 'SIGTERM' }),
  });
  assertEqual(signalResult.ok, false);
  assertEqual(signalResult.reason, 'SIGNALLED');
  assertEqual(signalResult.signal, 'SIGTERM');

  const missingBinDir = path.join(npmAuditFixtureRoot, 'missing-bin');
  fs.mkdirSync(missingBinDir, { mode: 0o700 });
  const spawnResult = runNpmAuditReport({
    cwd: tmpDir,
  }, {
    env: {
      ...process.env,
      PATH: missingBinDir,
      npm_config_cache: fakeNpmCacheDir,
    },
  });
  assertEqual(spawnResult.ok, false);
  assertEqual(spawnResult.reason, 'SPAWN_FAILED');
});

await testAsync('npm audit fix is exercised only through the local fake capability', async () => {
  await withFakeNpmEnvironment({
    stdout: JSON.stringify(makeAuditReport()),
    status: 0,
  }, async () => {
    const r = await registry.get('npm.audit').execute({
      cwd: tmpDir,
      fix: true,
    });
    assert(!r.error, `error: ${r.error}`);
    assertEqual(readFakeNpmObservation().argv.join(','), 'audit,fix,--json');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

// Clean up temp dir
try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

// ═══════════════════════════════════════════════════════════════════════════

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
