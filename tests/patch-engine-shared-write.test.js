// Patch engine zapisuje sdílenou cestou — a volá ji doopravdy (M2-1)
// ==============================================================================
//
// Do `M2` měl patch engine **vlastní** `tmp + rename`: bez zámku, bez `fsync`,
// s temp jménem, které se dvěma běhy sráží, a se zahozenými právy cíle.  Dvě
// BUILD smyčky nad jedním souborem o sobě nevěděly vůbec.
//
// Tahle sada nedokazuje, že `writeUserFile` je správný — od toho je
// `guarded-write.test.js`.  Dokazuje to, co se v tomhle repu opakovaně ukázalo
// jako slabé místo: že se ta cesta **volá**, a to z volacího místa, ne
// z atrapy.  Třikrát se stalo, že vrstva byla v pořádku a mezivrstva jí
// nepředala signál ani běh; proto se tu zkoumá řetěz
//
//   `lifecycle-build` → `runFixLoop` → `applyPatchSet` → `writeUserFile`
//
// a ne jednotka na jeho konci.
//
// **Co se neptá.**  Podle rozhodnutí `028` je auto-approve výchozí stav, takže
// běžný patch otázku nevyvolá.  Sada to ověřuje v obou směrech: obyčejný soubor
// se zapíše bez ptaní, citlivý se zeptá — a zamítnutí **nic nezapíše**.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { configureEffects } from '../src/executor/effects.js';
import { handleApprovalDecide } from '../src/mobile/handlers.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';
import { applyPatch, applyPatchSet, rollbackPatch } from '../src/patch/patch-engine.js';
import { clearBackups, saveBackup } from '../src/patch/patch-applier.js';
import { runFixLoop } from '../src/executor/execution-loop.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

console.log('\n=== Patch engine na sdílené cestě (M2-1) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-patch-shared-'));
const projectRoot = path.join(runtimeDir, 'projekt');
const db = new Database(path.join(runtimeDir, 'patch.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const journal = new OperationJournal(db);
const phone = { deviceId: 'device-telefon', scopes: ['read:approvals', 'write:approvals'] };
const yieldTick = () => new Promise(resolve => setImmediate(resolve));

let operationCounter = 0;
const nextOperationId = () => `op-patch-${String(++operationCounter).padStart(10, '0')}`;

configureEffects({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });

const SAMPLE = [
  'function login(user) {',
  '  return db.find(user);',
  '}',
  '',
].join('\n');

function reset() {
  db.exec('DELETE FROM mobile_approvals; DELETE FROM mobile_operations; DELETE FROM file_write_locks;');
  clearBackups();
  rmSync(projectRoot, { recursive: true, force: true });
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(path.join(projectRoot, 'app.js'), SAMPLE, 'utf8');
}

/** Patch, který přidá řádek do `login` — v cestě, kterou si zvolí volající. */
const patchFor = (file, added = '  if (!user) throw new Error("no user");') => ({
  file,
  type: 'fix',
  regions: [{
    anchor: 'login(user)',
    anchorType: 'function',
    old: ['  return db.find(user);'],
    new: [added, '  return db.find(user);'],
  }],
});

/**
 * Odpověz na jediný čekající approval tak, jak by to udělal telefon.
 *
 * Otisk se **čte z řádku**, ne počítá znovu.  Spočítaný otisk umí tiše minout
 * (telefon by dostal `409`) a čekající zápis by pak spadl na `timeout` — tedy
 * na jiném místě, než kde je vada.  Odpověď se proto kontroluje hned.
 */
async function answerPending(decision) {
  // Čeká se na **čas, ne na počet tiků.**  Než se přijde na řadu citlivý soubor,
  // stihne se zapsat ten předchozí — a `fsync` je skutečné I/O, které se
  // čtyřmi sty `setImmediate` tiky přeskočí, když je stroj zaneprázdněný.
  // Sada tak prošla samostatně a padala v gate; to není flake, to je špatně
  // zvolená jednotka čekání.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const row = db.prepare(
      'SELECT id, payload_fingerprint FROM mobile_approvals WHERE decided_at IS NULL',
    ).get();
    if (row) {
      const response = await handleApprovalDecide({
        rawDb: db, journal, principal: phone, params: { id: row.id },
        body: { decision, operationId: nextOperationId(), payloadFingerprint: row.payload_fingerprint },
      });
      assert.ok(response?.status === undefined || response.status < 400,
        `telefon nedokázal odpovědět: ${JSON.stringify(response)}`);
      return response;
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('žádný approval nevznikl do 15 s');
}

// ── 1. Běžný patch: zapíše se, a nikdo se neptá ────────────────────────────

await test('běžný patch se zapíše sdílenou cestou a otázku nevyvolá', async () => {
  reset();
  const result = await applyPatch(patchFor('app.js'), projectRoot, { runId: 'run-1' });

  assert.equal(result.success, true, result.errors?.join(', '));
  assert.equal(result.asked, false, 'obyčejný soubor se ptát nemá (028)');
  const onDisk = readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
  assert.ok(onDisk.includes('throw new Error("no user")'), 'patch není na disku');

  const pending = db.prepare('SELECT COUNT(*) AS n FROM mobile_approvals').get();
  assert.equal(pending.n, 0, 'běžný zápis vyrobil approval — to je zpátky mýtné');
});

await test('zámek se po zápisu pustí — jinak by druhá iterace narazila do sebe', async () => {
  reset();
  const first = await applyPatch(patchFor('app.js'), projectRoot, { runId: 'run-lock-1' });
  assert.equal(first.success, true, first.errors?.join(', '));

  // **Nejdřív že vůbec vznikl.**  „Nula držených zámků" je pravda i tehdy, když
  // se žádný zámek nebere — přesně tak vypadal patch engine před `M2` a test by
  // to nepoznal.
  const taken = db.prepare(
    'SELECT released_at FROM file_write_locks WHERE run_id = ?',
  ).all('run-lock-1');
  assert.equal(taken.length, 1, 'zápis si nevzal zámek — jde mimo sdílenou cestu');
  assert.ok(taken[0].released_at, 'zámek zůstal držený i po zápisu');

  const held = db.prepare(
    'SELECT COUNT(*) AS n FROM file_write_locks WHERE released_at IS NULL',
  ).get();
  assert.equal(held.n, 0, 'po zápisu zůstal držený zámek — druhá iterace by narazila do sebe');

  // A totéž ještě zvenčí: **jiný běh** musí na týž soubor projít.  Kotví se na
  // řádek, který tam nechal první patch, protože soubor už není původní.
  const second = await applyPatch({
    file: 'app.js',
    type: 'fix',
    regions: [{
      anchor: 'login(user)',
      anchorType: 'function',
      old: ['  if (!user) throw new Error("no user");'],
      new: ['  if (!user) throw new Error("second");'],
    }],
  }, projectRoot, { runId: 'run-lock-2' });
  assert.equal(second.success, true, `druhý běh neprošel: ${second.state} ${second.errors?.join(', ') || ''}`);
});

await test('práva cíle přežijí patch — spustitelný skript zůstane spustitelný', async () => {
  reset();
  const script = path.join(projectRoot, 'app.js');
  chmodSync(script, 0o755);
  const result = await applyPatch(patchFor('app.js'), projectRoot, { runId: 'run-mode' });
  assert.equal(result.success, true, result.errors?.join(', '));
  assert.equal(statSync(script).mode & 0o777, 0o755, 'patch shodil práva cíle');
});

// ── 2. Identita zápisu není volitelná ──────────────────────────────────────

await test('applyPatch bez runId vyhodí — zámek bez vlastníka je jen zdržení', async () => {
  reset();
  await assert.rejects(
    () => applyPatch(patchFor('app.js'), projectRoot, {}),
    /runId required/,
    'chybějící vlastník prošel tiše',
  );
});

await test('rollbackPatch bez runId vyhodí — návrat je taky zápis', async () => {
  reset();
  await assert.rejects(
    () => rollbackPatch('app.js', projectRoot, {}),
    /runId required/,
  );
});

// ── 3. Zrušený běh nezapíše ────────────────────────────────────────────────

await test('zrušený běh nezapíše a řekne to jménem, ne `false`', async () => {
  reset();
  const controller = new AbortController();
  controller.abort();

  const result = await applyPatch(patchFor('app.js'), projectRoot, {
    runId: 'run-cancel', signal: controller.signal,
  });

  assert.equal(result.success, false);
  assert.equal(result.written, false);
  assert.equal(result.state, 'cancelled', `stav je ${result.state}, ne jméno zrušení`);
  assert.equal(readFileSync(path.join(projectRoot, 'app.js'), 'utf8'), SAMPLE,
    'zrušený běh přesto zapsal');
});

// ── 4. Citlivý soubor: ptá se — a zamítnutí nic nezapíše ───────────────────

await test('patch do CI souboru se ptá a zamítnutí nic nezapíše', async () => {
  reset();
  const rel = path.join('.github', 'workflows', 'deploy.yml');
  const target = path.join(projectRoot, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'jobs:\n  build:\n    runs-on: ubuntu\n', 'utf8');

  const patch = {
    file: rel,
    type: 'fix',
    regions: [{
      anchor: 'runs-on: ubuntu',
      anchorType: 'line',
      old: ['    runs-on: ubuntu'],
      new: ['    runs-on: ubuntu-latest'],
    }],
  };

  const pending = applyPatch(patch, projectRoot, { runId: 'run-ci', timeoutMs: 30_000 });
  await answerPending('reject');
  const result = await pending;

  assert.equal(result.success, false, 'zamítnutý patch se tvářil jako úspěch');
  assert.equal(result.written, false, 'zamítnutý patch se přesto zapsal');
  assert.match(String(result.state), /^reject/, `stav ${result.state} není jméno zamítnutí`);
  assert.ok(readFileSync(target, 'utf8').includes('runs-on: ubuntu\n'),
    'zamítnutý patch přesto změnil soubor');
});

// ── 5. Sada: nezapsaný patch vrátí i ty předchozí ──────────────────────────

await test('nezapsaný patch v sadě vrátí předchozí soubory do původního stavu', async () => {
  reset();
  const rel = path.join('.github', 'workflows', 'deploy.yml');
  const ci = path.join(projectRoot, rel);
  mkdirSync(path.dirname(ci), { recursive: true });
  writeFileSync(ci, 'jobs:\n  build:\n    runs-on: ubuntu\n', 'utf8');

  // **Druhý patch se zarazí deterministicky**, ne časováním: míří na citlivý
  // soubor, politika se zeptá a telefon zamítne.  Rasy se v testu, který má
  // dokazovat rollback, nedají odlišit od průchodu.
  const patches = [
    patchFor('app.js'),
    {
      file: rel,
      type: 'fix',
      regions: [{
        anchor: 'runs-on: ubuntu',
        anchorType: 'line',
        old: ['    runs-on: ubuntu'],
        new: ['    runs-on: ubuntu-latest'],
      }],
    },
  ];

  const run = applyPatchSet(patches, projectRoot, { runId: 'run-set', timeoutMs: 30_000 });
  await answerPending('reject');
  const result = await run;

  assert.equal(result.success, false, 'sada se zamítnutým patchem se tvářila jako úspěch');
  assert.equal(readFileSync(path.join(projectRoot, 'app.js'), 'utf8'), SAMPLE,
    'sada selhala, ale první soubor zůstal změněný');
  assert.ok(readFileSync(ci, 'utf8').includes('runs-on: ubuntu\n'),
    'zamítnutý patch přesto změnil citlivý soubor');
});

// ── 6. Volací místo: smyčka předává běh i signál ───────────────────────────

const loopMilestone = { id: 'ms-1', scope_files: ['app.js'], order_index: 0 };
const loopLifecycle = () => ({ id: 'lc-1', projectPath: projectRoot, projectId: 'p-1' });
const failingGate = () => ({
  passed: false, status: 'FAIL',
  results: [{ passed: false, file: 'app.js', line: 2, message: 'SyntaxError: unexpected token' }],
});
const diffOutput = [
  '```diff',
  '--- a/app.js',
  '@@ function login(user)',
  '-  return db.find(user);',
  '+  if (!user) throw new Error("no user");',
  '+  return db.find(user);',
  '```',
].join('\n');

function loopOptions(extra) {
  return {
    lifecycle: loopLifecycle(),
    milestone: loopMilestone,
    testResults: { allPassed: false, stdout: 'app.js:2 SyntaxError: unexpected token', stderr: '' },
    qualityGateResult: failingGate(),
    callLLM: async () => ({ content: diffOutput, evalCount: 0, model: 'test' }),
    runTests: async () => ({ allPassed: true, stdout: '', stderr: '' }),
    runQualityGate: async () => ({ passed: true, status: 'PASS', results: [] }),
    getGitDiff: () => '',
    taskMemory: null,
    selfCritique: null,
    ...extra,
  };
}

await test('runFixLoop bez runId vyhodí — smyčka si vlastníka nevymýšlí', async () => {
  reset();
  await assert.rejects(() => runFixLoop(loopOptions({})), /runId required/);
});

await test('volací místo předává signál: zrušený běh smyčky nezapíše nic', async () => {
  reset();
  const controller = new AbortController();
  controller.abort();

  const result = await runFixLoop(loopOptions({
    runId: 'run-loop-cancel', signal: controller.signal,
  }));

  assert.equal(result.converged, false, 'zrušená smyčka se tvářila, že opravila');
  assert.equal(readFileSync(path.join(projectRoot, 'app.js'), 'utf8'), SAMPLE,
    'smyčka zapsala i po zrušení — signál se cestou ztratil');
});

// **Tenhle test je pozitivní kontrola, ne důkaz.**  Prošel by i před `M2`,
// protože tehdy smyčka zapisovala taky — jen mimo zámek.  Je tu proto, aby se
// poznalo, že předchozí test selhal na zrušení, a ne na tom, že se rozbila celá
// cesta; sám o sobě o mediaci nevypovídá.
await test('volací místo předává běh: nezrušená smyčka zapíše jménem svého runId', async () => {
  reset();
  const result = await runFixLoop(loopOptions({ runId: 'run-loop-ok' }));

  assert.equal(result.converged, true, `smyčka nekonvergovala: ${result.stopReason}`);
  assert.ok(readFileSync(path.join(projectRoot, 'app.js'), 'utf8').includes('no user'),
    'smyčka nic nezapsala');
});

// ── 7. Strukturálně: druhé dveře k zápisu neexistují ───────────────────────

await test('patch engine nemá vlastní zápis na disk', () => {
  const source = readFileSync(new URL('../src/patch/patch-engine.js', import.meta.url), 'utf8');
  assert.ok(!/writeFileSync|renameSync|mkdirSync|\bfs\.promises\b/.test(source),
    'patch engine si zase píše sám — sdílená cesta je tím obejitá');
  assert.ok(/writeUserFile\(/.test(source), 'patch engine nevolá sdílenou cestu');
});

await test('lifecycle-build pouští smyčku vlastněně — s runId a abortem na konci', () => {
  const source = readFileSync(new URL('../src/planner/lifecycle-build.js', import.meta.url), 'utf8');
  // Jediné povolené volání `_runFixLoop` je to uvnitř obalu; každé další je
  // běh bez vlastníka a bez konce.
  const direct = source.match(/_runFixLoop\(/g) || [];
  assert.equal(direct.length, 1,
    `_runFixLoop se volá ${direct.length}× — mimo obal je běh bez vlastníka`);
  const owned = source.match(/runOwnedFixLoop\(/g) || [];
  assert.equal(owned.length, 3,
    `runOwnedFixLoop: 1 definice + 2 volací místa, nalezeno ${owned.length}`);
  assert.equal((source.match(/runId: `build:\$\{milestone\.id\}/g) || []).length, 2,
    'některý průchod smyčky nedostal vlastní runId');
  assert.ok(/finally\s*\{\s*controller\.abort\(\);/.test(source),
    'signál se neaborduje ve finally — pád smyčky by nechal její zápisy platné');
});

configureEffects({ db: null, producer: null });
db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nPatch engine na sdílené cestě: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
