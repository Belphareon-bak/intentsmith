// v121: Ledger Rewire — Verification Tests
// ══════════════════════════════════════════════════════════════════════════════
// Verifies ledger modules live in specialist package and have no core imports.

import { suite, test, assert, assertEqual, summary } from './harness.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SPECIALIST_LEDGER = path.join(ROOT, 'specialists', 'accountant-cz', 'ledger');
const OLD_LEDGER = path.join(ROOT, 'src', 'expertises', 'ledger');

const LEDGER_FILES = [
  'ledger-engine.js',
  'ledger-repository.js',
  'ledger-vat.js',
  'ledger-compliance.js',
  'ledger-reports.js',
  'ledger-insurance.js',
  'ledger-annual.js',
];

// ─── File Location ───────────────────────────────────────────────────────────

suite('ledger: file location');

test('specialist ledger directory exists', () => {
  assert(fs.existsSync(SPECIALIST_LEDGER), `${SPECIALIST_LEDGER} should exist`);
});

test('old ledger directory removed', () => {
  assert(!fs.existsSync(OLD_LEDGER), `${OLD_LEDGER} should no longer exist`);
});

for (const file of LEDGER_FILES) {
  test(`${file} exists in specialist package`, () => {
    const filePath = path.join(SPECIALIST_LEDGER, file);
    assert(fs.existsSync(filePath), `${filePath} should exist`);
  });
}

// ─── No Core Imports ─────────────────────────────────────────────────────────

suite('ledger: no core imports');

for (const file of LEDGER_FILES) {
  test(`${file} has no ../../src/ imports`, () => {
    const content = fs.readFileSync(path.join(SPECIALIST_LEDGER, file), 'utf-8');
    const coreImportPattern = /from\s+['"]\.\.\/\.\.\/src\//;
    assert(!coreImportPattern.test(content),
      `${file} should not import from ../../src/`);
  });
}

// ─── Module Loading ──────────────────────────────────────────────────────────

suite('ledger: modules load correctly');

test('ledger-engine exports expected functions', async () => {
  const mod = await import(path.join(SPECIALIST_LEDGER, 'ledger-engine.js'));
  assert(typeof mod.toCents === 'function', 'toCents should exist');
  assert(typeof mod.toCZK === 'function', 'toCZK should exist');
  assert(typeof mod.aggregateEntries === 'function', 'aggregateEntries should exist');
  assert(typeof mod.computeTaxBase === 'function', 'computeTaxBase should exist');
});

test('ledger-repository exports LedgerRepository', async () => {
  const mod = await import(path.join(SPECIALIST_LEDGER, 'ledger-repository.js'));
  assert(typeof mod.LedgerRepository === 'function', 'LedgerRepository should be a class');
});

test('ledger-vat exports expected functions', async () => {
  const mod = await import(path.join(SPECIALIST_LEDGER, 'ledger-vat.js'));
  assert(typeof mod.computeVATReturn === 'function', 'computeVATReturn should exist');
  assert(typeof mod.validateVATEntry === 'function', 'validateVATEntry should exist');
});

test('ledger-compliance exports expected functions', async () => {
  const mod = await import(path.join(SPECIALIST_LEDGER, 'ledger-compliance.js'));
  assert(typeof mod.getObligations === 'function', 'getObligations should exist');
  assert(typeof mod.runComplianceCheck === 'function', 'runComplianceCheck should exist');
});

test('ledger-reports exports expected functions', async () => {
  const mod = await import(path.join(SPECIALIST_LEDGER, 'ledger-reports.js'));
  assert(typeof mod.generateDPFOReport === 'function', 'generateDPFOReport should exist');
  assert(typeof mod.formatReportAsMarkdown === 'function', 'formatReportAsMarkdown should exist');
});

test('ledger-insurance exports expected functions', async () => {
  const mod = await import(path.join(SPECIALIST_LEDGER, 'ledger-insurance.js'));
  assert(typeof mod.computeSocialOverview === 'function');
  assert(typeof mod.computeHealthOverview === 'function');
});

test('ledger-annual exports expected functions', async () => {
  const mod = await import(path.join(SPECIALIST_LEDGER, 'ledger-annual.js'));
  assert(typeof mod.generateTaxReturnData === 'function');
  assert(typeof mod.computeYearCloseSummary === 'function');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
