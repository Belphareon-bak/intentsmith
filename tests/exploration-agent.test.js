// tests/exploration-agent.test.js — Exploration Agent unit tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { explore, formatExplorationReport } from '../src/code-intel/exploration-agent.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'explore-'));
}

function writeFile(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return name;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ─── Basic Exploration ──────────────────────────────────────────────────────

suite('ExplorationAgent — Basic');

await testAsync('explores codebase and finds files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/auth.js', `
// Authentication module
export function validateToken(token) {
  if (!token) throw new Error('Missing token');
  return { valid: true, userId: 123 };
}

export function hashPassword(password) {
  return 'hashed_' + password;
}
`);
    writeFile(dir, 'src/routes.js', `
import { validateToken } from './auth';

export function authMiddleware(req, res, next) {
  const token = req.headers.authorization;
  validateToken(token);
  next();
}
`);

    const result = await explore(dir, 'validateToken auth');

    assert(result.filesExplored.length >= 1, `should explore ≥1 file, got ${result.filesExplored.length}`);
    assert(result.searchHits >= 0, 'should have search hits');
    assert(result.explorationTime >= 0, 'should report time');
    assert(result.trail.length >= 1, 'should have exploration trail');
  } finally { cleanup(dir); }
});

await testAsync('finds symbols in explored files', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/database.js', `
// database connection manager
export class Database {
  constructor(url) {
    this.url = url;
  }

  async query(sql) {
    return [];
  }
}

export const DEFAULT_URL = 'postgres://localhost/db';
`);

    const result = await explore(dir, 'Database');

    assert(result.symbolsFound.length >= 1, `should find ≥1 symbol, got ${result.symbolsFound.length}`);
    const names = result.symbolsFound.map(s => s.name);
    assert(names.includes('Database') || names.includes('DEFAULT_URL'),
      'should find Database class or DEFAULT_URL constant');
  } finally { cleanup(dir); }
});

await testAsync('follows import chains', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/main.js', `
import { router } from './router';
export function start() { router.init(); }
`);
    writeFile(dir, 'src/router.js', `
import { handler } from './handler';
export const router = { init: handler };
`);
    writeFile(dir, 'src/handler.js', `
export function handler(req) { return { status: 200 }; }
`);

    const result = await explore(dir, 'router handler');

    assert(result.importChains.length >= 1, `should find ≥1 import chain, got ${result.importChains.length}`);
  } finally { cleanup(dir); }
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

suite('ExplorationAgent — Edge Cases');

await testAsync('handles empty project', async () => {
  const dir = tmpDir();
  try {
    const result = await explore(dir, 'anything');

    assertEqual(result.filesExplored.length, 0);
    assert(result.explorationTime >= 0, 'should still report time');
  } finally { cleanup(dir); }
});

await testAsync('respects maxFiles limit', async () => {
  const dir = tmpDir();
  try {
    // Create many files
    for (let i = 0; i < 20; i++) {
      writeFile(dir, `src/module${i}.js`, `export function fn${i}() { return ${i}; }`);
    }

    const result = await explore(dir, 'function', { maxFiles: 5 });

    assert(result.filesExplored.length <= 5, `should respect maxFiles limit, got ${result.filesExplored.length}`);
  } finally { cleanup(dir); }
});

await testAsync('calls onStep callback', async () => {
  const dir = tmpDir();
  try {
    writeFile(dir, 'src/app.js', `export function app() { return 'hello'; }`);

    const steps = [];
    await explore(dir, 'app', {
      onStep: (action, detail) => steps.push({ action, detail }),
    });

    assert(steps.length >= 1, `should call onStep at least once, got ${steps.length}`);
    assert(steps.some(s => s.action === 'search'), 'should have search step');
  } finally { cleanup(dir); }
});

await testAsync('caps iterations', async () => {
  const dir = tmpDir();
  try {
    // Create a chain of imports
    for (let i = 0; i < 30; i++) {
      const imp = i < 29 ? `import { fn${i + 1} } from './module${i + 1}';\n` : '';
      writeFile(dir, `src/module${i}.js`, `${imp}export function fn${i}() { return ${i}; }`);
    }

    const result = await explore(dir, 'fn0', { maxIterations: 2, maxFiles: 50 });

    assert(result.iterations <= 2, `should cap iterations at 2, got ${result.iterations}`);
  } finally { cleanup(dir); }
});

// ─── Formatting ──────────────────────────────────────────────────────────────

suite('ExplorationAgent — Formatting');

test('formatExplorationReport produces markdown', () => {
  const report = formatExplorationReport({
    query: 'how does auth work',
    filesExplored: [
      { path: 'src/auth.js', lines: 50, symbols: [{ name: 'validateToken', type: 'function' }] },
    ],
    symbolsFound: [{ name: 'validateToken', type: 'function', file: 'src/auth.js' }],
    importChains: [{ from: 'src/routes.js', to: 'src/auth' }],
    searchHits: 5,
    iterations: 1,
    trail: [
      { action: 'search', detail: '5 hits in 2 files' },
      { action: 'follow_imports', detail: '1 new files' },
    ],
    explorationTime: 150,
  });

  assert(report.includes('## Exploration Report'), 'should have header');
  assert(report.includes('src/auth.js'), 'should mention explored file');
  assert(report.includes('validateToken'), 'should mention found symbol');
  assert(report.includes('Import Graph'), 'should have import graph');
  assert(report.includes('Exploration Trail'), 'should have trail');
});

test('formatExplorationReport handles empty result', () => {
  const report = formatExplorationReport({
    query: 'nothing',
    filesExplored: [],
    symbolsFound: [],
    importChains: [],
    searchHits: 0,
    iterations: 0,
    trail: [],
    explorationTime: 5,
  });

  assert(report.includes('## Exploration Report'), 'should have header');
  assert(report.includes('nothing'), 'should include query');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

summary();
