// tests/code-patch-runner.test.js — cesta od odpovědi modelu ke skóre
// ══════════════════════════════════════════════════════════════════════════════
// Testuje se proti dočasnému repu s jedním skutečným „fix" commitem, ne proti
// živé historii tohohle projektu — jinak by výsledky měnil každý commit.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  changedLines, deriveTask, buildPrompt, extractFunctionCode,
  applyAndTest, verifyTask, addedTestNames,
} from '../src/eval/code-patch-runner.js';

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const SOURCE_BROKEN = `export function add(a, b) {
  return a - b;
}

export function untouched() {
  return 'stejne';
}
`;
const SOURCE_FIXED = SOURCE_BROKEN.replace('return a - b;', 'return a + b;');
const TEST_FILE = `import { add } from '../src/math.js';
if (add(2, 2) !== 4) { console.error('add je rozbite'); process.exit(1); }
`;

/** Repo s jedním commitem, který opravuje funkci a přidává k ní test. */
function buildFixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'patchfix-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'tests'), { recursive: true });

  writeFileSync(path.join(repo, 'src', 'math.js'), SOURCE_BROKEN);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'initial']);

  writeFileSync(path.join(repo, 'src', 'math.js'), SOURCE_FIXED);
  writeFileSync(path.join(repo, 'tests', 'math.test.js'), TEST_FILE);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'fix(math): scitani ma scitat']);

  const hash = git(repo, ['rev-parse', 'HEAD']).trim();
  return { repo, hash, meta: { hash, source: 'src/math.js', test: 'tests/math.test.js', subject: 'fix(math): scitani ma scitat' } };
}

const fx = buildFixture();

suite('code-patch-runner');

test('changedLines najde upravený řádek v obou verzích', () => {
  const cl = changedLines(fx.repo, fx.hash, 'src/math.js');
  assert(cl.before.includes(2), `čekal řádek 2, dostal ${JSON.stringify(cl.before)}`);
  assert(cl.after.includes(2), `čekal řádek 2, dostal ${JSON.stringify(cl.after)}`);
});

test('deriveTask sestaví úlohu z jediné funkce', () => {
  const { task, reason } = deriveTask(fx.repo, fx.meta);
  assert(task, `úloha se neodvodila: ${reason}`);
  assert(task.functionText.includes('a - b'), 'zadání musí obsahovat vadnou verzi');
  assert(task.goldText.includes('a + b'), 'gold musí obsahovat opravu');
  assert(!task.functionText.includes('untouched'), 'zadání nemá obsahovat sousední funkci');
});

test('zadání neukazuje test ani gold patch', () => {
  const { task } = deriveTask(fx.repo, fx.meta);
  const prompt = buildPrompt(task);
  assert(!prompt.includes('a + b'), 'prompt prozradil opravu');
  assert(!prompt.includes('process.exit'), 'prompt prozradil tělo testu');
  assert(prompt.includes('a - b'), 'prompt neobsahuje vadnou funkci');
});

test('požadované chování se bere z názvů přidaných testů', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'names-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@e.cz']);
  git(repo, ['config', 'user.name', 'T']);
  mkdirSync(path.join(repo, 'tests'), { recursive: true });
  writeFileSync(path.join(repo, 'tests', 'a.test.js'), '');
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'init']);
  writeFileSync(path.join(repo, 'tests', 'a.test.js'),
    "test('scitani vraci soucet', () => {});\nawait testAsync('zaporna cisla', async () => {});\n");
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'test']);
  const hash = git(repo, ['rev-parse', 'HEAD']).trim();
  const names = addedTestNames(repo, hash, 'tests/a.test.js');
  assertEqual(names.length, 2);
  assert(names.includes('scitani vraci soucet'), JSON.stringify(names));
  rmSync(repo, { recursive: true, force: true });
});

test('extractFunctionCode vezme blok v apostrofech', () => {
  const fence = '`'.repeat(3);
  const code = extractFunctionCode(`Tady je oprava:\n\n${fence}javascript\nfunction f() { return 1; }\n${fence}\n`);
  assertEqual(code, 'function f() { return 1; }');
});

test('extractFunctionCode vezme delší z více bloků', () => {
  const fence = '`'.repeat(3);
  const code = extractFunctionCode(`${fence}js\nspatne\n${fence}\n${fence}js\nfunction f() { return 1234567; }\n${fence}`);
  assert(code.includes('1234567'), `vzal špatný blok: ${code}`);
});

test('extractFunctionCode zvládne holý kód bez bloku', () => {
  assert(extractFunctionCode('function f() { return 1; }').includes('return 1'));
});

test('extractFunctionCode vrátí null, když kód není', () => {
  assertEqual(extractFunctionCode('Tuhle vadu neumím opravit.'), null);
  assertEqual(extractFunctionCode(''), null);
});

test('gold patch projde testem, vadná verze ne', () => {
  const { task } = deriveTask(fx.repo, fx.meta);
  const gold = applyAndTest(fx.repo, task, task.goldText);
  assert(gold.passed, `gold neprošel: ${gold.reason}`);
  assertEqual(gold.score, 1);

  const broken = applyAndTest(fx.repo, task, task.functionText);
  assert(!broken.passed, 'vadná verze nesmí projít');
  assertEqual(broken.score, 0);
});

test('nesmyslná odpověď dá nulu a pozná se na syntaxi', () => {
  const { task } = deriveTask(fx.repo, fx.meta);
  const r = applyAndTest(fx.repo, task, 'export function add(a, b) { return a +');
  assertEqual(r.score, 0);
  assertEqual(r.syntaxOk, false);
});

test('prázdná odpověď dá nulu bez pádu', () => {
  const { task } = deriveTask(fx.repo, fx.meta);
  const r = applyAndTest(fx.repo, task, null);
  assertEqual(r.score, 0);
  assert(!r.applied);
});

test('verifyTask potvrdí použitelnou úlohu', () => {
  const { task } = deriveTask(fx.repo, fx.meta);
  const v = verifyTask(fx.repo, task);
  assert(v.usable, `úloha zamítnuta: ${v.reason}`);
});

// Past z 2026-08-20: `git checkout <ref> -- <cesta>` mění index hlavního repa
// i při zápisu do jiného work-tree.  Extrakce ani hodnocení nesmí mít na
// zdrojový repozitář žádný vedlejší účinek.
test('index zdrojového repa zůstane nedotčený', () => {
  const before = git(fx.repo, ['status', '--porcelain']);
  const { task } = deriveTask(fx.repo, fx.meta);
  applyAndTest(fx.repo, task, task.goldText);
  const after = git(fx.repo, ['status', '--porcelain']);
  assertEqual(after, before, 'aplikace patche zanesla změnu do zdrojového repa');
  assertEqual(readFileSync(path.join(fx.repo, 'src', 'math.js'), 'utf8'), SOURCE_FIXED,
    'pracovní strom zdrojového repa se změnil');
});

test('worktree po hodnocení nezůstávají', () => {
  const { task } = deriveTask(fx.repo, fx.meta);
  applyAndTest(fx.repo, task, task.goldText);
  const list = git(fx.repo, ['worktree', 'list']);
  assertEqual(list.trim().split('\n').length, 1, `zůstal worktree navíc:\n${list}`);
});

rmSync(fx.repo, { recursive: true, force: true });
summary();
