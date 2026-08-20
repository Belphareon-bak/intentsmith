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
  changedLines, deriveTask, buildPrompt, extractFunctionCode, extractFunctionCodes,
  applyAndTest, verifyTask, addedTestNames, parseTestOutput, scoreFromOutput,
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
  assert(task.functionTexts[0].includes('a - b'), 'zadání musí obsahovat vadnou verzi');
  assert(task.goldTexts[0].includes('a + b'), 'gold musí obsahovat opravu');
  assert(!task.functionTexts[0].includes('untouched'), 'zadání nemá obsahovat sousední funkci');
  assertEqual(task.functionCount, 1);
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
  const gold = applyAndTest(fx.repo, task, task.goldTexts);
  assert(gold.passed, `gold neprošel: ${gold.reason}`);
  assertEqual(gold.score, 1);

  const broken = applyAndTest(fx.repo, task, task.functionTexts);
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
  applyAndTest(fx.repo, task, task.goldTexts);
  const after = git(fx.repo, ['status', '--porcelain']);
  assertEqual(after, before, 'aplikace patche zanesla změnu do zdrojového repa');
  assertEqual(readFileSync(path.join(fx.repo, 'src', 'math.js'), 'utf8'), SOURCE_FIXED,
    'pracovní strom zdrojového repa se změnil');
});

test('worktree po hodnocení nezůstávají', () => {
  const { task } = deriveTask(fx.repo, fx.meta);
  applyAndTest(fx.repo, task, task.goldTexts);
  const list = git(fx.repo, ['worktree', 'list']);
  assertEqual(list.trim().split('\n').length, 1, `zůstal worktree navíc:\n${list}`);
});


// ─── odstupňované skóre ─────────────────────────────────────────────────────

const HARNESS_OUT = `═══ upgrade ═══
  ✅ prvni pozadavek
  ❌ druhy pozadavek: cekal true, dostal false
  ✅ nesouvisejici test

  RESULTS: 2 passed, 1 failed, 0 skipped

  FAILURES:
    ❌ [upgrade] druhy pozadavek: cekal true, dostal false
`;

test('parseTestOutput rozliší prošlé a spadlé testy', () => {
  const r = parseTestOutput(HARNESS_OUT);
  assert(r.passed.has('prvni pozadavek'), [...r.passed].join('|'));
  assert(r.failed.has('druhy pozadavek'), [...r.failed].join('|'));
  assertEqual(r.failed.size, 1, 'souhrn selhání se nesmí počítat dvakrát');
  assertEqual(r.totals.passed, 2);
});

test('skóre je podíl splněných požadavků', () => {
  const r = scoreFromOutput(HARNESS_OUT, ['prvni pozadavek', 'druhy pozadavek'], false);
  assertEqual(r.score, 0.5);
  assertEqual(r.passed, false);
  assertEqual(r.targetedPassed, 1);
});

test('splnění všech požadavků dá plné skóre', () => {
  const out = '  ✅ prvni pozadavek\n  ✅ druhy pozadavek\n  RESULTS: 2 passed, 0 failed, 0 skipped\n';
  const r = scoreFromOutput(out, ['prvni pozadavek', 'druhy pozadavek'], true);
  assertEqual(r.score, 1);
  assert(r.passed);
});

// Oprava, která rozbije jiné chování, není oprava — zisk se ruší celý.
test('regrese mimo cílové testy srazí skóre na nulu', () => {
  const out = '  ✅ prvni pozadavek\n  ❌ nesouvisejici test: rozbito\n  RESULTS: 1 passed, 1 failed, 0 skipped\n';
  const r = scoreFromOutput(out, ['prvni pozadavek'], false);
  assertEqual(r.score, 0);
  assertEqual(r.regressions.length, 1);
});

test('bez pojmenovaných požadavků se padá zpět na celý soubor', () => {
  assertEqual(scoreFromOutput(HARNESS_OUT, [], true).score, 1);
  assertEqual(scoreFromOutput(HARNESS_OUT, [], false).score, 0);
});

// Požadavek, jehož test vůbec nedoběhl, není regrese — jen nesplněný požadavek.
test('nenalezený požadavek se počítá jako nesplněný, ne jako regrese', () => {
  const out = '  ✅ prvni pozadavek\n  RESULTS: 1 passed, 0 failed, 0 skipped\n';
  const r = scoreFromOutput(out, ['prvni pozadavek', 'test ktery nedobehl'], false);
  assertEqual(r.score, 0.5);
  assertEqual(r.regressions.length, 0);
});

// ─── úloha zasahující do dvou funkcí ────────────────────────────────────────

const MULTI_BROKEN = `export function low(a) {
  return a - 1;
}

export function high(a) {
  return a - 2;
}
`;
const MULTI_FIXED = `export function low(a) {
  return a + 1;
}

export function high(a) {
  return a + 2;
}
`;

function buildMultiFixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'patchmulti-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'tests'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'pair.js'), MULTI_BROKEN);
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'initial']);
  writeFileSync(path.join(repo, 'src', 'pair.js'), MULTI_FIXED);
  writeFileSync(path.join(repo, 'tests', 'pair.test.js'),
    "import { low, high } from '../src/pair.js';\n"
    + "if (low(1) !== 2 || high(1) !== 3) { process.exit(1); }\n");
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'fix(pair): obe funkce maji scitat']);
  const hash = git(repo, ['rev-parse', 'HEAD']).trim();
  return { repo, meta: { hash, source: 'src/pair.js', test: 'tests/pair.test.js', subject: 'fix(pair): obe funkce maji scitat' } };
}

const multi = buildMultiFixture();

test('úloha unese změnu ve dvou funkcích', () => {
  const { task, reason } = deriveTask(multi.repo, multi.meta);
  assert(task, `úloha se neodvodila: ${reason}`);
  assertEqual(task.functionCount, 2);
  assert(task.functionTexts[0].includes('a - 1'), 'chybí první vadná funkce');
  assert(task.functionTexts[1].includes('a - 2'), 'chybí druhá vadná funkce');
});

test('zadání se dvěma funkcemi je očísluje a řekne si o dva bloky', () => {
  const { task } = deriveTask(multi.repo, multi.meta);
  const prompt = buildPrompt(task);
  assert(prompt.includes('Funkce 1:'), 'chybí očíslování');
  assert(prompt.includes('Funkce 2:'), 'chybí očíslování');
  assert(prompt.includes('2 bloků'), `chybí počet bloků:\n${prompt}`);
  assert(!prompt.includes('a + 1'), 'prompt prozradil opravu');
});

test('gold patch obou funkcí projde testem', () => {
  const { task } = deriveTask(multi.repo, multi.meta);
  const r = applyAndTest(multi.repo, task, task.goldTexts);
  assert(r.passed, `gold neprošel: ${r.reason}`);
});

test('oprava jen jedné z dvou funkcí neprojde', () => {
  const { task } = deriveTask(multi.repo, multi.meta);
  const r = applyAndTest(multi.repo, task, [task.goldTexts[0], task.functionTexts[1]]);
  assertEqual(r.score, 0);
  assert(r.syntaxOk, 'mělo jít o selhání chování, ne syntaxe');
});

test('chybějící druhý blok úlohu propadne, nehádá se', () => {
  const { task } = deriveTask(multi.repo, multi.meta);
  const r = applyAndTest(multi.repo, task, [task.goldTexts[0]]);
  assertEqual(r.score, 0);
  assert(/2 funkc|1 funkc/.test(r.reason), r.reason);
});

test('extractFunctionCodes vezme dva bloky v pořadí', () => {
  const { task } = deriveTask(multi.repo, multi.meta);
  const fence = '`'.repeat(3);
  const resp = `${fence}javascript\nexport function low(a) { return a + 1; }\n${fence}\n\n`
    + `${fence}javascript\nexport function high(a) { return a + 2; }\n${fence}`;
  const codes = extractFunctionCodes(resp, task.spans);
  assertEqual(codes.length, 2);
  assert(codes[0].includes('a + 1'), codes[0]);
  assert(codes[1].includes('a + 2'), codes[1]);
});

// Model se rozepsal a přidal ukázku navíc — bloky se přiřadí podle jména funkce.
test('extractFunctionCodes přiřadí bloky podle jména, když jich přijde víc', () => {
  const { task } = deriveTask(multi.repo, multi.meta);
  const fence = '`'.repeat(3);
  const resp = `Nejdřív ukázka:\n${fence}js\nconst x = 1;\n${fence}\n`
    + `${fence}js\nexport function high(a) { return a + 2; }\n${fence}\n`
    + `${fence}js\nexport function low(a) { return a + 1; }\n${fence}`;
  const codes = extractFunctionCodes(resp, task.spans);
  assert(codes, 'bloky se nepřiřadily');
  assert(codes[0].includes('low'), `první měl být low: ${codes[0]}`);
  assert(codes[1].includes('high'), `druhý měl být high: ${codes[1]}`);
});

test('málo bloků se nedoplňuje odhadem', () => {
  const { task } = deriveTask(multi.repo, multi.meta);
  const fence = '`'.repeat(3);
  assertEqual(extractFunctionCodes(`${fence}js\nexport function low(a) { return a + 1; }\n${fence}`, task.spans), null);
});

rmSync(multi.repo, { recursive: true, force: true });

rmSync(fx.repo, { recursive: true, force: true });
summary();
