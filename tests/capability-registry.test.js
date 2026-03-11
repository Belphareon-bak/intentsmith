// v121: Capability Registry — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { CapabilityRegistry } from '../src/specialists/capability-registry.js';

// ─── Basic Registration ──────────────────────────────────────────────────────

suite('capability-registry: basic');

const reg = new CapabilityRegistry();

test('register + resolve single', () => {
  reg.register('tax.calculate', 'accountant-cz');
  const result = reg.resolve('tax.calculate');
  assertEqual(result.length, 1);
  assertEqual(result[0], 'accountant-cz');
});

test('has() returns true for registered', () => {
  assert(reg.has('tax.calculate'));
});

test('has() returns false for unknown', () => {
  assert(!reg.has('unknown.capability'));
});

test('resolve unknown returns empty array', () => {
  const result = reg.resolve('nonexistent.cap');
  assert(Array.isArray(result));
  assertEqual(result.length, 0);
});

test('listCapabilities returns registered', () => {
  const caps = reg.listCapabilities();
  assert(caps.includes('tax.calculate'));
});

test('getSpecialistCapabilities works', () => {
  reg.register('vat.compute', 'accountant-cz');
  const caps = reg.getSpecialistCapabilities('accountant-cz');
  assert(caps.includes('tax.calculate'));
  assert(caps.includes('vat.compute'));
});

test('getSpecialistCapabilities returns empty for unknown specialist', () => {
  const caps = reg.getSpecialistCapabilities('unknown');
  assertEqual(caps.length, 0);
});

test('size reflects unique capabilities', () => {
  assert(reg.size >= 2);
});

// ─── Multiple Specialists ────────────────────────────────────────────────────

suite('capability-registry: multiple specialists');

const reg2 = new CapabilityRegistry();

test('multiple specialists per capability', () => {
  reg2.register('tax.calculate', 'accountant-cz', 10);
  reg2.register('tax.calculate', 'tax-advisor-pro', 20);
  const result = reg2.resolve('tax.calculate');
  assertEqual(result.length, 2);
});

test('higher priority first', () => {
  const result = reg2.resolve('tax.calculate');
  assertEqual(result[0], 'tax-advisor-pro', 'priority 20 should be first');
  assertEqual(result[1], 'accountant-cz', 'priority 10 should be second');
});

test('same priority → registration order', () => {
  const reg3 = new CapabilityRegistry();
  reg3.register('vat.compute', 'specialist-a', 10);
  reg3.register('vat.compute', 'specialist-b', 10);
  reg3.register('vat.compute', 'specialist-c', 10);
  const result = reg3.resolve('vat.compute');
  assertEqual(result[0], 'specialist-a', 'first registered should be first');
  assertEqual(result[1], 'specialist-b');
  assertEqual(result[2], 'specialist-c');
});

test('mixed priorities', () => {
  const reg4 = new CapabilityRegistry();
  reg4.register('salary.compute', 'low-prio', 5);
  reg4.register('salary.compute', 'high-prio', 20);
  reg4.register('salary.compute', 'med-prio', 10);
  const result = reg4.resolve('salary.compute');
  assertEqual(result[0], 'high-prio');
  assertEqual(result[1], 'med-prio');
  assertEqual(result[2], 'low-prio');
});

// ─── Unregister ──────────────────────────────────────────────────────────────

suite('capability-registry: unregister');

test('unregister specific capability', () => {
  const r = new CapabilityRegistry();
  r.register('tax.calculate', 'sp-a');
  r.register('tax.calculate', 'sp-b');
  r.unregister('tax.calculate', 'sp-a');
  const result = r.resolve('tax.calculate');
  assertEqual(result.length, 1);
  assertEqual(result[0], 'sp-b');
});

test('unregister last specialist removes capability', () => {
  const r = new CapabilityRegistry();
  r.register('vat.compute', 'sp-a');
  r.unregister('vat.compute', 'sp-a');
  assert(!r.has('vat.compute'));
  assertEqual(r.resolve('vat.compute').length, 0);
});

test('unregisterBySpecialist removes all capabilities for specialist', () => {
  const r = new CapabilityRegistry();
  r.register('tax.calculate', 'sp-remove');
  r.register('vat.compute', 'sp-remove');
  r.register('salary.compute', 'sp-remove');
  r.register('tax.calculate', 'sp-keep');
  r.unregisterBySpecialist('sp-remove');

  // sp-remove should be gone from all
  const caps = r.getSpecialistCapabilities('sp-remove');
  assertEqual(caps.length, 0);

  // sp-keep should still be there
  const result = r.resolve('tax.calculate');
  assertEqual(result.length, 1);
  assertEqual(result[0], 'sp-keep');
});

test('unregisterBySpecialist cleans empty capability entries', () => {
  const r = new CapabilityRegistry();
  r.register('only.this', 'sp-only');
  r.unregisterBySpecialist('sp-only');
  assert(!r.has('only.this'));
});

// ─── Idempotent Registration ─────────────────────────────────────────────────

suite('capability-registry: idempotent');

test('double register does not duplicate', () => {
  const r = new CapabilityRegistry();
  r.register('tax.calculate', 'sp-a', 10);
  r.register('tax.calculate', 'sp-a', 10);
  const result = r.resolve('tax.calculate');
  assertEqual(result.length, 1, 'should only appear once');
});

test('re-register updates priority but keeps order', () => {
  const r = new CapabilityRegistry();
  r.register('tax.calculate', 'sp-a', 5);
  r.register('tax.calculate', 'sp-b', 10);
  r.register('tax.calculate', 'sp-a', 20); // update priority
  const result = r.resolve('tax.calculate');
  assertEqual(result[0], 'sp-a', 'sp-a should now be first (priority 20)');
  assertEqual(result[1], 'sp-b');
});

// ─── Plugin Lifecycle ────────────────────────────────────────────────────────

suite('plugin lifecycle: enable/disable/enable');

test('enable → disable → enable cycle', () => {
  const r = new CapabilityRegistry();

  // Enable
  r.register('tax.calculate', 'accountant', 10);
  r.register('vat.compute', 'accountant', 10);
  assert(r.has('tax.calculate'));

  // Disable
  r.unregisterBySpecialist('accountant');
  assert(!r.has('tax.calculate'));
  assert(!r.has('vat.compute'));

  // Re-enable
  r.register('tax.calculate', 'accountant', 10);
  r.register('vat.compute', 'accountant', 10);
  assert(r.has('tax.calculate'));
  assertEqual(r.resolve('tax.calculate')[0], 'accountant');
});

test('disable with multiple specialists preserves others', () => {
  const r = new CapabilityRegistry();
  r.register('tax.calculate', 'sp-a', 10);
  r.register('tax.calculate', 'sp-b', 20);
  r.register('vat.compute', 'sp-a', 10);

  r.unregisterBySpecialist('sp-a');

  assert(r.has('tax.calculate'), 'sp-b still provides tax.calculate');
  assert(!r.has('vat.compute'), 'only sp-a provided vat.compute');
  assertEqual(r.resolve('tax.calculate').length, 1);
  assertEqual(r.resolve('tax.calculate')[0], 'sp-b');
});

test('update specialist (version bump simulation)', () => {
  const r = new CapabilityRegistry();

  // v1
  r.register('tax.calculate', 'accountant', 10);
  assertEqual(r.resolve('tax.calculate')[0], 'accountant');

  // Disable for update
  r.unregisterBySpecialist('accountant');
  assert(!r.has('tax.calculate'));

  // v2 — re-enable with new capability
  r.register('tax.calculate', 'accountant', 10);
  r.register('tax.compare', 'accountant', 10);
  assert(r.has('tax.calculate'));
  assert(r.has('tax.compare'));
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
