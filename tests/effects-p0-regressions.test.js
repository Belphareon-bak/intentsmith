// Čtyři sondy z review — a čtyři vlastnosti, které po nich musí platit
// ==============================================================================
//
// Tahle sada nevznikla z návrhu, ale z **reprodukovaných vad**.  Review pustilo
// čtyři sondy proti skutečnému disku a všechny čtyři uspěly v tom, co uspět
// nemělo:
//
//   A1  zrušený tah vyrobil approval; po pozdějším schválení vznikl soubor
//       s obsahem `MUST-NOT-WRITE`.  Signál v kontextu byl, jen ho nikdo
//       nepředal do `writeUserFile`.
//   A2  běh skončil `FAILED` po 26 ms (timeout), approval čekal dál a po
//       schválení se zapsal `LATE-WRITE`.  Efekt po terminálním výsledku.
//   A3  dva souběžné zápisy **jedné relace** obě vrátily `written: true`
//       a na disku zůstal jeden obsah.  `runId` byl per-relace a zámek pro
//       týž `runId` reentrantní.
//   A4  nezapojená rovina zapsala místo odmítnutí.
//
// Každý test níž je ta sonda, obrácená na tvrzení.  Píše se na skutečný disk,
// protože všechny čtyři vady byly vidět až tam.
//
// **Které z nich regresi doopravdy chytají.**  Ověřeno spuštěním téhle sady
// proti kódu před opravou (`6e948d6e`):
//
//   * jednotkové varianty `A1` a `A2` prošly **i před opravou** — `guardedWrite`
//     zrušení respektoval vždycky.  Vada byla ve volacím místě, ne v jednotce,
//     a přesně proto jednotkový test nestačil.  Zůstávají tu jako pojistka
//     kontraktu jednotky, ne jako důkaz opravy;
//   * `A1` přes handler, `A2` přes nástroj a `A3` se stejným `runId` před
//     opravou **selžou nebo zůstanou viset**;
//   * všechny tři `A4` před opravou selžou.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

console.log('\n=== P0 regrese ze sond review ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-p0-'));
const workdir = path.join(runtimeDir, 'strom');
const db = new Database(path.join(runtimeDir, 'p0.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const journal = new OperationJournal(db);
const phone = { deviceId: 'device-telefon', scopes: ['read:approvals', 'write:approvals'] };
const yieldTick = () => new Promise(resolve => setImmediate(resolve));
const workspace = { repoId: '/fake/.git', branch: 'main', root: workdir, git: true };

let operationCounter = 0;
const nextOperationId = () => `op-p0-${String(++operationCounter).padStart(10, '0')}`;

function clear() {
  db.exec('DELETE FROM mobile_approvals; DELETE FROM mobile_operations; DELETE FROM file_write_locks;');
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
}

function enable() {
  configureEffects({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });
}

async function pendingId() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const row = db.prepare('SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
    if (row) return row.id;
    await yieldTick();
  }
  return null;
}

/** Schval cokoli, co ve frontě zbylo — i po skončení běhu. */
function approveAnyPending(payload) {
  const row = db.prepare('SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
  if (!row) return null;
  return handleApprovalDecide({
    rawDb: db, journal, principal: phone, params: { id: row.id },
    body: { decision: 'approve', operationId: nextOperationId(), payloadFingerprint: fingerprint(payload) },
  });
}

/**
 * Počkej na výsledek, ale **nezůstaň viset**.
 *
 * Regrese se tady projevuje dvěma způsoby: buď se vrátí špatná hodnota, nebo se
 * nevrátí nic.  Když se signál nepropaguje, zrušení nic neudělá a zápis čeká na
 * odpověď plných pět minut — a sada, která takhle visí, vypadá jako zaseknutá
 * infrastruktura, ne jako nález.  Proto se čeká s lhůtou a překročení se hlásí
 * jako to, čím je.
 */
async function withDeadline(promise, ms, what) {
  let timer = null;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => resolve(Symbol.for('deadline')), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  const outcome = await Promise.race([promise, deadline]);
  clearTimeout(timer);
  if (outcome === Symbol.for('deadline')) {
    throw new Error(`${what} — čekání překročilo ${ms} ms, což znamená, že se zastavení nepropagovalo`);
  }
  return outcome;
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
const ordinaryTarget = () => path.join(workdir, 'cil.txt');

// ── A1: zrušení zastaví zápis ──────────────────────────────────────────────

await test('A1 zrušený tah nezapíše, ani když approval někdo schválí potom', async () => {
  clear();
  enable();
  const content = 'MUST-NOT-WRITE';
  const controller = new AbortController();

  const write = writeUserFile({
    filePath: target(), content, runId: 'turn-A1', workspace,
    timeoutMs: 20_000, signal: controller.signal,
  });

  assert.ok(await pendingId(), 'nevznikl approval, sonda by nic nedokazovala');
  controller.abort();
  const result = await write;

  assert.equal(result.written, false);
  assert.equal(result.state, 'cancelled');

  // A teď to podstatné: **pozdější** schválení už nesmí nic vyrobit.
  approveAnyPending({ path: target(), content });
  await yieldTick();
  assert.equal(existsSync(target()), false,
    'po zrušení a pozdějším schválení vznikl soubor — přesně sonda A1');
});

// ── A2: po terminálním výsledku efekt nenastane ────────────────────────────

await test('A2 po vypršení času efekt nenastane, ani když approval někdo schválí potom', async () => {
  clear();
  enable();
  const content = 'LATE-WRITE';

  // Krátký `timeoutMs` je tu tím, čím byl v sondě 30s timeout nástroje: běh
  // skončí dřív, než člověk odpoví.
  const result = await writeUserFile({
    filePath: target(), content, runId: 'turn-A2', workspace, timeoutMs: 30,
  });

  assert.equal(result.written, false);
  assert.ok(['timeout', 'cancelled'].includes(result.state), `neočekávaný stav ${result.state}`);

  // Otázka po sobě nesmí zůstat čekat — jinak ji lze schválit a efekt nastane
  // po terminálním výsledku.
  const stillPending = db.prepare(
    'SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
  assert.equal(stillPending, undefined,
    'approval zůstal čekat po konci běhu — dá se schválit a zapsat pozdě');

  approveAnyPending({ path: target(), content });
  await yieldTick();
  assert.equal(existsSync(target()), false, 'vznikl LATE-WRITE — přesně sonda A2');
});

// ── A3: dva souběžné zápisy jedné relace ───────────────────────────────────

await test('A3 dva souběžné zápisy téže relace nemohou oba uspět', async () => {
  clear();
  enable();

  // Sonda pouštěla dva zápisy jedné **relace**.  Po opravě má každý tah vlastní
  // `runId`, takže druhý narazí na cizí zámek; kdyby se `runId` odvozoval ze
  // `sessionId` jako dřív, narazí na `held_by_self`.  Obojí je odmítnutí a
  // obojí je správně — nesprávné je jen to, aby uspěly oba.
  const first = writeUserFile({
    filePath: target(), content: 'PRVNÍ', runId: 'turn-A3-a', workspace, timeoutMs: 20_000,
  });
  await pendingId();
  const second = await writeUserFile({
    filePath: target(), content: 'DRUHÝ', runId: 'turn-A3-b', workspace, timeoutMs: 20_000,
  });

  assert.equal(second.written, false, 'druhý souběžný zápis prošel vedle prvního');
  assert.equal(second.state, 'locked');

  approveAnyPending({ path: target(), content: 'PRVNÍ' });
  const firstResult = await first;

  assert.equal(firstResult.written, true);
  assert.equal(readFileSync(target(), 'utf8'), 'PRVNÍ',
    'na disku je obsah druhého zápisu — jeden z nich tiše přepsal druhého');
});

await test('A3 týž runId se souběžně nedostane k souboru dvakrát', async () => {
  clear();
  enable();

  const first = writeUserFile({
    filePath: target(), content: 'PRVNÍ', runId: 'turn-A3-same', workspace, timeoutMs: 20_000,
  });
  await pendingId();
  const second = await writeUserFile({
    filePath: target(), content: 'DRUHÝ', runId: 'turn-A3-same', workspace, timeoutMs: 20_000,
  });

  assert.equal(second.written, false, 'reentrantní zámek pustil dva souběžné zápisy');
  assert.equal(second.holder.self, true, 'vlastní souběh se hlásí jako cizí běh');

  approveAnyPending({ path: target(), content: 'PRVNÍ' });
  await first;
  assert.equal(readFileSync(target(), 'utf8'), 'PRVNÍ');
});

// ── A4: nezapojená rovina nezapisuje ───────────────────────────────────────

await test('A4 bez producenta se nezapisuje — zámek není souhlas', async () => {
  clear();
  configureEffects({ db, producer: null });
  assert.equal(effectGuardMode(), 'lock');

  const result = await writeUserFile({
    filePath: target(), content: 'BEZ OTÁZKY', runId: 'turn-A4-lock', workspace,
  });

  assert.equal(result.written, false, 'režim `lock` zapsal — zámek se vydává za souhlas');
  assert.equal(result.state, 'refused_unconfigured');
  assert.equal(existsSync(target()), false);
});

await test('A4 bez zapojené roviny se nezapisuje vůbec', async () => {
  clear();
  configureEffects({ db: null, producer: null });
  assert.equal(effectGuardMode(), 'none');

  const result = await writeUserFile({
    filePath: target(), content: 'BEZ ROVINY', runId: 'turn-A4-none', workspace,
  });

  assert.equal(result.written, false, 'nezapojená rovina zapsala — fail-open');
  assert.equal(result.state, 'refused_unconfigured');
  assert.equal(existsSync(target()), false);
});

await test('A4 odmítnutí řekne proč, ne jen že se nepovedlo', async () => {
  configureEffects({ db: null, producer: null });
  const result = await writeUserFile({
    filePath: target(), content: 'x', runId: 'turn-A4-msg', workspace,
  });
  assert.match(result.message, /není zapojená/);
  assert.equal(result.guard, 'none');
});


// ── Skutečné volací místo, ne jen jednotka ─────────────────────────────────
//
// Tohle je jádro nálezu: `guardedWrite` zrušení respektoval **už předtím** a měl
// na to test.  Vada byla v tom, že mu produkční cesta signál nikdy nepředala.
// Testovat jednotku tady nestačí — musí se projít handlerem a nástrojem.

const { handleFileWriteDecision } = await import('../src/chat/handlers/file.js');
const executorModule = await import('../src/executor/tool-executor.js');
const { ToolExecutor } = executorModule;
const { ToolType, DecisionType } = await import('../src/chat/cre-decision.js');

function writeDecision(filePath) {
  return { metadata: { handler: 'file.write', filePath }, toJSON: () => ({}) };
}

await test('A1 chatový handler předá zrušení dál — soubor nevznikne ani po pozdním souhlasu', async () => {
  clear();
  enable();
  const content = 'MUST-NOT-WRITE-HANDLER';
  const controller = new AbortController();

  const answer = handleFileWriteDecision('ulož to', writeDecision(HANDLER_REL), {
    history: [{ response: { content } }],
    project: { path: workdir },
    sessionId: 'session-A1',
    turnId: 'turn-A1-handler',
    signal: controller.signal,
  });

  assert.ok(await pendingId(), 'handler nevyrobil approval');
  controller.abort();
  const response = await withDeadline(answer, 15_000, 'handler po zrušení nedoběhl');

  assert.equal(response.tag.metadata.writeState, 'cancelled',
    'handler zrušení nepředal — přesně sonda A1');

  approveAnyPending({ path: handlerTarget(), content });
  await yieldTick();
  assert.equal(existsSync(handlerTarget()), false, 'po zrušení a pozdním souhlasu vznikl soubor');
});

await test('A3 dva tahy jedné relace jsou dva běhy, ne jeden držitel', async () => {
  clear();
  enable();

  // Táž `sessionId`, dva různé `turnId` — přesně to, co dělá controller.
  const spolecne = { project: { path: workdir }, sessionId: 'session-A3' };
  const prvni = handleFileWriteDecision('ulož', writeDecision(HANDLER_REL), {
    ...spolecne, turnId: 'turn-A3-1', history: [{ response: { content: 'PRVNÍ' } }],
  });
  await pendingId();
  const druhy = await withDeadline(
    handleFileWriteDecision('ulož', writeDecision(HANDLER_REL), {
      ...spolecne, turnId: 'turn-A3-2', history: [{ response: { content: 'DRUHÝ' } }],
    }),
    15_000, 'druhý tah se nezastavil na zámku');

  assert.equal(druhy.tag.metadata.writeState, 'locked',
    'druhý tah téže relace prošel vedle prvního — sonda A3');

  approveAnyPending({ path: handlerTarget(), content: 'PRVNÍ' });
  await prvni;
  assert.equal(readFileSync(handlerTarget(), 'utf8'), 'PRVNÍ');
});

await test('A2 timeout nástroje efekt zastaví, ne jen přestane čekat', async () => {
  clear();
  enable();
  const content = 'LATE-WRITE-TOOL';

  // Nástroj má vlastní strop (v sondě 30 s, tady 150 ms). Po jeho vypršení
  // musí být zápis **zastavený**, ne opuštěný.
  const executor = new ToolExecutor({ timeout: 150 });
  const decision = {
    type: DecisionType.TOOL_CALL,
    tools: [ToolType.FILE_WRITE],
    intent: 'file_write',
    metadata: {},
  };

  const outcome = await withDeadline(
    executor.execute(decision, {
      path: target(), content, sessionId: 'session-A2', turnId: 'turn-A2-tool',
    }),
    15_000, 'nástroj po vypršení času nedoběhl');

  assert.ok(outcome, 'nástroj nevrátil výsledek');

  // Otázka nesmí zůstat čekat: kdyby zůstala, dá se schválit a efekt nastane
  // po terminálním výsledku běhu.
  const stillPending = db.prepare(
    'SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
  assert.equal(stillPending, undefined,
    'po timeoutu nástroje zůstal approval čekat — dá se schválit a zapsat pozdě');

  approveAnyPending({ path: target(), content });
  await yieldTick();
  assert.equal(existsSync(target()), false, 'vznikl LATE-WRITE přes nástroj — sonda A2');
});


// ── Closeout: tři sondy z druhého kola review ──────────────────────────────
//
// První kolo zavřelo chatový handler a `ToolExecutor.FILE_WRITE`.  Druhé kolo
// ukázalo tři místa, kudy to pořád teklo, a všechna tři mají stejný tvar jako
// ty předchozí: **oprava byla v jedné cestě a slib mluvil o dvou.**

const { ToolErrorCode } = await import('../src/executor/tool-executor.js');

await test('C1 nástroj fs.write předá zrušení — pozdní souhlas soubor nevyrobí', async () => {
  clear();
  enable();
  const { toolRegistry } = await import('../src/tools/registry.js');
  const content = 'SHOULD-NOT-WRITE';
  const controller = new AbortController();

  // Jednoargumentové volání — přesně tak, jak nástroj volá většina volajících.
  // Předchozí verze četla běh i signál jen z druhého argumentu, takže takhle
  // volaný nástroj neměl ani jedno.
  const running = toolRegistry.get('fs.write').execute({
    path: target(), content, runId: 'turn-C1', signal: controller.signal,
  });

  assert.ok(await pendingId(), 'fs.write nevyrobil approval');
  controller.abort();
  const result = await withDeadline(running, 15_000, 'fs.write po zrušení nedoběhl');

  assert.equal(result.written, 0, 'fs.write zapsal po zrušení');
  assert.equal(result.refused, true);

  approveAnyPending({ path: target(), content });
  await yieldTick();
  assert.equal(existsSync(target()), false,
    'po zrušení a pozdním souhlasu vznikl SHOULD-NOT-WRITE — sonda C1');
});

await test('C2 osiřelý efekt se neklasifikuje jako retryable timeout', () => {
  const { ToolExecutor } = executorModule;
  const executor = new ToolExecutor();

  // Přesně ta chyba, kterou `executeWithTimeout` vyrábí, když se efekt po
  // abortu nezastaví.
  const orphan = Object.assign(
    new Error('Effect did not stop within 2000ms after abort (deadline was 150ms) — its outcome is UNKNOWN'),
    { code: ToolErrorCode.EFFECT_ORPHANED, retryable: false, orphaned: true },
  );

  const classified = executor.classifyError(orphan);
  assert.equal(classified.code, ToolErrorCode.EFFECT_ORPHANED,
    'osiřelý efekt se přeložil na jiný kód — dřív to byl obyčejný TIMEOUT');
  assert.equal(classified.retryable, false,
    'osiřelý efekt je retryable — auto-retry by spustil druhý efekt nad stavem, který nikdo nezná');

  // A pro jistotu i to, že se text „timeout" nepřebije nad kódem: kdyby se
  // klasifikace vrátila k porovnávání textu, tenhle případ ji chytí.
  const plainTimeout = new Error('Timeout after 150ms');
  assert.equal(executor.classifyError(plainTimeout).retryable, true,
    'obyčejný timeout přestal být retryable — to je jiná regrese');
});

await test('C2 osiřelost se nese na úrovni běhu, ne jen v jednom řádku výsledku', () => {
  const { ToolResult } = executorModule;
  const failed = ToolResult.failed({
    type: 'file_write', error: 'x', errorCode: ToolErrorCode.EFFECT_ORPHANED,
  });
  assert.equal(failed.meta.retryable, false,
    'osiřelý výsledek se tváří jako opakovatelný');
});

await test('C3 předaný turnId je skutečně tím, kdo drží zámek', async () => {
  clear();
  enable();
  const { listHeldLocks } = await import('../src/executor/file-lock.js');

  const running = writeUserFile({
    filePath: target(), content: 'x', runId: 'wire-turn-123', workspace, timeoutMs: 20_000,
  });
  await pendingId();

  // Identita se nesmí cestou dolů ztratit ani přejmenovat: kdo tah pojmenoval,
  // ten musí být vidět jako držitel zámku i jako `run_id` approvalu.
  const held = listHeldLocks(db);
  assert.equal(held.length, 1);
  assert.equal(held[0].run_id, 'wire-turn-123',
    'zámek drží někdo jiný, než kdo tah zahájil');

  const approval = db.prepare(
    'SELECT run_id FROM mobile_approvals WHERE decided_at IS NULL').get();
  assert.equal(approval.run_id, 'wire-turn-123',
    'approval ukazuje na jiný běh — korelace s reálným během je rozbitá');

  approveAnyPending({ path: target(), content: 'x' });
  await running;
});

await test('C3 příchozí turnId se zachová, nenahradí se novým UUID', async () => {
  const { ChatController } = await import('../src/chat/controller.js');
  // `handle()` je těžká cesta; identita se ověřuje tam, kde se skládá kontext —
  // příchozí `turnId` musí mít přednost před vygenerovaným.
  const source = readFileSync(new URL('../src/chat/controller.js', import.meta.url), 'utf8');
  assert.match(source, /turnId: request\?\.turnId \|\| context\.turnId \|\| `turn-\$\{randomUUID\(\)\}`/,
    'controller přepisuje příchozí turnId vlastním UUID — approval pak ukazuje na běh, '
    + 'který pod tím jménem nikde jinde neexistuje');
  assert.ok(ChatController, 'controller se nenačetl');
});


// ── M1-a: atomický zápis nesmí sebrat souboru práva ────────────────────────
//
// Sonda review přepsala soubor `0755` a dostala `0664` — spustitelný skript
// přestal být spustitelný.  Uživatel kýval na změnu **obsahu**, ne na to, že mu
// program přestane jít pustit.

await test('M1-a schválený přepis zachová práva souboru', async () => {
  clear();
  enable();
  const { chmodSync, statSync, writeFileSync } = await import('node:fs');

  writeFileSync(target(), '#!/bin/sh\necho staré\n');
  chmodSync(target(), 0o755);
  const before = statSync(target()).mode & 0o7777;
  assert.equal(before, 0o755, 'příprava sondy selhala');

  const content = '#!/bin/sh\necho nové\n';
  const write = writeUserFile({
    filePath: target(), content, runId: 'turn-mode', workspace, timeoutMs: 20_000,
  });
  await pendingId();
  approveAnyPending({ path: target(), content });
  const result = await write;

  assert.equal(result.written, true);
  assert.equal(readFileSync(target(), 'utf8'), content);
  assert.equal(statSync(target()).mode & 0o7777, 0o755,
    'přepis sebral souboru práva — spustitelný skript přestal být spustitelný');
});

await test('M1-a nový soubor práva nepřebírá odnikud', async () => {
  clear();
  enable();
  const { statSync } = await import('node:fs');

  const content = 'nový\n';
  const write = writeUserFile({
    filePath: target(), content, runId: 'turn-mode-new', workspace, timeoutMs: 20_000,
  });
  await pendingId();
  approveAnyPending({ path: target(), content });
  await write;

  // Není od čeho přebírat, takže platí umask — jen ať to nespadne a soubor
  // není spustitelný jen proto, že jsme si vymysleli 0755.
  const mode = statSync(target()).mode & 0o7777;
  assert.equal(mode & 0o111, 0, `nový soubor vznikl spustitelný (${mode.toString(8)})`);
});

await test('M1-a po zápisu nezůstane dočasný soubor a jméno je unikátní', async () => {
  const { readdirSync } = await import('node:fs');
  const leftovers = readdirSync(workdir).filter(n => n.includes('.intentsmith-'));
  assert.deepEqual(leftovers, [], `zůstal dočasný soubor: ${leftovers.join(', ')}`);

  // Jméno se skládá z UUID, ne z `pid + čas` — dva procesy ve stejné
  // milisekundě by se jinak trefily do téhož temp souboru.
  const source = readFileSync(new URL('../src/executor/atomic-write.js', import.meta.url), 'utf8');
  assert.match(source, /randomUUID\(\)/, 'temp soubor se pojmenovává předvídatelně');
  assert.doesNotMatch(source, /process\.pid.*Date\.now\(\)/,
    'temp soubor se pořád jmenuje podle pid a času');
});


// ── C4: terminální rámec musí projít kontraktem ────────────────────────────
//
// Tohle je strážce, který dosud chyběl — a jeho absence stála přesně to, co
// review našlo.  P0-closeout posílal `status: 'orphaned'`, jenže
// `M1_TERMINAL_STATUS` je zmrazený na `ok | cancelled | timeout | error`,
// takže rámec **neprošel validací** a osiřelý běh spadl do obecné chybové
// cesty. Tvrzení „telefon uvidí run.unknown" bylo nepravdivé.
//
// Ověřovat mapovací tabulku a nikdy neověřit, že rámec vůbec projde, je táž
// chyba jako testovat jednotku a neověřit volací místo.

await test('C4 osiřelý terminální rámec projde kontraktem M1', async () => {
  const { validateConversationResult } = await import('../contracts/m1/index.js');
  const { M1_CONTRACT_KIND, M1_CONTRACT_VERSION } = await import('../contracts/m1/shared.js');

  const orphanFrame = {
    contract: M1_CONTRACT_KIND.CONVERSATION_RESULT,
    version: M1_CONTRACT_VERSION,
    requestId: 'r1', conversationId: 'c1', turnId: 't1',
    status: 'error',
    error: { code: 'EFFECT_ORPHANED', message: 'není jisté, jestli proběhla' },
  };
  const verdict = validateConversationResult(orphanFrame);
  assert.equal(verdict.valid, true,
    `osiřelý rámec neprojde kontraktem: ${JSON.stringify(verdict.errors)}`);
});

await test('C4 `orphaned` není platný terminální status — proto se neposílá', async () => {
  const { validateConversationResult } = await import('../contracts/m1/index.js');
  const { M1_CONTRACT_KIND, M1_CONTRACT_VERSION, TERMINAL_STATUSES } =
    await import('../contracts/m1/shared.js');

  assert.equal(TERMINAL_STATUSES.includes('orphaned'), false,
    'kontrakt `orphaned` zná — pak se má posílat a tenhle test je zastaralý');

  const verdict = validateConversationResult({
    contract: M1_CONTRACT_KIND.CONVERSATION_RESULT,
    version: M1_CONTRACT_VERSION,
    requestId: 'r1', conversationId: 'c1', turnId: 't1',
    status: 'orphaned',
    error: { code: 'EFFECT_ORPHANED', message: 'x' },
  });
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('terminal:invalid-status'));
});

await test('C4 session adapter neposílá status mimo kontrakt', () => {
  const source = readFileSync(new URL('../src/ws-bridge/session-adapter.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /status: orphaned \? 'orphaned'/,
    'adapter zase posílá status, který kontrakt nezná');
  assert.match(source, /code: 'EFFECT_ORPHANED'/,
    'osiřelost se nenese ani v kódu chyby, takže se ztratí úplně');
  // `timeout` by byl nebezpečný: znamená „nestalo se nic".
  assert.doesNotMatch(source, /status: orphaned \? 'timeout'/,
    'osiřelý běh se hlásí jako timeout — to tvrdí, že se nic nestalo');
});

configureEffects({ db: null, producer: null });
db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nP0 regrese: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
