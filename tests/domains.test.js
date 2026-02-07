// Domain Capabilities Tests
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { DomainRegistry, extractTags } from '../src/domains/index.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n═══ Domain Capabilities Tests ═══\n');

const registry = new DomainRegistry();

// ── Registry initialization ─────────────────────────────────────────────────

console.log('── Registry ──');

test('Registry has recipes', () => {
  assert.ok(registry.recipes.size > 0, `Expected recipes, got ${registry.recipes.size}`);
});

test('Registry has scaffolds', () => {
  assert.ok(registry.scaffolds.size > 0, `Expected scaffolds, got ${registry.scaffolds.size}`);
});

test('Has express-api scaffold', () => {
  const s = registry.getScaffold('express-api');
  assert.ok(s);
  assert.equal(s.id, 'express-api');
  assert.ok(s.files.length >= 3);
});

test('Has react-app scaffold', () => {
  const s = registry.getScaffold('react-app');
  assert.ok(s);
  assert.ok(s.stack.includes('React'));
});

test('Has fullstack scaffold', () => {
  const s = registry.getScaffold('fullstack');
  assert.ok(s);
  assert.ok(s.stack.includes('Express'));
  assert.ok(s.stack.includes('React'));
});

test('Has docker-node recipe', () => {
  const r = registry.getRecipe('docker-node');
  assert.ok(r);
  assert.ok(r.steps.length >= 2);
});

test('Has k8s-deploy recipe', () => {
  assert.ok(registry.getRecipe('k8s-deploy'));
});

test('Has monitoring recipes', () => {
  assert.ok(registry.getRecipe('prometheus-node'));
  assert.ok(registry.getRecipe('healthcheck'));
  assert.ok(registry.getRecipe('structured-logging'));
});

test('Has CI/CD recipes', () => {
  assert.ok(registry.getRecipe('gh-actions-node'));
  assert.ok(registry.getRecipe('gh-actions-docker'));
});

// ── Tag extraction ──────────────────────────────────────────────────────────

console.log('\n── Tag extraction ──');

test('Extracts express tag', () => {
  const tags = extractTags('build an express api');
  assert.ok(tags.includes('express'));
  assert.ok(tags.includes('api'));
});

test('Extracts docker + kubernetes tags', () => {
  const tags = extractTags('deploy to kubernetes with docker');
  assert.ok(tags.includes('docker'));
  assert.ok(tags.includes('kubernetes'));
});

test('Extracts monitoring tags', () => {
  const tags = extractTags('set up monitoring with prometheus and grafana');
  assert.ok(tags.includes('monitoring'));
});

test('Extracts auth tags', () => {
  const tags = extractTags('api s jwt autentizací');
  assert.ok(tags.includes('auth'));
  assert.ok(tags.includes('api'));
});

test('Extracts fullstack tags', () => {
  const tags = extractTags('create a full stack application');
  assert.ok(tags.includes('fullstack'));
});

test('Extracts postgres tag', () => {
  const tags = extractTags('REST API s PostgreSQL');
  assert.ok(tags.includes('postgres'));
});

// ── Search recipes ──────────────────────────────────────────────────────────

console.log('\n── Search ──');

test('searchRecipes by docker tag', () => {
  const results = registry.searchRecipes(['docker']);
  assert.ok(results.length >= 2, `Expected >=2 docker recipes, got ${results.length}`);
  assert.ok(results.every(r => r.tags.includes('docker')));
});

test('searchRecipes by monitoring + node', () => {
  const results = registry.searchRecipes(['monitoring', 'node']);
  assert.ok(results.length >= 1);
});

test('searchScaffolds by express', () => {
  const results = registry.searchScaffolds(['express']);
  assert.ok(results.length >= 1);
  assert.equal(results[0].id, 'express-api');
});

test('searchScaffolds by fullstack', () => {
  const results = registry.searchScaffolds(['fullstack']);
  assert.ok(results.length >= 1);
});

// ── matchRequest ────────────────────────────────────────────────────────────

console.log('\n── matchRequest ──');

test('Matches "build express REST API"', () => {
  const m = registry.matchRequest('build express REST API');
  assert.ok(m.scaffolds.length >= 1, 'Should find express scaffold');
  assert.ok(m.recipes.length >= 0);
});

test('Matches "set up docker with postgres"', () => {
  const m = registry.matchRequest('set up docker with postgres');
  assert.ok(m.recipes.length >= 1, 'Should find docker recipes');
});

test('Matches "nastav monitoring"', () => {
  const m = registry.matchRequest('nastav monitoring s prometheus');
  assert.ok(m.recipes.length >= 1, 'Should find monitoring recipes');
});

test('Matches fullstack request', () => {
  const m = registry.matchRequest('create a full stack app with react and express');
  assert.ok(m.scaffolds.length >= 1);
});

// ── D1 context ──────────────────────────────────────────────────────────────

console.log('\n── D1 Context ──');

test('getD1Context returns formatted string', () => {
  const ctx = registry.getD1Context('build express REST API with docker');
  assert.ok(ctx.includes('Available domain capabilities'));
  assert.ok(ctx.includes('Scaffold') || ctx.includes('Recipe'));
});

test('getD1Context handles no matches', () => {
  const ctx = registry.getD1Context('something completely unrelated xyzzy');
  assert.ok(ctx.includes('No matching'));
});

// ── listAll ─────────────────────────────────────────────────────────────────

console.log('\n── listAll ──');

test('listAll returns recipes and scaffolds', () => {
  const all = registry.listAll();
  assert.ok(all.recipes.length >= 5);
  assert.ok(all.scaffolds.length >= 3);
  assert.ok(all.recipes[0].id);
  assert.ok(all.scaffolds[0].id);
});

// ── Custom registration ─────────────────────────────────────────────────────

console.log('\n── Custom registration ──');

test('addRecipe adds custom recipe', () => {
  registry.addRecipe({
    id: 'custom-1',
    name: 'Custom Recipe',
    tags: ['custom'],
    steps: [{ id: 1, action: 'Do something' }],
  });
  assert.ok(registry.getRecipe('custom-1'));
});

test('addScaffold adds custom scaffold', () => {
  registry.addScaffold({
    id: 'custom-scaffold',
    name: 'Custom Scaffold',
    tags: ['custom'],
    files: [{ path: 'index.js', type: 'code' }],
  });
  assert.ok(registry.getScaffold('custom-scaffold'));
});

test('addRecipe validates required fields', () => {
  assert.throws(() => registry.addRecipe({ id: 'bad' }), /must have/);
});

test('addScaffold validates required fields', () => {
  assert.throws(() => registry.addScaffold({ name: 'bad' }), /must have/);
});

// ── Scaffold file templates ─────────────────────────────────────────────────

console.log('\n── Scaffold templates ──');

test('Express scaffold has server.js with Express code', () => {
  const s = registry.getScaffold('express-api');
  const serverFile = s.files.find(f => f.path.includes('server.js'));
  assert.ok(serverFile);
  assert.ok(serverFile.template.includes('express'));
});

test('React scaffold has App.tsx with Router', () => {
  const s = registry.getScaffold('react-app');
  const appFile = s.files.find(f => f.path.includes('App.tsx'));
  assert.ok(appFile);
  assert.ok(appFile.template.includes('BrowserRouter'));
});

test('Fullstack scaffold has workspaces', () => {
  const s = registry.getScaffold('fullstack');
  const pkg = s.files.find(f => f.path === 'package.json');
  assert.ok(pkg);
  assert.ok(pkg.template.includes('workspaces'));
});

// ── Recipe templates ────────────────────────────────────────────────────────

console.log('\n── Recipe templates ──');

test('Docker recipe has Dockerfile template', () => {
  const r = registry.getRecipe('docker-node');
  const dockerStep = r.steps.find(s => s.action.includes('Dockerfile'));
  assert.ok(dockerStep);
  assert.ok(dockerStep.template.includes('FROM node'));
});

test('K8s recipe has deployment YAML', () => {
  const r = registry.getRecipe('k8s-deploy');
  const deplStep = r.steps.find(s => s.action.includes('deployment'));
  assert.ok(deplStep);
  assert.ok(deplStep.template.includes('apiVersion'));
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
if (failed > 0) process.exit(1);
