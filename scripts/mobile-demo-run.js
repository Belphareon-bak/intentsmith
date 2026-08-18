#!/usr/bin/env node
// A run that asks the phone, and waits for the answer.
// ==============================================================================
//
// `mobile-seed-demo.js` fills the reading side: conversations, history, an
// operation journal.  It cannot fill the two screens the companion exists for,
// because those need something to *happen* — an approval to arrive while you
// are looking at the phone, and a run to move while you watch it.
//
// This is that something.  It behaves like the core would: it starts a run,
// works, reaches an effect it will not perform unsupervised, asks, and then
// **blocks on the answer**.  Approve on the phone and it writes the file it
// promised; reject and it does not; ignore it and the window closes and the run
// says so.
//
// It uses the production path and nothing else:
//
//   * the approval is minted by `createMobileApproval` through
//     `createCompanionProducer` — the same `DR-011` window, the same computed
//     fingerprint, the same mandatory binding;
//   * the notification goes through `createNotificationRouter`, so it passes
//     the same fail-closed `MobileChannel` boundary a real emitter passes;
//   * the decision is read from the row the phone's own
//     `POST /m1/approvals/:id/decide` wrote.
//
// Nothing about the demo is simulated except the work: there is no fake
// approval, no injected notification and no shortcut around the gateway.  That
// is the point — a demo that stubs the mechanism demonstrates the stub.
//
// ── Why the effect is real ─────────────────────────────────────────────────
//
// The run writes an actual file into a directory you name.  A demo whose
// "approved" branch only prints a line cannot tell you whether approving did
// anything, and the whole question the ★ use case asks is whether a tap on a
// phone reaches the machine.
//
//   node scripts/mobile-demo-run.js --db /tmp/is-demo.db
//   node scripts/mobile-demo-run.js --db /tmp/is-demo.db --origin remote --reject-demo
//
// ==============================================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '../src/db/migrate.js';
import { createCompanionProducer } from '../src/mobile/companion-producer.js';
import { createNotificationRouter } from '../src/notifications/index.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function parseArgs(argv) {
  const args = { db: null, origin: 'local', workdir: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--origin') args.origin = argv[++i];
    else if (argv[i] === '--workdir') args.workdir = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.db) {
  console.log(`
A demo run that asks the phone for one approval and waits for the answer.

  node scripts/mobile-demo-run.js --db /tmp/is-demo.db [--origin local|remote] [--workdir DIR]

  --db       the demo database the gateway is serving.  Required.
  --origin   local = 5 min window, remote = 15 min (DR-011).  Default local.
  --workdir  where the approved write lands.  Default: a fresh temp directory.

Run the gateway against the same database, pair a phone, then run this.
`);
  process.exit(args.help ? 0 : 1);
}

const target = path.resolve(args.db);
const live = path.join(REPO_ROOT, 'data', 'c3.db');
if (target === live) {
  console.error('Refusing to run against the live database at data/c3.db.');
  process.exit(1);
}
if (!fs.existsSync(target)) {
  console.error(`${target} does not exist. Seed it first:`);
  console.error('  node scripts/mobile-seed-demo.js --db ' + args.db);
  process.exit(1);
}
if (!['local', 'remote'].includes(args.origin)) {
  console.error(`--origin must be local or remote (DR-011 knows no third window).`);
  process.exit(1);
}

const workdir = args.workdir
  ? path.resolve(args.workdir)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'is-demo-run-'));
fs.mkdirSync(workdir, { recursive: true });

const db = new Database(target);
db.pragma('journal_mode = WAL');
await runMigrations(db);

const router = createNotificationRouter({ db });
const producer = createCompanionProducer({ rawDb: db, router });

const runId = `run-demo-${Date.now().toString(36)}`;
const conversationId = db.prepare(
  `SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1`,
).get()?.id || null;

// The effect the run will not perform unsupervised.  A path and its content are
// S2: they travel in the approval, which lives behind `read:approvals`, and
// never in the notification.
const filePath = path.join(workdir, 'ZAPSANO-PO-SCHVALENI.md');
const fileBody = [
  '# Tenhle soubor vznikl schválením z telefonu',
  '',
  `run: ${runId}`,
  `čas: ${new Date().toISOString()}`,
  '',
  'Kdyby se rozhodnutí neuskutečnilo, soubor by neexistoval.',
  '',
].join('\n');

function line(text) { console.log(`  ${text}`); }

console.log(`\nDemo běh ${runId}`);
line(`databáze: ${target}`);
line(`pracovní adresář: ${workdir}`);
line(`okno approvalu: ${args.origin} (${producer.ttl[args.origin] / 60000} min)\n`);

// ── The run ────────────────────────────────────────────────────────────────
//
// Progress is mirrored as `CoreEvent`s, which is what the core already emits to
// the Studio.  The connector maps them onto the S1 vocabulary; the phone sees
// that a run moved, never what it did.

const base = {
  contract: 'm1.core-event',
  version: 1,
  requestId: runId,
  conversationId: conversationId || runId,
  turnId: `${runId}-t1`,
};
let sequence = 0;

async function progress(eventType, payload = {}) {
  sequence += 1;
  await producer.projectCoreEvent({
    ...base, sequence, phase: 'progress', eventType, payload,
  });
  line(`→ ${eventType}`);
}

async function terminal(terminalStatus) {
  sequence += 1;
  await producer.projectCoreEvent({
    ...base, sequence, phase: 'terminal', eventType: 'result', terminalStatus, payload: {},
  });
  line(`■ ${terminalStatus}`);
}

await progress('started');
await progress('tool_call', { tool: 'fs.read' });

// ── The ask ────────────────────────────────────────────────────────────────

const approval = await producer.requestApproval({
  origin: args.origin,
  runId,
  operationRef: `fs.write:${filePath}`,
  subjectType: 'effect.write',
  subjectId: filePath,
  title: 'Zapsat soubor',
  detail: `${filePath}\n\n${fileBody.split('\n').slice(0, 3).join('\n')}…`,
  payload: { path: filePath, content: fileBody },
});

line(`? approval ${approval.id}`);
line(`  zrcadlo do schránky: ${approval.mirrored ? 'ano' : `ne (${approval.mirrorReason})`}`);
console.log(`\n  Rozhodni na telefonu. Běh čeká…\n`);

const answer = await producer.awaitDecision(approval.id, { pollMs: 1000 });

// ── The consequence ────────────────────────────────────────────────────────

switch (answer.state) {
  case 'approve': {
    // The write happens *after* the decision and because of it.  Doing it
    // earlier and reverting on rejection would make the approval decorative.
    fs.writeFileSync(filePath, fileBody, 'utf8');
    line(`✓ schváleno zařízením ${answer.decidedBy || '?'}`);
    line(`  zapsáno: ${filePath}`);
    await terminal('ok');
    break;
  }
  case 'reject':
    line(`✗ zamítnuto zařízením ${answer.decidedBy || '?'}`);
    line(`  soubor nevznikl: ${filePath}`);
    await terminal('cancelled');
    break;
  case 'expired':
    // Not an error and not a grant.  The run ends without the effect, and the
    // phone is told the window closed rather than left with a stale item.
    line('⌛ okno se zavřelo bez odpovědi');
    await producer.project('approval.expired', { approvalId: approval.id, runId });
    await terminal('cancelled');
    break;
  case 'missing':
    line('? approval z databáze zmizel');
    await terminal('unknown');
    break;
  default:
    line(`⌛ ${answer.state}`);
    await terminal('unknown');
}

console.log('');
db.close();
