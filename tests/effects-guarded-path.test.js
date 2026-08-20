// Jedna řízená cesta — a důkaz, že po ní jde skutečný zápis
// ==============================================================================
//
// `guarded-write.test.js` dokazuje, že `guardedWrite` je správný.  Tahle sada
// dokazuje něco jiného a do té chvíle nedokázaného: že se **volá**.
//
// Rozdíl není akademický.  Bezpečná cesta, kterou produkční kód obchází, je
// dokumentace, ne záruka — a přesně tak to vypadalo: `handleFileWriteDecision`
// i `ToolExecutor.executeFileWrite` volaly `fs.writeFile` přímo, takže agent
// zapsal soubor a člověk se to dozvěděl potom.
//
// Testuje se proto **skutečný call graph**, ne atrapa: pouští se opravdový
// handler, opravdový nástroj a kontroluje se disk.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/approvals/fingerprint.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { configureEffects, effectGuardMode, writeUserFile } from '../src/executor/effects.js';
import { handleApprovalDecide } from '../src/mobile/handlers.js';
import { OperationJournal } from '../src/mobile/operation-journal.js';

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

console.log('\n=== Jedna řízená cesta (P0-2) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-effects-'));
const workdir = path.join(runtimeDir, 'strom');
const db = new Database(path.join(runtimeDir, 'effects.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const journal = new OperationJournal(db);
const phone = { deviceId: 'device-telefon', scopes: ['read:approvals', 'write:approvals'] };
const yieldTick = () => new Promise(resolve => setImmediate(resolve));

let operationCounter = 0;
const nextOperationId = () => `op-effects-${String(++operationCounter).padStart(10, '0')}`;

function clear() {
  db.exec('DELETE FROM mobile_approvals; DELETE FROM mobile_operations; DELETE FROM file_write_locks;');
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
}

function enableApprovals() {
  configureEffects({
    db,
    producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }),
  });
}

function disableApprovals() {
  configureEffects({ db: null, producer: null });
}

/** Odpověz na jediný čekající approval tak, jak by to udělal telefon. */
async function answerPending(decision, payload) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const row = db.prepare('SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
    if (row) {
      return handleApprovalDecide({
        rawDb: db, journal, principal: phone, params: { id: row.id },
        body: { decision, operationId: nextOperationId(), payloadFingerprint: fingerprint(payload) },
      });
    }
    await yieldTick();
  }
  throw new Error('žádný approval nevznikl');
}

// **Cíl je schválně citlivý soubor.**
//
// Od rozhodnutí `028` se agent na běžné soubory **neptá** — auto-approve je
// výchozí stav.  Sady, které zkoumají approval, proto musí mířit na něco, co do
// citlivé kategorie spadá; jinak by testovaly cestu, která se v produkci
// neotevře.  `.env` je nejjednodušší takový soubor (`write-policy.js`, pravidlo
// `secrets`).
const target = () => path.join(workdir, '.env');

// **Chatový handler `.env` blokuje úplně** (`forbidden_file`) — má vlastní,
// tvrdší seznam než politika zápisu, a je to tak správně: na secret se neptá,
// prostě ho odmítne.  Testy, které jdou přes handler, proto míří na CI soubor:
// ten handler pustí a politika se na něj ptá (`write-policy.js`, `ci-deploy`).
const handlerTarget = () => path.join(workdir, '.github', 'workflows', 'deploy.yml');
const HANDLER_REL = '.github/workflows/deploy.yml';

/** Běžný soubor — tenhle se ptát nemá. */
const ordinaryTarget = () => path.join(workdir, 'poznamka.md');

// ── 1. Režim se pojmenuje, nespoléhá se na ticho ───────────────────────────

await test('režim zápisu je vidět: bez zapojené roviny „none", se zapojenou „approval"', () => {
  disableApprovals();
  assert.equal(effectGuardMode(), 'none');
  configureEffects({ db, producer: null });
  assert.equal(effectGuardMode(), 'lock', 'db bez producenta pořád drží zámek');
  enableApprovals();
  assert.equal(effectGuardMode(), 'approval');
});

// ── 2. Přímo přes writeUserFile ────────────────────────────────────────────

await test('P0-2 approval nevytvoří soubor před rozhodnutím', async () => {
  clear();
  enableApprovals();
  const content = '# ahoj\n';
  const write = writeUserFile({
    filePath: target(), content, runId: 'run-effects-1', timeoutMs: 20_000,
  });

  await yieldTick();
  assert.equal(existsSync(target()), false, 'zapsalo se dřív, než kdokoli souhlasil');

  await answerPending('approve', { path: target(), content });
  const result = await write;

  assert.equal(result.state, 'written');
  assert.equal(result.guard, 'approval');
  assert.equal(readFileSync(target(), 'utf8'), content);
});

await test('P0-2 zamítnutí nezapíše nic', async () => {
  clear();
  enableApprovals();
  const content = 'tohle se nemá zapsat';
  const write = writeUserFile({
    filePath: target(), content, runId: 'run-effects-2', timeoutMs: 20_000,
  });
  await answerPending('reject', { path: target(), content });
  const result = await write;

  assert.equal(result.written, false);
  assert.equal(result.state, 'reject');
  assert.equal(existsSync(target()), false);
});

await test('zápis je atomický: po sobě nenechá dočasný soubor', async () => {
  clear();
  enableApprovals();
  const content = 'obsah\n';
  const write = writeUserFile({
    filePath: target(), content, runId: 'run-effects-3', timeoutMs: 20_000,
  });
  await answerPending('approve', { path: target(), content });
  await write;

  const leftovers = readdirSync(workdir).filter(name => name.includes('.intentsmith-'));
  assert.deepEqual(leftovers, [], `zůstal dočasný soubor: ${leftovers.join(', ')}`);
});

await test('bez zapojené roviny se nezapisuje — fail-closed, ne fallback', async () => {
  clear();
  disableApprovals();
  const result = await writeUserFile({
    filePath: target(), content: 'bez otázky\n', runId: 'run-effects-4',
  });
  // Dřív tenhle test tvrdil opak: že se zapíše a režim je vidět v `guard`.
  // Review ukázalo, proč to bylo špatně — viditelnost v návratové hodnotě
  // nikoho nezachrání, když se na ni nikdo nedívá, a nezapojený server tak
  // zapisoval bez ptaní úplně stejně jako předtím.
  assert.equal(result.written, false, 'nezapojená rovina zapsala');
  assert.equal(result.state, 'refused_unconfigured');
  assert.equal(existsSync(target()), false);
});

await test('ani samotná databáze bez producenta nestačí — zámek není souhlas', async () => {
  clear();
  configureEffects({ db, producer: null });
  const result = await writeUserFile({
    filePath: target(), content: 'jen zámek\n', runId: 'run-effects-5',
  });
  assert.equal(result.written, false);
  assert.equal(result.guard, 'lock');
  assert.equal(existsSync(target()), false);
});

await test('bez běhu se nezapisuje: zámek bez držitele je jen zpomalení', async () => {
  await assert.rejects(
    () => writeUserFile({ filePath: target(), content: 'x' }),
    /runId required/,
  );
});

// ── 3. Skutečný chatový handler ────────────────────────────────────────────

const { handleFileWriteDecision } = await import('../src/chat/handlers/file.js');

function writeDecision(filePath) {
  return { metadata: { handler: 'file.write', filePath }, toJSON: () => ({}) };
}

await test('P0-2 chatový handler se ptá — soubor nevznikne před rozhodnutím', async () => {
  clear();
  enableApprovals();
  const content = 'obsah z konverzace';
  const answer = handleFileWriteDecision('ulož to', writeDecision(HANDLER_REL), {
    history: [{ response: { content } }],
    project: { path: workdir },
    sessionId: 'session-A',
  });

  await yieldTick();
  assert.equal(existsSync(handlerTarget()), false, 'handler zapsal dřív, než se kdokoli zeptal');

  await answerPending('approve', { path: handlerTarget(), content });
  const response = await answer;

  assert.equal(readFileSync(handlerTarget(), 'utf8'), content);
  assert.equal(response.tag.metadata.guard, 'approval',
    'handler zapsal mimo řízenou cestu');
});

await test('P0-2 zamítnutý chatový zápis nevytvoří soubor a řekne proč', async () => {
  clear();
  enableApprovals();
  const content = 'tohle uživatel odmítne';
  const answer = handleFileWriteDecision('ulož to', writeDecision(HANDLER_REL), {
    history: [{ response: { content } }],
    project: { path: workdir },
    sessionId: 'session-B',
  });
  await answerPending('reject', { path: handlerTarget(), content });
  const response = await answer;

  assert.equal(existsSync(handlerTarget()), false);
  assert.equal(response.tag.metadata.writeState, 'reject');
  assert.match(response.content, /zamítnut/i);
});

// ── 4. Skutečná nástrojová cesta ───────────────────────────────────────────

const { ToolExecutor } = await import('../src/executor/tool-executor.js');

await test('P0-2 nástroj FILE_WRITE jde toutéž cestou, ne kolem ní', async () => {
  clear();
  enableApprovals();
  const executor = new ToolExecutor();
  const content = 'zápis z nástroje';
  const running = executor.executeFileWrite({
    path: target(), content, sessionId: 'session-tool',
  });

  await yieldTick();
  assert.equal(existsSync(target()), false, 'nástroj zapsal bez otázky');

  await answerPending('approve', { path: target(), content });
  const result = await running;

  assert.equal(result.guard, 'approval');
  assert.equal(readFileSync(target(), 'utf8'), content);
});

await test('P0-2 nezapsaný nástrojový zápis se vyhodí, netváří se jako úspěch', async () => {
  clear();
  enableApprovals();
  const executor = new ToolExecutor();
  const content = 'nástroj dostane ne';
  const running = executor.executeFileWrite({
    path: target(), content, sessionId: 'session-tool-2',
  });
  await answerPending('reject', { path: target(), content });

  await assert.rejects(() => running, error => {
    assert.equal(error.code, 'FILE_WRITE_NOT_PERFORMED');
    assert.equal(error.state, 'reject');
    return true;
  });
  assert.equal(existsSync(target()), false);
});

// ── 5. Strukturálně: nezůstal obchvat ──────────────────────────────────────

await test('produkční zápis nechodí kolem řízené cesty', () => {
  const handler = readFileSync(new URL('../src/chat/handlers/file.js', import.meta.url), 'utf8');
  const tool = readFileSync(new URL('../src/executor/tool-executor.js', import.meta.url), 'utf8');

  // `writeFile` v handleru čte i zapisuje; hledá se **zápis** obsahu na cíl.
  assert.ok(!/fs\.writeFile\(validation\.resolved/.test(handler),
    'handleFileWriteDecision zase zapisuje přímo');
  assert.ok(/writeUserFile\(/.test(handler), 'handler nevolá řízenou cestu');
  assert.ok(!/fs\.writeFile\(validatedPath/.test(tool),
    'ToolExecutor zase zapisuje přímo');
  assert.ok(/writeUserFile\(/.test(tool), 'nástroj nevolá řízenou cestu');
});

await test('server rozhodovací rovinu zapíná — jinak je celá cesta dekorace', () => {
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.ok(/configureEffects\(\{\s*db:/.test(server),
    'server.js nezapíná řízenou cestu, takže se v produkci nikdo neptá');
  assert.ok(/setApprovalDeps\(\{\s*db:/.test(server),
    'server.js nezapíná trvalé approvaly v IDE relaci');
  assert.ok(/createCompanionProducer\(/.test(server),
    'server.js nevyrábí producenta, takže by obojí tiše spadlo do režimu bez otázky');
});

disableApprovals();
db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nJedna řízená cesta: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
