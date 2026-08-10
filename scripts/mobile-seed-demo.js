#!/usr/bin/env node
// Seed a throwaway database so the mobile client can be tried without a backend.
// ==============================================================================
//
// The gateway reads conversations straight out of SQLite and serves the PWA
// itself; the legacy backend is only needed to *send* a message.  So the app is
// testable on its own — except that a fresh database has nothing in it, and an
// empty app tells you nothing about whether the app works.
//
// This fills one in.  It writes to a database you name, never to the real one,
// because seeded rows in a live database are indistinguishable from real
// history the moment you forget they are there:
//
//   node scripts/mobile-seed-demo.js --db /tmp/is-demo.db
//   C3_DB_PATH=/tmp/is-demo.db C3_MOBILE_PAIRING=on node src/mobile-gateway.js
//   C3_DB_PATH=/tmp/is-demo.db node scripts/mobile-pair.js
//
// What it deliberately makes: one conversation long enough that MS-07 has to
// fetch several batches of 50 (MR-05), one short enough to arrive in a single
// batch, and one empty.  A demo where every conversation fits in one batch
// proves nothing about the part most likely to be broken.
//
// ==============================================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '../src/db/migrate.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function parseArgs(argv) {
  const args = { db: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.db) {
  console.log(`
Seed a demo database for the mobile client.

  node scripts/mobile-seed-demo.js --db /tmp/is-demo.db [--force]

  --db     where to write.  Required, and must not be the live database.
  --force  allow a database that already exists (rows are added, not replaced).
`);
  process.exit(args.help ? 0 : 1);
}

const target = path.resolve(args.db);
const live = path.join(REPO_ROOT, 'data', 'c3.db');
if (target === live) {
  console.error('Refusing to seed the live database at data/c3.db.');
  console.error('Demo rows there would be indistinguishable from real history.');
  process.exit(1);
}
if (fs.existsSync(target) && !args.force) {
  console.error(`${target} already exists. Pass --force to add rows to it anyway.`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
const db = new Database(target);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
await runMigrations(db);

// `message_count` is maintained by the `messages_count_ai` trigger from the
// baseline migration, so it is seeded at 0 and left alone.
const insertConversation = db.prepare(`
  INSERT INTO conversations (id, title, message_count, state, created_at, updated_at)
  VALUES (?, ?, 0, 'active', ?, ?)
`);
const insertMessage = db.prepare(`
  INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)
`);

const USER_LINES = [
  'Můžeš mi shrnout, co se změnilo v posledním commitu?',
  'A co ten test, co padal včera?',
  'Dej mi k tomu příklad.',
  'To zní rozumně. Pokračuj.',
  'Počkej, tohle nesedí — proč zrovna takhle?',
  'Dobře. A jak se to chová offline?',
];
const ASSISTANT_LINES = [
  'Změnily se tři soubory. Podstatná je jen změna v `handlers.js`: stránkování\nteď umí otevřít vlákno na nejnovější zprávě.',
  'Padal kvůli tomu, že seed nastavoval `message_count` ručně, zatímco ho\nudržuje databázový trigger. Číslo pak bylo dvojnásobné.',
  'Konkrétně:\n\n```js\nconst page = await api("/conversations/c1?anchor=latest&limit=50");\n```\n\nOdpověď nese `nextCursor`, kterým se čte dál do minulosti.',
  'Hotovo. Přidal jsem k tomu i test, který to ověřuje v prohlížeči.',
  'Máš pravdu, že to není samozřejmé. Offsetové stránkování obecně negarantuje,\nže se řádek nepřeskočí — tady to platí jen proto, že stream je append-only.',
  'Čte se z cache a okno má viditelnou hranici. Odeslat zprávu offline nejde\na aplikace to řekne rovnou, místo aby to zkusila a mlčela.',
];

function seed(id, title, count, ageDays) {
  const start = Date.UTC(2026, 7, 10 - ageDays, 9, 0, 0);
  const stamp = offsetMinutes => new Date(start + offsetMinutes * 60_000).toISOString();
  insertConversation.run(id, title, stamp(0), stamp(Math.max(count - 1, 0) * 3));
  for (let i = 0; i < count; i++) {
    const user = i % 2 === 0;
    const pool = user ? USER_LINES : ASSISTANT_LINES;
    const line = pool[Math.floor(i / 2) % pool.length];
    insertMessage.run(
      id,
      user ? 'user' : 'assistant',
      count > 20 && i < count - 12 ? `${line}\n\n(zpráva ${i + 1} z ${count})` : line,
      stamp(i * 3),
    );
  }
  return count;
}

const seeded = [
  ['demo-long', 'Dlouhá konverzace (stránkuje se)', seed('demo-long', 'Dlouhá konverzace (stránkuje se)', 240, 2)],
  ['demo-short', 'Krátká konverzace', seed('demo-short', 'Krátká konverzace', 8, 1)],
  ['demo-empty', 'Prázdná konverzace', seed('demo-empty', 'Prázdná konverzace', 0, 0)],
];

const total = db.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
db.close();

console.log(`\nSeeded ${target}`);
for (const [id, title, count] of seeded) {
  console.log(`  ${id.padEnd(12)} ${String(count).padStart(3)} zpráv  — ${title}`);
}
console.log(`  ${total} messages total\n`);
console.log('Next:');
console.log(`  C3_DB_PATH=${target} C3_MOBILE_PAIRING=on node src/mobile-gateway.js`);
console.log(`  C3_DB_PATH=${target} node scripts/mobile-pair.js\n`);
console.log('Reading works without the backend; sending a message needs it (PLAN.md §3).\n');
