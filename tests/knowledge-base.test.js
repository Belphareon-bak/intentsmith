// D2: Knowledge Base — Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import { test as it } from 'node:test';
import Database from 'better-sqlite3';
import { KnowledgeBase, seedTaxRates } from '../src/expertises/knowledge-base.js';

// ─── Setup: in-memory DB ─────────────────────────────────────────────────────

const db = new Database(':memory:');

// Apply migration
const { up } = await import('../src/db/migrations/2026_02_19_007_v68_knowledge_base.js');
up(db);

const kb = new KnowledgeBase(db);

// ─── 1. Schema ───────────────────────────────────────────────────────────────

console.log('\n── 1. Schema ──');

await it('knowledge_facts table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_facts'").get();
  assert(row);
});

await it('knowledge_sources table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_sources'").get();
  assert(row);
});

await it('knowledge_verification_log table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_verification_log'").get();
  assert(row);
});

await it('indexes created', () => {
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
  assert(indexes.includes('idx_kf_domain_cat'));
  assert(indexes.includes('idx_kf_year'));
  assert(indexes.includes('idx_kf_specialist'));
});

// ─── 2. CRUD Operations ─────────────────────────────────────────────────────

console.log('\n── 2. CRUD Operations ──');

await it('setFact + getFact (number)', () => {
  kb.setFact({ domain: 'tax', category: 'income_tax', key: 'base_rate', value: 0.15, year: 2024 });
  const val = kb.getFact('tax', 'income_tax', 'base_rate', 2024);
  assert.equal(val, 0.15);
});

await it('setFact + getFact (string)', () => {
  kb.setFact({ domain: 'tax', category: 'meta', key: 'source', value: 'Finanční správa', value_type: 'string', year: 2024 });
  const val = kb.getFact('tax', 'meta', 'source', 2024);
  assert.equal(val, 'Finanční správa');
});

await it('setFact + getFact (json)', () => {
  kb.setFact({
    domain: 'tax', category: 'flat_expense', key: 'rate_80',
    value: { rate: 0.8, max: 1600000 }, value_type: 'json', year: 2024,
  });
  const val = kb.getFact('tax', 'flat_expense', 'rate_80', 2024);
  assert.deepEqual(val, { rate: 0.8, max: 1600000 });
});

await it('setFact + getFact (boolean)', () => {
  kb.setFact({ domain: 'tax', category: 'flat_tax', key: 'enabled', value: true, value_type: 'boolean', year: 2024 });
  const val = kb.getFact('tax', 'flat_tax', 'enabled', 2024);
  assert.equal(val, true);
});

await it('getFact returns null for missing', () => {
  const val = kb.getFact('tax', 'income_tax', 'nonexistent', 2024);
  assert.equal(val, null);
});

await it('upsert overwrites existing fact', () => {
  kb.setFact({ domain: 'tax', category: 'income_tax', key: 'base_rate', value: 0.16, year: 2024 });
  const val = kb.getFact('tax', 'income_tax', 'base_rate', 2024);
  assert.equal(val, 0.16);
  // Restore
  kb.setFact({ domain: 'tax', category: 'income_tax', key: 'base_rate', value: 0.15, year: 2024 });
});

await it('deleteFact removes fact', () => {
  kb.setFact({ domain: 'test', category: 'tmp', key: 'x', value: 42, year: 2024 });
  assert.equal(kb.getFact('test', 'tmp', 'x', 2024), 42);
  kb.deleteFact('test', 'tmp', 'x', 2024);
  assert.equal(kb.getFact('test', 'tmp', 'x', 2024), null);
});

// ─── 3. Category & Domain Queries ───────────────────────────────────────────

console.log('\n── 3. Category & Domain Queries ──');

await it('getCategory returns all facts as key→value', () => {
  kb.setFact({ domain: 'tax', category: 'vat', key: 'standard_rate', value: 0.21, year: 2024 });
  kb.setFact({ domain: 'tax', category: 'vat', key: 'reduced_rate', value: 0.12, year: 2024 });
  const cat = kb.getCategory('tax', 'vat', 2024);
  assert.equal(cat.standard_rate, 0.21);
  assert.equal(cat.reduced_rate, 0.12);
});

await it('getCategory returns empty for missing', () => {
  const cat = kb.getCategory('tax', 'nonexistent', 2024);
  assert.deepEqual(cat, {});
});

await it('listDomains includes tax', () => {
  const domains = kb.listDomains();
  assert(domains.includes('tax'));
});

await it('listCategories returns categories for domain', () => {
  const cats = kb.listCategories('tax');
  assert(cats.includes('income_tax'));
  assert(cats.includes('vat'));
});

await it('listYears returns years for domain', () => {
  const years = kb.listYears('tax');
  assert(years.includes(2024));
});

await it('count returns fact count', () => {
  const c = kb.count('tax');
  assert(c > 0);
});

// ─── 4. Seed Tax Rates ──────────────────────────────────────────────────────

console.log('\n── 4. Seed Tax Rates ──');

// Create a fresh KB for seed test
const seedDb = new Database(':memory:');
up(seedDb);
const seedKb = new KnowledgeBase(seedDb);

// Import RATES constant
const { RATES } = await import('../src/expertises/tools/tax-rates.js');

await it('seedTaxRates imports successfully', () => {
  const count = seedTaxRates(seedKb, RATES);
  assert(count > 0);
  console.log(`    (seeded ${count} facts)`);
});

await it('seeded data matches RATES for 2024 income_tax.base_rate', () => {
  const val = seedKb.getFact('tax', 'income_tax', 'base_rate', 2024);
  assert.equal(val, RATES[2024].income_tax.base_rate);
});

await it('seeded data matches RATES for 2024 social.osvc_rate', () => {
  const val = seedKb.getFact('tax', 'social', 'osvc_rate', 2024);
  assert.equal(val, RATES[2024].social.osvc_rate);
});

await it('seeded data matches RATES for 2025 income_tax.base_rate', () => {
  const val = seedKb.getFact('tax', 'income_tax', 'base_rate', 2025);
  assert.equal(val, RATES[2025].income_tax.base_rate);
});

await it('seeded data matches RATES for 2024 vat.standard_rate', () => {
  const val = seedKb.getFact('tax', 'vat', 'standard_rate', 2024);
  assert.equal(val, RATES[2024].vat.standard_rate);
});

await it('seeded data matches RATES for 2025 social.osvc_min_monthly', () => {
  const val = seedKb.getFact('tax', 'social', 'osvc_min_monthly', 2025);
  assert.equal(val, RATES[2025].social.osvc_min_monthly);
});

await it('seeded data has both years', () => {
  const years = seedKb.listYears('tax');
  assert(years.includes(2024));
  assert(years.includes(2025));
});

await it('getCategory reconstructs full income_tax for 2024', () => {
  const cat = seedKb.getCategory('tax', 'income_tax', 2024);
  assert.equal(cat.base_rate, 0.15);
  assert.equal(cat.higher_rate, 0.23);
  assert(cat.higher_rate_threshold > 0);
});

await it('seeded JSON values parse correctly (flat_expense)', () => {
  const val = seedKb.getFact('tax', 'flat_expense', 'rate_80', 2024);
  assert(typeof val === 'object');
  assert.equal(val.rate, 0.8);
  assert.equal(val.max, 1600000);
});

await it('getRatesForYear reconstructs full year structure', () => {
  const rates2024 = seedKb.getRatesForYear('tax', 2024);
  assert(rates2024.income_tax);
  assert(rates2024.social);
  assert(rates2024.health);
  assert(rates2024.vat);
  assert.equal(rates2024.income_tax.base_rate, 0.15);
  assert.equal(rates2024.vat.standard_rate, 0.21);
});

await it('seeded fact count is reasonable (2 years × ~30 facts)', () => {
  const count = seedKb.count('tax');
  assert(count >= 40, `Expected ≥40 facts, got ${count}`);
  assert(count <= 200, `Expected ≤200 facts, got ${count}`);
});

// ─── 5. Freshness Check ─────────────────────────────────────────────────────

console.log('\n── 5. Freshness Check ──');

await it('checkFreshness detects stale data', () => {
  // Set a fact with old verification date
  kb.setFact({
    domain: 'test_fresh', category: 'rates', key: 'old_rate',
    value: 42, year: 2024, verified_at: '2024-01-01',
  });
  const check = kb.checkFreshness('test_fresh', 'rates', 180);
  assert(check.stale);
  assert(check.warnings.length > 0);
});

await it('checkFreshness detects provisional data', () => {
  kb.setFact({
    domain: 'test_fresh', category: 'rates', key: 'prov_rate',
    value: 99, year: 2024, is_provisional: true,
    verified_at: new Date().toISOString(),
  });
  const check = kb.checkFreshness('test_fresh', 'rates', 180);
  assert(check.warnings.some(w => w.includes('provisional')));
});

// ─── 6. Verification Sources ─────────────────────────────────────────────────

console.log('\n── 6. Verification Sources ──');

await it('setSource + getSource', () => {
  kb.setSource({
    id: 'cssz_osvc', name: 'ČSSZ — OSVČ sazby', domain: 'tax',
    url: 'https://www.cssz.cz/web/cz/osvc',
    affects: ['social.osvc_rate', 'social.osvc_min_monthly'],
    keywords: ['OSVČ', 'sociální pojištění', 'zálohy'],
    check_frequency_days: 30,
  });
  const src = kb.getSource('cssz_osvc');
  assert(src);
  assert.equal(src.name, 'ČSSZ — OSVČ sazby');
  assert.equal(src.domain, 'tax');
  assert(Array.isArray(src.affects));
  assert(src.affects.includes('social.osvc_rate'));
});

await it('listSources returns sources for domain', () => {
  const sources = kb.listSources('tax');
  assert(sources.length > 0);
  assert(sources.some(s => s.id === 'cssz_osvc'));
});

// ─── 7. Verification Log ────────────────────────────────────────────────────

console.log('\n── 7. Verification Log ──');

await it('logVerification inserts record', () => {
  kb.logVerification({
    action: 'verified',
    triggered_by: 'test',
    notes: 'Unit test verification',
  });
  const row = db.prepare('SELECT * FROM knowledge_verification_log WHERE triggered_by = ?').get('test');
  assert(row);
  assert.equal(row.action, 'verified');
});

// ─── 8. Bulk Operations ─────────────────────────────────────────────────────

console.log('\n── 8. Bulk Operations ──');

await it('bulkSetFacts inserts multiple facts in transaction', () => {
  const before = kb.count('bulk_test');
  kb.bulkSetFacts([
    { domain: 'bulk_test', category: 'a', key: 'x', value: 1, year: 2024 },
    { domain: 'bulk_test', category: 'a', key: 'y', value: 2, year: 2024 },
    { domain: 'bulk_test', category: 'b', key: 'z', value: 3, year: 2024 },
  ]);
  assert.equal(kb.count('bulk_test'), before + 3);
});

await it('bulkSetFacts is idempotent (upsert)', () => {
  const before = kb.count('bulk_test');
  kb.bulkSetFacts([
    { domain: 'bulk_test', category: 'a', key: 'x', value: 10, year: 2024 },
    { domain: 'bulk_test', category: 'a', key: 'y', value: 20, year: 2024 },
  ]);
  assert.equal(kb.count('bulk_test'), before); // No new rows
  assert.equal(kb.getFact('bulk_test', 'a', 'x', 2024), 10); // Updated value
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

db.close();
seedDb.close();
