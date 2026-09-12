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
  applyAndTest, verifyTask, addedTestNames, parseTestOutput, scoreFromOutput, normalizedGain,
  runIsolatedTest, runIsolatedTests,
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

test('vícesouborový test po prvním timeoutu končí fail-fast', () => {
  const seen = [];
  const runs = runIsolatedTests('/tmp/unused', ['a.test.js', 'b.test.js', 'c.test.js'], 10,
    (_work, file) => {
      seen.push(file);
      return { passed: false, timedOut: file === 'b.test.js', output: '' };
    });
  assertEqual(seen.join(','), 'a.test.js,b.test.js');
  assertEqual(runs.length, 2);
});

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

test('skóre je podíl spravených cílových testů', () => {
  const r = scoreFromOutput(HARNESS_OUT, { failToPass: ['prvni pozadavek', 'druhy pozadavek'] }, false);
  assertEqual(r.score, 0.5);
  assertEqual(r.passed, false);
  assertEqual(r.targetedPassed, 1);
});

test('splnění všech požadavků dá plné skóre', () => {
  const out = '  ✅ prvni pozadavek\n  ✅ druhy pozadavek\n  RESULTS: 2 passed, 0 failed, 0 skipped\n';
  const r = scoreFromOutput(out, { failToPass: ['prvni pozadavek', 'druhy pozadavek'] }, true);
  assertEqual(r.score, 1);
  assert(r.passed);
});

// Oprava, která rozbije jiné chování, není oprava — zisk se ruší celý.
test('pád hlídaného testu srazí skóre na nulu', () => {
  const out = '  ✅ prvni pozadavek\n  ❌ nesouvisejici test: rozbito\n  RESULTS: 1 passed, 1 failed, 0 skipped\n';
  const r = scoreFromOutput(out, { failToPass: ['prvni pozadavek'], passToPass: ['nesouvisejici test'] }, false);
  assertEqual(r.score, 0);
  assertEqual(r.regressions.length, 1);
});

test('bez cílových testů se padá zpět na celý soubor', () => {
  assertEqual(scoreFromOutput(HARNESS_OUT, { failToPass: [] }, true).score, 1);
  assertEqual(scoreFromOutput(HARNESS_OUT, { failToPass: [] }, false).score, 0);
});

// Požadavek, jehož test vůbec nedoběhl, není regrese — jen nesplněný požadavek.
test('cílový test, který nedoběhl, je nesplněný, ne regrese', () => {
  const out = '  ✅ prvni pozadavek\n  RESULTS: 1 passed, 0 failed, 0 skipped\n';
  const r = scoreFromOutput(out, { failToPass: ['prvni pozadavek', 'test ktery nedobehl'] }, false);
  assertEqual(r.score, 0.5);
  assertEqual(r.regressions.length, 0);
});

// Hlídaný test, který v protokolu chybí (soubor spadl dřív), je regrese.
test('chybějící hlídaný test se počítá jako regrese', () => {
  const out = '  ✅ prvni pozadavek\n  RESULTS: 1 passed, 0 failed, 0 skipped\n';
  const r = scoreFromOutput(out, { failToPass: ['prvni pozadavek'], passToPass: ['test ktery zmizel'] }, false);
  assertEqual(r.score, 0);
  assertEqual(r.regressions.length, 1);
});

// ─── styl, kde úspěch mlčí (routes-smoke) ───────────────────────────────────
//
// `assert()` v routes-smoke tiskne jen pády. Oprava se pozná po zmizelém pádu,
// ne po přibylém průchodu — bez toho vypadaly dvě platné úlohy jako mrtvé.

const SILENT_TASK = {
  scoreMode: 'failures-only',
  failToPass: ['chat route validates projects'],
  knownFailing: ['cizi vada, padala uz predtim'],
};

test('u mlčícího stylu je oprava poznat po zmizelém pádu', () => {
  const out = '  ✅ neco jineho\n  FAIL: cizi vada, padala uz predtim\n══ Results: 44 passed, 1 failed ══';
  const r = scoreFromOutput(out, SILENT_TASK, false);
  assertEqual(r.score, 1, 'cílový test zmizel ze spadlých → spraveno');
  assertEqual(r.regressions.length, 0, 'známá cizí vada není regrese');
});

test('u mlčícího stylu je trvající pád nesplněný cíl', () => {
  const out = '  FAIL: chat route validates projects\n══ Results: 44 passed, 1 failed ══';
  assertEqual(scoreFromOutput(out, SILENT_TASK, false).score, 0);
});

test('u mlčícího stylu je nový pád regrese', () => {
  const out = '  FAIL: neco co drive fungovalo\n══ Results: 43 passed, 1 failed ══';
  const r = scoreFromOutput(out, SILENT_TASK, false);
  assertEqual(r.score, 0);
  assertEqual(r.regressions.length, 1);
});

// Prázdný výstup nesmí projít jako „nic nespadlo, tedy spraveno".
test('u mlčícího stylu se prázdný výstup nepočítá jako oprava', () => {
  assertEqual(scoreFromOutput('', SILENT_TASK, false).score, 0);
});

// Nejnebezpečnější případ: běh něco vytiskne a teprve pak spadne.  Cílový test
// se k slovu nedostane, takže „nespadl" — a bez důkazu o doběhnutí by havárie
// dostala plné skóre.  Změřeno na 286a9117, kde úloha kvůli tomu skákala 0↔1.
test('částečný pád se nepočítá jako oprava', () => {
  const out = '  ✅ neco proslo\nTypeError: req.on is not a function\n    at POST /chat\n';
  const r = scoreFromOutput(out, SILENT_TASK, false);
  assertEqual(r.score, 0);
  assert(r.regressions.length > 0, 'nedoběhnutý běh musí být hlášený');
});

test('doběhnutý běh se pozná podle závěrečného souhrnu', () => {
  const out = '  ✅ neco proslo\n══ Results: 44 passed, 0 failed ══';
  assertEqual(scoreFromOutput(out, SILENT_TASK, false).score, 1);
});

test('parseTestOutput rozumí i FAIL: a ❌ bez zprávy', () => {
  const r = parseTestOutput('  FAIL: alfa\n  ❌ beta() → not an object\n══ Results: 2 passed, 2 failed ══');
  assert(r.failed.has('alfa'), [...r.failed].join('|'));
  assert(r.failed.has('beta() → not an object'), [...r.failed].join('|'));
  assertEqual(r.totals.passed, 2);
});

// ─── přínos proti nečinnosti ────────────────────────────────────────────────
//
// Úlohy nemají stejnou podlahu, takže holé skóre se přes sadu sčítat nedá.

test('přínos je nula, když model nepřekonal podlahu', () => {
  assertEqual(normalizedGain(0.33, 0.33), 0);
  assertEqual(normalizedGain(0, 0), 0);
});

test('přínos je jedna při úplné opravě bez ohledu na podlahu', () => {
  assertEqual(normalizedGain(1, 0), 1);
  assertEqual(normalizedGain(1, 0.5), 1);
});

test('přínos škáluje podle zbývajícího prostoru', () => {
  // podlaha 0,5: skóre 0,75 je půlka toho, co zbývalo opravit
  assertEqual(normalizedGain(0.75, 0.5), 0.5);
});

test('zhoršení se ořezává na nulu, ne na záporné číslo', () => {
  assertEqual(normalizedGain(0, 0.33), 0);
});

test('úloha bez prostoru ke zlepšení dá nulu místo dělení nulou', () => {
  assertEqual(normalizedGain(1, 1), 0);
});

// Prostý skript bez protokolu po testech → hodnotí se celý soubor.
test('bez protokolu po testech se úloha hodnotí jako celý soubor', () => {
  const { task } = deriveTask(fx.repo, fx.meta);
  const v = verifyTask(fx.repo, task);
  assert(v.usable, v.reason);
  assertEqual(v.scoreMode, 'file');
  assertEqual(v.failToPass.length, 0);
});

// Testový soubor s protokolem → cílové sady se odvodí ze spuštění.
test('verifyTask odvodí cílové sady ze spuštění', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'ftp-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@e.cz']);
  git(repo, ['config', 'user.name', 'T']);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'tests'), { recursive: true });
  const harness = `export function check(name, ok) {
  if (ok) console.log('  ✅ ' + name);
  else { console.log('  ❌ ' + name + ': selhalo'); process.exitCode = 1; }
}
`;
  const testFile = `import { add } from '../src/math.js';
import { check } from './mini-harness.js';
check('scitani vraci soucet', add(2, 2) === 4);
check('nula funguje', add(0, 0) === 0);
`;
  writeFileSync(path.join(repo, 'tests', 'mini-harness.js'), harness);
  writeFileSync(path.join(repo, 'src', 'math.js'), SOURCE_BROKEN);
  writeFileSync(path.join(repo, 'tests', 'math.test.js'), testFile);
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'initial']);
  writeFileSync(path.join(repo, 'src', 'math.js'), SOURCE_FIXED);
  writeFileSync(path.join(repo, 'tests', 'math.test.js'), testFile + '\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'fix(math): scitani ma scitat']);
  const hash = git(repo, ['rev-parse', 'HEAD']).trim();

  const { task } = deriveTask(repo, { hash, source: 'src/math.js', test: 'tests/math.test.js', subject: 'fix(math): scitani ma scitat' });
  const v = verifyTask(repo, task);
  assert(v.usable, v.reason);
  assertEqual(v.scoreMode, 'named');
  // `scitani vraci soucet` padá před opravou a prochází po ní → cílový test.
  assert(v.failToPass.includes('scitani vraci soucet'), JSON.stringify(v.failToPass));
  // `nula funguje` prochází v obou stavech → hlídaný, ne cílový.
  assert(v.passToPass.includes('nula funguje'), JSON.stringify(v.passToPass));
  assert(!v.failToPass.includes('nula funguje'), 'test procházející před opravou nesmí být cílový');
  rmSync(repo, { recursive: true, force: true });
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
// ─── úloha zasahující i mimo funkce ─────────────────────────────────────────
//
// Tenhle tvar tvořil 20 z 32 kandidátů v historii repa: commit sáhne na
// konstantu nahoře a zároveň do těla funkce dole.  Dokud byla jednotkou jen
// funkce, propadl celý.

const TOP_BROKEN = `// hlavicka souboru
const KROK = 1;

export function posun(a) {
  return a - KROK;
}
`;
const TOP_FIXED = `// hlavicka souboru, jina
const KROK = 10;

export function posun(a) {
  return a + KROK;
}
`;

function buildTopLevelFixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'patchtop-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'tests'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'krok.js'), TOP_BROKEN);
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'initial']);
  writeFileSync(path.join(repo, 'src', 'krok.js'), TOP_FIXED);
  writeFileSync(path.join(repo, 'tests', 'krok.test.js'),
    "import { posun } from '../src/krok.js';\n"
    + "if (posun(1) !== 11) { process.exit(1); }\n");
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'fix(krok): posunout o deset dopredu']);
  const hash = git(repo, ['rev-parse', 'HEAD']).trim();
  return { repo, meta: { hash, source: 'src/krok.js', test: 'tests/krok.test.js', subject: 'fix(krok): posunout o deset dopredu' } };
}

const top = buildTopLevelFixture();

test('úloha unese změnu konstanty i funkce najednou', () => {
  const { task, reason } = deriveTask(top.repo, top.meta);
  assert(task, `úloha se neodvodila: ${reason}`);
  assertEqual(task.functionCount, 2);
  assertEqual(task.spans[0].kind, 'top-level');
  assertEqual(task.spans[0].name, 'KROK');
  assertEqual(task.spans[1].kind, 'function');
  assert(task.functionTexts[0].includes('KROK = 1;'), 'chybí vadná konstanta');
  assert(task.functionTexts[1].includes('a - KROK'), 'chybí vadná funkce');
});

// Změněný komentář nad konstantou nesmí úlohu shodit — nenese chování.
test('změněná hlavička souboru se zahodí, úloha zůstane', () => {
  const { task } = deriveTask(top.repo, top.meta);
  assert(!task.functionTexts.some(t => t.includes('hlavicka souboru')), 'komentář se dostal do zadání');
});

// Totožnost konstanty je jméno, ne text: `KROK = 1` → `KROK = 10` je tentýž úsek.
test('oprava uvnitř hlavičky konstrukce úlohu neshodí', () => {
  const { task } = deriveTask(top.repo, top.meta);
  assert(task.goldTexts[0].includes('KROK = 10;'), 'gold nemá opravenou konstantu');
});

test('zadání pojmenuje, že jde o vrchol souboru', () => {
  const { task } = deriveTask(top.repo, top.meta);
  const prompt = buildPrompt(task);
  assert(prompt.includes('Kód na nejvyšší úrovni souboru 1:'), `chybí popis úseku:\n${prompt}`);
  assert(prompt.includes('Funkce 2:'), `chybí popis funkce:\n${prompt}`);
  assert(!prompt.includes('a + KROK'), 'prompt prozradil opravu');
});

test('gold patch přes konstantu i funkci projde testem', () => {
  const { task } = deriveTask(top.repo, top.meta);
  const r = applyAndTest(top.repo, task, task.goldTexts);
  assert(r.passed, `gold neprošel: ${r.reason}`);
});

// Kdyby se rozsahy vkládaly shora, druhá náhrada by trefila posunuté řádky —
// tady je to vidět na tom, že oprava jednoho ze dvou úseků nestačí.
test('oprava jen funkce bez konstanty neprojde', () => {
  const { task } = deriveTask(top.repo, top.meta);
  const r = applyAndTest(top.repo, task, [task.functionTexts[0], task.goldTexts[1]]);
  assertEqual(r.score, 0);
  assert(r.syntaxOk, 'mělo jít o selhání chování, ne syntaxe');
});

// ─── úloha s víc testovými soubory ──────────────────────────────────────────
//
// Commit, který k jedné opravě dopsal testy do víc souborů, je pro sadu
// cennější než průměrný: víc cílů znamená, že úloha umí i mezistupeň mezi
// 0 a 1.  Musí ale projít **všechny** soubory, jinak by částečná oprava
// dostala plné skóre.

function buildTwoTestFixture() {
  const repo = mkdtempSync(path.join(tmpdir(), 'patchdvatesty-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test']);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'tests'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'obe.js'), 'export function obe(a) {\n  return a - 1;\n}\n');
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'initial']);
  writeFileSync(path.join(repo, 'src', 'obe.js'), 'export function obe(a) {\n  return a + 1;\n}\n');
  writeFileSync(path.join(repo, 'tests', 'prvni.test.js'),
    "import { obe } from '../src/obe.js';\nif (obe(1) !== 2) { process.exit(1); }\n");
  writeFileSync(path.join(repo, 'tests', 'druhy.test.js'),
    "import { obe } from '../src/obe.js';\nif (obe(5) !== 6) { process.exit(1); }\n");
  git(repo, ['add', '-A']); git(repo, ['commit', '-qm', 'fix(obe): scitat misto odcitat']);
  const hash = git(repo, ['rev-parse', 'HEAD']).trim();
  return {
    repo,
    meta: {
      hash, source: 'src/obe.js',
      tests: ['tests/prvni.test.js', 'tests/druhy.test.js'],
      subject: 'fix(obe): scitat misto odcitat',
    },
  };
}

const dva = buildTwoTestFixture();

test('úloha si nese všechny testové soubory', () => {
  const { task, reason } = deriveTask(dva.repo, dva.meta);
  assert(task, `úloha se neodvodila: ${reason}`);
  assertEqual(task.tests.length, 2);
  assertEqual(task.test, 'tests/prvni.test.js');
});

test('gold patch projde oběma testovými soubory', () => {
  const { task } = deriveTask(dva.repo, dva.meta);
  const r = applyAndTest(dva.repo, task, task.goldTexts);
  assert(r.passed, `gold neprošel: ${r.reason}`);
});

test('vadný kód propadne, i když je testů víc', () => {
  const { task } = deriveTask(dva.repo, dva.meta);
  const r = applyAndTest(dva.repo, task, task.functionTexts);
  assertEqual(r.score, 0);
});

// Oprava, která spraví jen jeden soubor, nesmí dostat plné skóre.
test('oprava platná jen pro jeden testový soubor neprojde', () => {
  const { task } = deriveTask(dva.repo, dva.meta);
  const r = applyAndTest(dva.repo, task, ['export function obe(a) {\n  return a === 1 ? 2 : a - 1;\n}']);
  assertEqual(r.score, 0);
  assert(r.syntaxOk, 'mělo jít o selhání chování, ne syntaxe');
});

// Stejné jméno testu ve dvou souborech: jednou prošlo, jednou spadlo.
test('rozporný název testu se počítá jako spadlý', () => {
  const parsed = parseTestOutput('  ✅ stejny nazev\n  ❌ stejny nazev: rozbite\n');
  assert(!parsed.passed.has('stejny nazev'), 'rozporný název zůstal mezi prošlými');
  assert(parsed.failed.has('stejny nazev'), 'rozporný název chybí mezi spadlými');
});

test('isolated model tests receive a private database instead of the parent database', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'codepatch-env-'));
  const original = process.env.C3_DB_PATH;
  try {
    process.env.C3_DB_PATH = '/not-a-real-path/parent-production.sqlite';
    writeFileSync(path.join(work, 'environment.cjs'), 'process.stdout.write(process.env.C3_DB_PATH);');
    const result = runIsolatedTest(work, 'environment.cjs', 15000);
    assert(result.passed, result.output);
    assertEqual(result.output.trim(), path.join(work, 'eval-scratch.sqlite'));
  } finally {
    if (original === undefined) delete process.env.C3_DB_PATH;
    else process.env.C3_DB_PATH = original;
    rmSync(work, { recursive: true, force: true });
  }
});

summary();
