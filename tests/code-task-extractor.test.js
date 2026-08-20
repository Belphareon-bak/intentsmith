// tests/code-task-extractor.test.js — vytěžování evaluačních úloh z historie
// ══════════════════════════════════════════════════════════════════════════════
// Testuje se proti dočasnému git repu, ne proti tomuhle projektu — kdyby se
// testovalo na živé historii, výsledky by se měnily s každým commitem.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  findCandidates, verifyCandidate, extractTasks, runTest,
} from '../src/eval/code-task-extractor.js';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * Postaví miniaturní repo s jedním skutečným „fix" commitem:
 * vadná funkce + test, který ji odhalí.
 */
function buildFixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'evalfix-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'tests'), { recursive: true });

  // Výchozí stav: sčítání je rozbité.
  writeFileSync(path.join(repo, 'src', 'math.js'), 'export function add(a, b) { return a - b; }\n');
  writeFileSync(path.join(repo, 'tests', 'math.test.js'),
    "import { add } from '../src/math.js';\nif (add(2, 2) !== 4) { process.exit(1); }\n");
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'initial']);

  // Oprava spolu s testem — přesně tvar, který extraktor hledá.
  writeFileSync(path.join(repo, 'src', 'math.js'), 'export function add(a, b) { return a + b; }\n');
  writeFileSync(path.join(repo, 'tests', 'math.test.js'),
    "import { add } from '../src/math.js';\nif (add(2, 2) !== 4) { process.exit(1); }\nif (add(0, 0) !== 0) { process.exit(1); }\n");
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'fix(math): add sečítalo místo odčítalo']);

  return repo;
}

function cleanup(repo) {
  try { rmSync(repo, { recursive: true, force: true }); } catch { /* už je pryč */ }
}

// ─── Hledání kandidátů ──────────────────────────────────────────────────────

suite('findCandidates');

await testAsync('najde commit, který mění zdroják i jeho test', async () => {
  const repo = buildFixture();
  const found = findCandidates(repo, { limit: 10 });
  assertEqual(found.length, 1);
  assertEqual(found[0].source, 'src/math.js');
  assertEqual(found[0].test, 'tests/math.test.js');
  assert(/fix\(math\)/.test(found[0].subject), found[0].subject);
  cleanup(repo);
});

await testAsync('commit bez testu se nebere', async () => {
  const repo = buildFixture();
  writeFileSync(path.join(repo, 'src', 'math.js'), 'export function add(a, b) { return a + b; } // pozn.\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'chore: komentář']);
  assertEqual(findCandidates(repo, { limit: 10 }).length, 1, 'přibyl commit bez testu — nesmí projít');
  cleanup(repo);
});

await testAsync('příliš velký diff se odfiltruje', async () => {
  const repo = buildFixture();
  assertEqual(findCandidates(repo, { limit: 10, maxDiffLines: 1 }).length, 0);
  cleanup(repo);
});

await testAsync('víc zdrojáků najednou se nebere', async () => {
  // U víc souborů není jednoznačné, co má model opravit — úloha by měřila
  // schopnost uhodnout zadání.
  const repo = buildFixture();
  writeFileSync(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  writeFileSync(path.join(repo, 'src', 'b.js'), 'export const b = 2;\n');
  writeFileSync(path.join(repo, 'tests', 'ab.test.js'), 'process.exit(0);\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'fix: dva soubory']);
  const found = findCandidates(repo, { limit: 10 });
  assert(found.every(c => c.source !== 'src/a.js'), 'commit se dvěma zdrojáky nesmí projít');
  cleanup(repo);
});

// ─── Ověřování ──────────────────────────────────────────────────────────────

suite('verifyCandidate');

await testAsync('úloha, která se reprodukuje, projde', async () => {
  const repo = buildFixture();
  const [candidate] = findCandidates(repo, { limit: 10 });
  const verified = verifyCandidate(repo, candidate);
  assertEqual(verified.usable, true, verified.reason || '');
  assert(verified.before.includes('a - b'), 'stav před opravou musí nést vadu');
  assert(verified.after.includes('a + b'), 'stav po opravě musí být opravený');
  cleanup(repo);
});

await testAsync('úloha, kde test projde i před opravou, se zahodí', async () => {
  // Test, který vadu neodhalí, jako orákulum nefunguje — úloha nic neměří.
  const repo = mkdtempSync(path.join(tmpdir(), 'evalnoop-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@e.cz']); git(repo, ['config', 'user.name', 'T']);
  mkdirSync(path.join(repo, 'src')); mkdirSync(path.join(repo, 'tests'));
  writeFileSync(path.join(repo, 'src', 'x.js'), 'export const x = 1;\n');
  writeFileSync(path.join(repo, 'tests', 'x.test.js'), 'process.exit(0);\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'init']);
  writeFileSync(path.join(repo, 'src', 'x.js'), 'export const x = 2;\n');
  writeFileSync(path.join(repo, 'tests', 'x.test.js'), 'process.exit(0); // upraveno\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'fix: nic neměří']);

  const [candidate] = findCandidates(repo, { limit: 10 });
  const verified = verifyCandidate(repo, candidate);
  assertEqual(verified.usable, false);
  assert(/nic neměří/.test(verified.reason), verified.reason);
  cleanup(repo);
});

// ─── Žádné vedlejší účinky ──────────────────────────────────────────────────

suite('extrakce nesmí sahat na repozitář');

await testAsync('index zdrojového repa zůstane nedotčený', async () => {
  // Regrese: `git checkout <ref> -- <cesta>` s --work-tree zapisuje i do indexu
  // hlavního repa. Při prvním běhu to zaneslo do stage staré verze šesti
  // zdrojáků; commit by tiše vrátil několik oprav.
  const repo = buildFixture();
  const before = git(repo, ['status', '--porcelain']);
  extractTasks(repo, { count: 5, limit: 10 });
  const after = git(repo, ['status', '--porcelain']);
  assertEqual(after, before, 'extrakce změnila stav repa');
  cleanup(repo);
});

await testAsync('pracovní strom zůstane na původním commitu', async () => {
  const repo = buildFixture();
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  extractTasks(repo, { count: 5, limit: 10 });
  assertEqual(git(repo, ['rev-parse', 'HEAD']).trim(), head);
  cleanup(repo);
});

await testAsync('dočasné worktree se uklidí', async () => {
  const repo = buildFixture();
  extractTasks(repo, { count: 5, limit: 10 });
  const list = git(repo, ['worktree', 'list']);
  assertEqual(list.split('\n').filter(Boolean).length, 1, `zbyl worktree navíc:\n${list}`);
  cleanup(repo);
});

// ─── Kompletní vytěžení ─────────────────────────────────────────────────────

suite('extractTasks');

await testAsync('vrátí ověřené úlohy i důvody odmítnutí', async () => {
  const repo = buildFixture();
  const { tasks, rejected, examined } = extractTasks(repo, { count: 5, limit: 10 });
  assertEqual(tasks.length, 1);
  assertEqual(rejected.length, 0);
  assert(examined >= 1);
  assert(tasks[0].before && tasks[0].after, 'úloha nese obojí stav');
  cleanup(repo);
});

await testAsync('respektuje požadovaný počet', async () => {
  const repo = buildFixture();
  assertEqual(extractTasks(repo, { count: 0, limit: 10 }).tasks.length, 0);
  cleanup(repo);
});

await testAsync('prázdná historie nespadne', async () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'evalempty-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@e.cz']); git(repo, ['config', 'user.name', 'T']);
  writeFileSync(path.join(repo, 'README.md'), 'nic\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'init']);
  assertEqual(extractTasks(repo, { count: 5, limit: 10 }).tasks.length, 0);
  cleanup(repo);
});

summary();
