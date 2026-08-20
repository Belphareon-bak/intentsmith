// Kdy se ptát — a hlavně kdy ne (rozhodnutí 028)
// ==============================================================================
//
// Nejostřejší tvrzení téhle sady je **negativní**: běžný zápis se nikoho neptá.
// Vrstva, která se ozve pokaždé, je z pohledu uživatele k nerozeznání od
// rozbité — BUILD smyčka s třiceti patchi by znamenala třicet ťuknutí.
//
// Pravidlo, podle kterého je seznam sestavený (operátor, 2026-08-20):
//
//   **Ptát se tam, kde je frekvence blízká nule a důsledek sahá mimo to, co jde
//   snadno vrátit.**
//
// Proto tu **nejsou** manifesty (`package.json`): agent je při stavbě mění
// běžně. A proto tu není celá kategorie migrací, ale jen přepis té, která už
// proběhla.
//
// ==============================================================================

import './helpers/isolated-test-db.js';

import { strict as assert } from 'node:assert';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runMigrations } from '../src/db/migrate.js';
import { classifyWrite, readAppliedMigrations, SENSITIVE_RULES } from '../src/executor/write-policy.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { configureEffects, writeUserFile } from '../src/executor/effects.js';

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

console.log('\n=== Politika zápisu (028) ===');

// ── 1. Klasifikace ─────────────────────────────────────────────────────────

const applied = new Set(['2026_08_19_064_boot_identity']);
const classify = p => classifyWrite({ relativePath: p, appliedMigrations: applied });

await test('běžné soubory se neptají — to je celý smysl', () => {
  for (const p of [
    'src/index.js', 'README.md', 'poznamka.md', 'test/foo.test.js',
    'package.json', 'package-lock.json', 'tsconfig.json',
    'src/db/migrations/2026_09_01_099_novinka.js',
  ]) {
    assert.equal(classify(p).action, 'allow', `${p} se ptá, přestože je běžný`);
  }
});

await test('secrety a klíče se ptají', () => {
  for (const p of [
    '.env', '.env.local', 'app/.env.production',
    'deploy.pem', 'server.key', 'android/keystore.properties',
    '.ssh/id_rsa', 'home/id_ed25519.pub', 'credentials.json',
  ]) {
    assert.equal(classify(p).action, 'ask', `${p} se neptá`);
    assert.equal(classify(p).rule, 'secrets');
  }
});

await test('CI a nasazení se ptá — důsledek opouští tvůj stroj', () => {
  for (const p of [
    '.github/workflows/deploy.yml', 'Dockerfile', 'Dockerfile.prod',
    'docker-compose.yml', 'docker-compose.prod.yaml', '.gitlab-ci.yml',
    'fly.toml', 'vercel.json',
  ]) {
    assert.equal(classify(p).action, 'ask', `${p} se neptá`);
    assert.equal(classify(p).rule, 'ci-deploy');
  }
});

await test('už aplikovaná migrace se ptá, nová ne', () => {
  assert.equal(classify('src/db/migrations/2026_08_19_064_boot_identity.js').action, 'ask');
  assert.equal(classify('src/db/migrations/2026_08_19_064_boot_identity.js').rule, 'applied-migration');
  // Nová migrace je rutinní práce na schématu.
  assert.equal(classify('src/db/migrations/2026_12_01_120_neco.js').action, 'allow');
});

await test('.git se zakazuje, ne ptá — správná odpověď je vždycky ne', () => {
  assert.equal(classify('.git/config').action, 'refuse');
  assert.equal(classify('.git/hooks/pre-commit').action, 'refuse');
  // A `.gitignore` s tím nemá nic společného.
  assert.equal(classify('.gitignore').action, 'allow');
});

await test('pravidla drží i pro absolutní cestu mimo pracovní strom', () => {
  // Cíl mimo strom vrací `canonicalTarget` jako absolutní cestu; pravidla
  // ukotvená na začátek řetězce by ho minula.
  assert.equal(classify('/tmp/jinde/.env').action, 'ask');
  assert.equal(classify('/tmp/jinde/.github/workflows/x.yml').action, 'ask');
  assert.equal(classify('/tmp/jinde/.git/config').action, 'refuse');
});

await test('seznam je na jednom čitelném místě', () => {
  const source = readFileSync(new URL('../src/executor/write-policy.js', import.meta.url), 'utf8');
  assert.ok(SENSITIVE_RULES.length >= 3);
  for (const rule of SENSITIVE_RULES) {
    assert.ok(rule.name && rule.reason, 'pravidlo bez jména nebo důvodu');
  }
  // Politika nesmí být rozsypaná po kódu — jinak se nedá odsouhlasit.
  assert.ok(!/classifyWrite|SENSITIVE_RULES/.test(
    readFileSync(new URL('../src/executor/guarded-write.js', import.meta.url), 'utf8')),
    'guardedWrite si rozhoduje sám, takže politika není na jednom místě');
  assert.match(source, /frekvence blízká nule/, 'chybí pravidlo, podle kterého se seznam sestavuje');
});

// ── 2. Skutečný zápis ──────────────────────────────────────────────────────

const runtimeDir = mkdtempSync(path.join(tmpdir(), 'is-policy-'));
const workdir = path.join(runtimeDir, 'strom');
const db = new Database(path.join(runtimeDir, 'policy.sqlite'));
db.pragma('journal_mode = WAL');
await runMigrations(db);

const yieldTick = () => new Promise(resolve => setImmediate(resolve));
const workspace = { repoId: '/fake/.git', branch: 'main', root: workdir, git: true };

function clear() {
  db.exec('DELETE FROM mobile_approvals; DELETE FROM mobile_operations; DELETE FROM file_write_locks;');
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });
}

configureEffects({ db, producer: createCompanionProducer({ rawDb: db, sleep: yieldTick }) });

await test('deset běžných zápisů za sebou = nula approvalů', async () => {
  clear();
  for (let i = 0; i < 10; i++) {
    const result = await writeUserFile({
      filePath: path.join(workdir, `soubor-${i}.txt`),
      content: `obsah ${i}\n`, runId: `turn-policy-${i}`, workspace,
    });
    assert.equal(result.written, true, `zápis ${i} neprošel: ${result.state}`);
    assert.equal(result.asked, false, `zápis ${i} se ptal, přestože je běžný`);
  }
  const approvals = db.prepare('SELECT COUNT(*) AS n FROM mobile_approvals').get().n;
  assert.equal(approvals, 0, `vzniklo ${approvals} approvalů místo nuly — mýtné je zpátky`);
});

await test('citlivý zápis se ptá a bez odpovědi nic nevytvoří', async () => {
  clear();
  const target = path.join(workdir, '.env');
  const pending = writeUserFile({
    filePath: target, content: 'SECRET=1\n', runId: 'turn-policy-env',
    workspace, timeoutMs: 2_000,
  });

  // Ražba approvalu jde přes několik `await` (dynamický import `fs`, zámek,
  // čtení cíle), takže jedno kolo smyčky nestačí — čeká se, dokud řádek
  // nevznikne.
  let row = null;
  for (let attempt = 0; attempt < 400 && !row; attempt++) {
    row = db.prepare('SELECT id FROM mobile_approvals WHERE decided_at IS NULL').get() || null;
    if (!row) await yieldTick();
  }
  assert.ok(row, 'citlivý zápis se nezeptal');

  const result = await pending;
  assert.equal(result.written, false);
  assert.equal(result.asked, true);
  assert.equal(result.rule, 'secrets');
  assert.equal(existsSync(target), false);
});

await test('zápis do .git se odmítne bez ptaní', async () => {
  clear();
  const target = path.join(workdir, '.git', 'config');
  const result = await writeUserFile({
    filePath: target, content: 'x', runId: 'turn-policy-git', workspace,
  });
  assert.equal(result.state, 'refused_forbidden');
  assert.equal(result.rule, 'git-internals');
  assert.equal(existsSync(target), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mobile_approvals').get().n, 0,
    'na .git se někdo ptal, místo aby to odmítl');
});

await test('automatický zápis má pořád zámek a atomicitu, jen se neptá', async () => {
  clear();
  const target = path.join(workdir, 'bezny.txt');
  const result = await writeUserFile({
    filePath: target, content: 'obsah\n', runId: 'turn-policy-lock', workspace,
  });
  assert.equal(result.written, true);
  assert.equal(result.decidedBy, 'policy:auto');
  assert.equal(readFileSync(target, 'utf8'), 'obsah\n');
  // Zámek se po sobě uklidil.
  assert.equal(db.prepare(
    'SELECT COUNT(*) AS n FROM file_write_locks WHERE released_at IS NULL').get().n, 0);
  // A nezůstal dočasný soubor.
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(workdir).filter(n => n.includes('.intentsmith-')), []);
});

configureEffects({ db: null, producer: null });
db.close();
rmSync(runtimeDir, { recursive: true, force: true });

console.log(`\nPolitika zápisu: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
