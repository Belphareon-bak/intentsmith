/**
 * Sprint 6 Tests — Multi-project, Chat Search, Token Dashboard
 * No external dependencies.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { MultiProjectService, ChatSearchService, TokenDashboardService, slugify } = require('../packages/c3-backend/sprint6-integration.cjs');

let testCount = 0, passCount = 0;
function test(name, fn) { testCount++; try { fn(); passCount++; console.log('  ✅ ' + name); } catch (e) { console.log('  ❌ ' + name + ': ' + e.message); } }
async function asyncTest(name, fn) { testCount++; try { await fn(); passCount++; console.log('  ✅ ' + name); } catch (e) { console.log('  ❌ ' + name + ': ' + e.message); } }

// ── 1. Slugify ───────────────────────────────────────────
console.log('\n--- 1. Slugify ---');
test('basic slug', () => { assert.strictEqual(slugify('Mobilní aplikace'), 'mobilni-aplikace'); });
test('czech diacritics', () => { assert.strictEqual(slugify('Říční čluny žábě'), 'ricni-cluny-zabe'); });
test('special chars', () => { assert.strictEqual(slugify('E-shop (backend)!'), 'e-shop-backend'); });
test('leading/trailing hyphens stripped', () => { assert.strictEqual(slugify('--test--'), 'test'); });
test('max 64 chars', () => { assert.ok(slugify('a'.repeat(200)).length <= 64); });
test('empty → projekt', () => { assert.strictEqual(slugify('!!!'), 'projekt'); });

// ── 2. Multi-project Service ─────────────────────────────
async function runAsync() {

  console.log('\n--- 2. MultiProjectService ---');
  const wsDir = path.join(os.tmpdir(), 'c3-s6-ws-' + Date.now());
  const mps = new MultiProjectService();

  await asyncTest('scan empty workspace', async () => {
    const ws = await mps.scanWorkspace(wsDir);
    assert.strictEqual(ws.projects.length, 0);
    assert.strictEqual(ws.activeProjectSlug, null);
    assert.strictEqual(ws.rootPath, wsDir);
  });

  await asyncTest('create project', async () => {
    const p = await mps.createProject(wsDir, 'Mobilní aplikace');
    assert.strictEqual(p.slug, 'mobilni-aplikace');
    assert.strictEqual(p.phase, 'design');
    assert.strictEqual(p.name, 'Mobilní aplikace');
    // Verify files exist
    const pjPath = path.join(wsDir, 'projects', 'mobilni-aplikace', 'project.json');
    assert.ok(await fs.promises.access(pjPath).then(() => true).catch(() => false));
  });

  await asyncTest('create second project', async () => {
    const p = await mps.createProject(wsDir, 'E-shop backend');
    assert.strictEqual(p.slug, 'e-shop-backend');
  });

  await asyncTest('scan workspace with 2 projects', async () => {
    const ws = await mps.scanWorkspace(wsDir);
    assert.strictEqual(ws.projects.length, 2);
    const names = ws.projects.map(p => p.slug).sort();
    assert.deepStrictEqual(names, ['e-shop-backend', 'mobilni-aplikace']);
  });

  await asyncTest('duplicate project throws', async () => {
    let threw = false;
    try { await mps.createProject(wsDir, 'Mobilní aplikace'); } catch { threw = true; }
    assert.ok(threw);
  });

  await asyncTest('switch project', async () => {
    const p = await mps.switchProject(wsDir, 'mobilni-aplikace');
    assert.ok(p);
    assert.strictEqual(p.slug, 'mobilni-aplikace');
  });

  await asyncTest('get active project', async () => {
    const p = await mps.getActiveProject(wsDir);
    assert.ok(p);
    assert.strictEqual(p.slug, 'mobilni-aplikace');
  });

  await asyncTest('switch to null (no project)', async () => {
    const p = await mps.switchProject(wsDir, null);
    assert.strictEqual(p, null);
    const active = await mps.getActiveProject(wsDir);
    assert.strictEqual(active, null);
  });

  await asyncTest('delete project (soft)', async () => {
    await mps.switchProject(wsDir, 'e-shop-backend');
    await mps.deleteProject(wsDir, 'e-shop-backend');
    const ws = await mps.scanWorkspace(wsDir);
    assert.strictEqual(ws.projects.length, 1);
    assert.strictEqual(ws.activeProjectSlug, null); // Was deactivated
    // Verify trash
    const trashDir = path.join(wsDir, '.c3', 'trash');
    const trashEntries = await fs.promises.readdir(trashDir);
    assert.ok(trashEntries.some(e => e.startsWith('e-shop-backend')));
  });

  await asyncTest('delete nonexistent throws', async () => {
    let threw = false;
    try { await mps.deleteProject(wsDir, 'nonexistent'); } catch { threw = true; }
    assert.ok(threw);
  });

  // ── 3. ChatSearchService ───────────────────────────────

  console.log('\n--- 3. ChatSearchService ---');
  const css = new ChatSearchService();

  await asyncTest('index and search basic', async () => {
    await css.indexMessage({ id: 'm1', projectSlug: 'app', role: 'user', content: 'Navrhni architekturu pro WireGuard VPN', timestamp: new Date().toISOString() });
    await css.indexMessage({ id: 'm2', projectSlug: 'app', role: 'assistant', content: 'Architektura bude mít 3 vrstvy: tunnel, config, a state management', timestamp: new Date().toISOString() });
    await css.indexMessage({ id: 'm3', projectSlug: 'app', role: 'user', content: 'Přidej unit testy pro tunnel service', timestamp: new Date().toISOString() });
    const r = await css.search({ text: 'WireGuard' });
    assert.ok(r.total >= 1);
    assert.ok(r.results[0].entry.content.includes('WireGuard'));
  });

  await asyncTest('search with diacritics', async () => {
    const r = await css.search({ text: 'architekturu' });
    assert.ok(r.total >= 1);
  });

  await asyncTest('search without diacritics finds diacritic content', async () => {
    const r = await css.search({ text: 'architektura' });
    assert.ok(r.total >= 1);
  });

  await asyncTest('search returns snippets', async () => {
    const r = await css.search({ text: 'tunnel' });
    assert.ok(r.total >= 1);
    assert.ok(r.results[0].snippets.length > 0);
    // Snippet should contain « » markers
    assert.ok(r.results[0].snippets[0].includes('\u00ab') || r.results[0].snippets[0].includes('«'));
  });

  await asyncTest('search with role filter', async () => {
    const r = await css.search({ text: 'tunnel', role: 'user' });
    assert.ok(r.total >= 1);
    assert.ok(r.results.every(r => r.entry.role === 'user'));
  });

  await asyncTest('search with project filter', async () => {
    await css.indexMessage({ id: 'm4', projectSlug: 'other', role: 'user', content: 'Different project content', timestamp: new Date().toISOString() });
    const r = await css.search({ text: 'project', projectSlug: 'other' });
    assert.ok(r.total >= 1);
    assert.ok(r.results.every(r => r.entry.projectSlug === 'other'));
  });

  await asyncTest('search no results', async () => {
    const r = await css.search({ text: 'xyznonexistent' });
    assert.strictEqual(r.total, 0);
  });

  await asyncTest('bulk index', async () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      id: 'bulk' + i, projectSlug: 'bulk', role: i % 2 === 0 ? 'user' : 'assistant',
      content: 'Message number ' + i + (i % 10 === 0 ? ' special keyword' : ''),
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
    }));
    const count = await css.indexBulk(messages);
    assert.strictEqual(count, 100);
  });

  await asyncTest('search with limit', async () => {
    const r = await css.search({ text: 'message', limit: 5 });
    assert.ok(r.results.length <= 5);
    assert.ok(r.total > 5); // More than limit available
  });

  await asyncTest('get stats', async () => {
    const stats = await css.getStats();
    assert.ok(stats.totalMessages > 100);
    assert.ok(stats.projects.includes('app'));
    assert.ok(stats.projects.includes('bulk'));
  });

  await asyncTest('clear project removes entries', async () => {
    await css.clearProject('bulk');
    const stats = await css.getStats();
    assert.ok(!stats.projects.includes('bulk'));
    const r = await css.search({ text: 'message', projectSlug: 'bulk' });
    assert.strictEqual(r.total, 0);
  });

  await asyncTest('search queryTime is fast', async () => {
    const r = await css.search({ text: 'WireGuard' });
    assert.ok(r.queryTimeMs < 100); // Should be very fast for in-memory
  });

  // ── 4. TokenDashboardService ───────────────────────────

  console.log('\n--- 4. TokenDashboardService ---');
  const tds = new TokenDashboardService();

  await asyncTest('record and get stats', async () => {
    const now = new Date();
    await tds.recordUsage({
      turnId: 't1', projectSlug: 'app', intent: 'DESIGN',
      inputTokens: 500, outputTokens: 1000, totalTokens: 1500,
      model: 'claude-3-sonnet', timestamp: now.toISOString(),
    });
    await tds.recordUsage({
      turnId: 't2', projectSlug: 'app', intent: 'CODE',
      inputTokens: 800, outputTokens: 2000, totalTokens: 2800,
      model: 'claude-3-sonnet', timestamp: now.toISOString(),
    });
    await tds.recordUsage({
      turnId: 't3', projectSlug: 'other', intent: 'CONVERSATIONAL',
      inputTokens: 100, outputTokens: 200, totalTokens: 300,
      model: 'local', timestamp: now.toISOString(),
    });

    const stats = await tds.getStats('app');
    assert.strictEqual(stats.project, 4300); // 1500 + 2800
    assert.ok(stats.today >= 4300);
    assert.ok(stats.byIntent.length === 2);
    assert.ok(stats.byIntent[0].intent === 'CODE'); // Largest first
    assert.ok(stats.byModel.length === 1);
  });

  await asyncTest('all-time includes all projects', async () => {
    const stats = await tds.getStats();
    assert.strictEqual(stats.allTime, 4600); // 1500 + 2800 + 300
    assert.strictEqual(stats.project, 4600); // No filter
  });

  await asyncTest('intent percentages add to 100', async () => {
    const stats = await tds.getStats('app');
    const totalPct = stats.byIntent.reduce((s, i) => s + i.percentage, 0);
    assert.ok(Math.abs(totalPct - 100) < 0.1);
  });

  await asyncTest('daily usage present', async () => {
    const stats = await tds.getStats('app');
    assert.ok(stats.dailyUsage.length >= 1);
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(stats.dailyUsage.some(d => d.date === today));
  });

  await asyncTest('get records with filter', async () => {
    const recs = await tds.getRecords('app');
    assert.strictEqual(recs.length, 2);
    const all = await tds.getRecords();
    assert.strictEqual(all.length, 3);
  });

  await asyncTest('clear project removes records', async () => {
    await tds.clearProject('other');
    const recs = await tds.getRecords('other');
    assert.strictEqual(recs.length, 0);
    const all = await tds.getRecords();
    assert.strictEqual(all.length, 2); // Only 'app' remains
  });

  await asyncTest('model breakdown', async () => {
    const stats = await tds.getStats();
    assert.ok(stats.byModel.length >= 1);
    assert.ok(stats.byModel[0].model === 'claude-3-sonnet');
  });

  // ── 5. Search Performance ──────────────────────────────

  console.log('\n--- 5. Search Performance ---');

  await asyncTest('index 1000 messages < 200ms', async () => {
    const css2 = new ChatSearchService();
    const messages = Array.from({ length: 1000 }, (_, i) => ({
      id: 'perf' + i, projectSlug: 'perf', role: 'user',
      content: 'Zpráva číslo ' + i + ' s obsahem pro testování vyhledávání v konverzaci projekt WireGuard tunnel architektura',
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
    }));
    const start = Date.now();
    await css2.indexBulk(messages);
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, 'Bulk index took ' + elapsed + 'ms');
  });

  await asyncTest('search 1000 messages < 50ms', async () => {
    const css2 = new ChatSearchService();
    const messages = Array.from({ length: 1000 }, (_, i) => ({
      id: 'perf2-' + i, projectSlug: 'perf', role: 'user',
      content: 'Test message ' + i + (i % 50 === 0 ? ' WireGuard' : ''),
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
    }));
    await css2.indexBulk(messages);
    const start = Date.now();
    const r = await css2.search({ text: 'WireGuard' });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, 'Search took ' + elapsed + 'ms');
    assert.ok(r.total > 0);
  });

  // ── Cleanup ────────────────────────────────────────────
  await fs.promises.rm(wsDir, { recursive: true, force: true });
}

runAsync().then(() => {
  console.log('\n=== Sprint 6 Tests: ' + passCount + '/' + testCount + ' passed ===');
  if (passCount < testCount) process.exit(1);
}).catch(err => { console.error('Test runner error:', err); process.exit(1); });
