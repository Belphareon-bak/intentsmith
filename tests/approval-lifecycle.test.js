// Konce, které approval může mít — a žádný z nich není lež
// ==============================================================================
//
// Šest oprav, které mají jedno společné: **výsledek se nesmí vydávat za něco,
// co nenastalo.**
//
//   1. zrušení během čekání znamená nulový zápis,
//   2. IDE relace rozhoduje jen approval, který jí patří,
//   3. mobil a desktop rozhodují podle scope, ne podle vlastnictví,
//   4. druhé rozhodnutí vrátí to první, ne chybu a ne ticho,
//   5. `invalidated` a `cancelled` se nezploští na `reject`,
//   6. otázka, na kterou po restartu nikdo nečeká, dostane pravdivý konec.
//
// Nejostřejší je pátá: dokud se všechno, co není `approve`, hlásilo jako
// `reject`, tvrdil systém o člověku rozhodnutí, které neudělal.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { fingerprint } from '../src/approvals/fingerprint.js';
import {
  createMobileApproval, decisionState, resolveApprovalDecision,
  reapApprovalsFromPreviousBoot, closeApprovalWithoutAnswer, APPROVAL_TERMINAL,
} from '../src/approvals/authority.js';
import { BOOT_ID } from '../src/approvals/boot-id.js';
import {
  beginLease, heartbeatLease, endLease, liveBoots, LEASE_TTL_MS,
} from '../src/approvals/process-lease.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { guardedWrite } from '../src/executor/guarded-write.js';
import { acquireFileLock, releaseStaleLocks, listHeldLocks } from '../src/executor/file-lock.js';
import { readFileSync } from 'node:fs';

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

console.log('\n=== Konce approvalu (nález: cancel, scope, lifecycle) ===');

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-lifecycle-'));
const workdir = path.join(runtimeDir, 'strom');
const db = new Database(path.join(runtimeDir, 'lifecycle.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const workspace = { repoId: '/fake/.git', branch: 'main', root: workdir, git: true };
const yieldTick = () => new Promise(resolve => setImmediate(resolve));
const producer = () => createCompanionProducer({ rawDb: db, sleep: yieldTick });
const target = () => path.join(workdir, 'cil.txt');

function clear() {
  db.exec('DELETE FROM mobile_approvals; DELETE FROM mobile_operations; DELETE FROM file_write_locks;');
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
}

async function pendingId() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const row = db.prepare('SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get();
    if (row) return row.id;
    await yieldTick();
  }
  throw new Error('žádný approval nevznikl');
}

// ── 1. Zrušení znamená nulový zápis ────────────────────────────────────────

await test('zrušení během čekání nezapíše nic a pojmenuje se jako cancelled', async () => {
  clear();
  const controller = new AbortController();
  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-cancel-1',
    filePath: target(), content: 'nemá vzniknout', workspace,
    timeoutMs: 20_000, signal: controller.signal,
  });

  const id = await pendingId();
  controller.abort();
  const result = await write;

  assert.equal(result.state, 'cancelled', 'zrušení se hlásí jako timeout nebo reject');
  assert.equal(result.written, false);
  assert.equal(existsSync(target()), false, 'po zrušení vznikl soubor');

  const row = db.prepare('SELECT decision, decided_by FROM mobile_approvals WHERE id = ?').get(id);
  assert.equal(row.decision, APPROVAL_TERMINAL.CANCELLED);
  assert.equal(row.decided_by, 'system');
});

await test('souhlas, který dorazí souběžně se zrušením, zápis neprovede', async () => {
  clear();
  const controller = new AbortController();
  const write = guardedWrite({
    rawDb: db, producer: producer(), runId: 'run-cancel-2',
    filePath: target(), content: 'taky nemá vzniknout', workspace,
    timeoutMs: 20_000, signal: controller.signal,
  });

  const id = await pendingId();
  // Nejhorší možné pořadí: člověk stihne odpovědět „ano" a teprve pak se
  // ukáže, že volající už nečeká.  Dřív se v tomhle okně zapisovalo.
  db.prepare(`
    UPDATE mobile_approvals
       SET decided_at = datetime('now'), decision = 'approve', decided_by = 'device-telefon'
     WHERE id = ?
  `).run(id);
  controller.abort();

  const result = await write;
  assert.equal(result.written, false, 'zapsalo se po zrušení');
  assert.equal(existsSync(target()), false);
});

// ── 2. Konce se nezplošťují ────────────────────────────────────────────────

await test('invalidated a cancelled nejsou reject', () => {
  assert.equal(decisionState('approve'), 'approve');
  assert.equal(decisionState('reject'), 'reject');
  assert.equal(decisionState('invalidated'), 'invalidated');
  assert.equal(decisionState('cancelled'), 'cancelled');
  // Neznámá hodnota **není** zamítnutí — to by o člověku tvrdilo něco, co
  // o něm nevíme.
  assert.equal(decisionState('kdovíco'), 'unknown_decision');
});

await test('čekající dostane invalidated jako invalidated, ne jako zamítnutí', async () => {
  clear();
  const minted = createMobileApproval(db, {
    origin: 'local', runId: 'run-inv', operationRef: 'fs.write:/x',
    subjectType: 'effect.write', subjectId: '/x', title: 'Přepsat soubor',
    payload: { path: '/x', content: 'a' },
    precondition: { kind: 'file-digest', ref: '/x', content: null },
  });
  closeApprovalWithoutAnswer(db, minted.id, {
    outcome: APPROVAL_TERMINAL.INVALIDATED, reason: 'precondition_changed',
  });

  const answer = await producer().awaitDecision(minted.id, {
    timeoutMs: 5_000, readTarget: async () => null,
  });
  assert.equal(answer.state, 'invalidated',
    'propadlá otázka se hlásí jako zamítnutí člověkem');
  assert.equal(answer.reason, 'precondition_changed');
});

// ── 3. Druhé rozhodnutí vrací to první ─────────────────────────────────────

await test('druhé rozhodnutí je idempotentní a vrátí to první', () => {
  clear();
  const payload = { path: '/y', content: 'b' };
  const minted = createMobileApproval(db, {
    origin: 'local', runId: 'run-idem', operationRef: 'fs.write:/y',
    subjectType: 'effect.write', subjectId: '/y', title: 'Přepsat soubor', payload,
  });

  const first = resolveApprovalDecision(db, {
    approvalId: minted.id, decision: 'approve',
    payloadFingerprint: fingerprint(payload), decidedBy: 'desktop',
  });
  const second = resolveApprovalDecision(db, {
    approvalId: minted.id, decision: 'reject',
    payloadFingerprint: fingerprint(payload), decidedBy: 'ide',
  });

  assert.equal(first.outcome, 'decided');
  assert.equal(second.outcome, 'replay', 'druhé rozhodnutí přepsalo první');
  assert.equal(second.decision, 'approve', 'replay vrátil jinou odpověď než tu první');
  assert.equal(second.decidedBy, 'desktop');
});

// ── 4. Vlastnictví vs. scope ───────────────────────────────────────────────

const { createSessionAdapter, setApprovalDeps } = await import('../src/ws-bridge/session-adapter.js');

await test('IDE relace nerozhodne approval, který jí nepatří', async () => {
  clear();
  setApprovalDeps({ db, producer: producer() });

  // Approval, který si vyžádal někdo jiný — jiná relace, telefon, cokoli.
  const payload = { path: '/z', content: 'c' };
  const foreign = createMobileApproval(db, {
    origin: 'local', runId: 'run-cizi', operationRef: 'fs.write:/z',
    subjectType: 'effect.write', subjectId: '/z', title: 'Přepsat soubor', payload,
  });

  const sent = [];
  const adapter = createSessionAdapter({
    send: json => sent.push(JSON.parse(json)),
    handleRequest: async () => ({ content: '', tag: {} }),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    sessionId: 'session-cizi',
  });

  adapter.handleControl({ action: 'edit_approve', requestId: foreign.id });

  const row = db.prepare('SELECT decided_at FROM mobile_approvals WHERE id = ?').get(foreign.id);
  assert.equal(row.decided_at, null,
    'relace rozhodla approval, který si nevyžádala — stačí uhodnout id');
  adapter.cleanup();
  setApprovalDeps({ db: null, producer: null });
});

// ── 5. Restart ─────────────────────────────────────────────────────────────

await test('otázka bez čekajícího procesu dostane po restartu pravdivý konec', () => {
  clear();
  // Approval z „minulého spuštění": jiný `waiter_boot`.
  const minted = createMobileApproval(db, {
    origin: 'local', runId: 'run-stary', operationRef: 'fs.write:/w',
    subjectType: 'effect.write', subjectId: '/w', title: 'Přepsat soubor',
    payload: { path: '/w', content: 'd' },
    precondition: { kind: 'file-digest', ref: '/w', content: null },
    waiterBoot: 'boot-z-minula',
  });

  const result = reapApprovalsFromPreviousBoot(db, { bootId: BOOT_ID });
  assert.equal(result.closed, 1);

  const row = db.prepare(
    'SELECT decision, decided_by, decision_reason FROM mobile_approvals WHERE id = ?').get(minted.id);
  assert.equal(row.decision, APPROVAL_TERMINAL.CANCELLED,
    'otázka po restartu dál visí a její „ano" nemá kdo provést');
  assert.equal(row.decided_by, 'system');
  assert.equal(row.decision_reason, 'waiter_gone');
});

await test('approval bez čekajícího procesu restart přežije — uklízí se jen efekty', () => {
  clear();
  // Bez `precondition` a bez `waiterBoot`: rozhodnutí, na které nikdo nestojí.
  const minted = createMobileApproval(db, {
    origin: 'local', runId: 'run-bez-cekani', operationRef: 'config.change',
    subjectType: 'config', subjectId: 'x', title: 'Změnit nastavení',
    payload: { x: 1 },
  });
  reapApprovalsFromPreviousBoot(db, { bootId: BOOT_ID });
  const row = db.prepare('SELECT decided_at FROM mobile_approvals WHERE id = ?').get(minted.id);
  assert.equal(row.decided_at, null, 'úklid sebral i otázku, na kterou nikdo nečekal');
});

await test('zámek po mrtvém spuštění se pustí hned, ne až po expiraci', () => {
  clear();
  acquireFileLock(db, { workspace, filePath: target(), runId: 'run-mrtvy' });
  assert.equal(listHeldLocks(db).length, 1);

  // Zámek nese `boot_id` tohohle procesu; předstíráme restart tím, že se
  // uklízí jménem jiného spuštění.
  const released = releaseStaleLocks(db, { bootId: 'boot-jiny' });
  assert.equal(released, 1);
  assert.equal(listHeldLocks(db).length, 0, 'soubor zůstal zamčený mrtvým během');

  const row = db.prepare('SELECT release_reason FROM file_write_locks').get();
  assert.equal(row.release_reason, 'boot_cleanup',
    'úklid po restartu se tváří jako expirace — to jsou dvě různé zprávy');
});

await test('vlastní zámky si úklid nesebere', () => {
  clear();
  acquireFileLock(db, { workspace, filePath: target(), runId: 'run-zivy' });
  assert.equal(releaseStaleLocks(db, { bootId: BOOT_ID }), 0,
    'úklid sebral zámek běhu, který právě žije');
  assert.equal(listHeldLocks(db).length, 1);
});


// ── M1-b: úklid nesmí sebrat živý proces ───────────────────────────────────
//
// `064` uzavíral všechno s **cizím** `boot_id`, jenže „cizí" není totéž co
// „mrtvý": dva backendy nad jednou databází by si tak navzájem rušily živé
// approvaly a zámky.  Komentáře v kódu přitom slibovaly opak — a to je horší
// než vada sama, protože čtenář se na ten slib spolehne.
//
// Rozhoduje teď **tep**, ne odlišnost.

await test('M1-b živý cizí proces si zámek udrží — úklid se ho nedotkne', () => {
  clear();
  const zivyBoot = 'boot-zivy-A';

  // Proces A běží (má lease a právě tepal) a drží zámek.
  beginLease(db, { bootId: zivyBoot, role: 'core' });
  acquireFileLock(db, { workspace, filePath: target(), runId: 'run-A' });
  db.prepare('UPDATE file_write_locks SET boot_id = ? WHERE released_at IS NULL').run(zivyBoot);

  // Proces B startuje a uklízí.  Dřív by zámek procesu A sebral.
  const released = releaseStaleLocks(db, { bootId: 'boot-B' });

  assert.equal(released, 0, 'úklid sebral zámek živému procesu — přesně nález M1-b');
  assert.equal(listHeldLocks(db).length, 1);
});

await test('M1-b mrtvý proces se uklidí — TTL vypršelo', () => {
  clear();
  const mrtvyBoot = 'boot-mrtvy';

  beginLease(db, { bootId: mrtvyBoot, role: 'core' });
  acquireFileLock(db, { workspace, filePath: target(), runId: 'run-mrtvy' });
  db.prepare('UPDATE file_write_locks SET boot_id = ? WHERE released_at IS NULL').run(mrtvyBoot);

  // Poslední tep je starší než TTL: proces nedýchá.
  const davno = new Date(Date.now() - LEASE_TTL_MS - 60_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE process_leases SET last_seen = ? WHERE boot_id = ?').run(davno, mrtvyBoot);

  assert.equal(releaseStaleLocks(db, { bootId: 'boot-B' }), 1);
  assert.equal(listHeldLocks(db).length, 0);
});

await test('M1-b zámek bez boot_id se uklidí — živý proces dnes lease vždy má', () => {
  clear();
  acquireFileLock(db, { workspace, filePath: target(), runId: 'run-stary' });
  db.prepare('UPDATE file_write_locks SET boot_id = NULL WHERE released_at IS NULL').run();

  // Pochází z doby před migrací `2026_08_19_064_boot_identity`.  Nemůže patřit
  // živému procesu, protože kdo nemá lease, netepe.
  assert.equal(releaseStaleLocks(db, { bootId: 'boot-B' }), 1);
});

await test('M1-b živý cizí proces si udrží i čekající approval', () => {
  clear();
  const zivyBoot = 'boot-zivy-B';
  beginLease(db, { bootId: zivyBoot, role: 'core' });

  createMobileApproval(db, {
    origin: 'local', runId: 'run-zivy', operationRef: 'fs.write:/z',
    subjectType: 'effect.write', subjectId: '/z', title: 'Přepsat soubor',
    payload: { path: '/z', content: 'x' },
    precondition: { kind: 'file-digest', ref: '/z', content: null },
    waiterBoot: zivyBoot,
  });

  const result = reapApprovalsFromPreviousBoot(db, { bootId: BOOT_ID });
  assert.equal(result.closed, 0, 'úklid zrušil otázku, na kterou živý proces čeká');
});

await test('M1-b tep udrží proces naživu, konec ho pustí hned', () => {
  clear();
  const bootId = 'boot-tep';
  beginLease(db, { bootId, role: 'core' });
  assert.equal(liveBoots(db).has(bootId), true);

  // Zastaralý lease oživí tep.
  const davno = new Date(Date.now() - LEASE_TTL_MS - 60_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE process_leases SET last_seen = ? WHERE boot_id = ?').run(davno, bootId);
  assert.equal(liveBoots(db).has(bootId), false, 'zastaralý lease se pořád tváří jako živý');

  assert.equal(heartbeatLease(db, { bootId }), true);
  assert.equal(liveBoots(db).has(bootId), true, 'tep lease neoživil');

  // Řádné vypnutí nenechá ostatní čekat celé TTL.
  assert.equal(endLease(db, { bootId }), true);
  assert.equal(liveBoots(db).has(bootId), false);
});

await test('M1-b server si zapisuje lease a tepe do něj', () => {
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /beginLease\(db\.db/, 'server si lease nezapisuje, takže ho jiný start uklidí');
  assert.match(server, /heartbeatLease\(db\.db/, 'server netepe — po TTL ho někdo prohlásí za mrtvého za běhu');
  assert.match(server, /endLease\(db\.db/, 'server lease při vypnutí nepouští');

  // Pořadí je podstatné: lease **před** úklidem.
  assert.ok(server.indexOf('beginLease(db.db') < server.indexOf('reapApprovalsFromPreviousBoot(db.db'),
    'úklid běží dřív, než se tenhle proces prohlásí za živý');
});

db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nKonce approvalu: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
