#!/usr/bin/env node
// Issue a mobile pairing code — the desktop half of S-5 / DoD P1.
// ==============================================================================
//
// Run on the machine that owns the database, never from the phone:
//
//   node scripts/mobile-pair.js
//   node scripts/mobile-pair.js --url http://100.x.y.z:3336 --ttl 300
//
// It prints a QR containing a pairing URL.  The phone opens that URL, the
// client posts the embedded code to /m1/pair/claim, and the code is consumed.
//
// The code is shown exactly once and only its SHA-256 reaches the database, so
// re-running this script cannot recover a previous code — it can only issue a
// new one.  That is deliberate: a recoverable pairing code is a stored
// credential.
//
// ==============================================================================

import Database from 'better-sqlite3';
import QRCode from 'qrcode';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '../src/db/migrate.js';
import { createPairingCode, isPairingEnabled, PAIRABLE_SCOPES } from '../src/mobile/pairing.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function parseArgs(argv) {
  const opts = { ttlSeconds: 300, url: null, label: null, scopes: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--ttl') opts.ttlSeconds = Number.parseInt(next(), 10);
    else if (arg === '--url') opts.url = next();
    else if (arg === '--label') opts.label = next();
    else if (arg === '--scopes') opts.scopes = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/mobile-pair.js [options]

  --url <base>     Gateway URL the phone can reach (default http://127.0.0.1:3336)
  --ttl <seconds>  Code lifetime, 30-900 (default 300)
  --label <text>   Note stored with the code
  --scopes <list>  Comma-separated subset of:
                   ${PAIRABLE_SCOPES.join(', ')}
`);
      process.exit(0);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);

  // The kill switch is checked here too, so an operator who has pairing off
  // gets told immediately instead of discovering it when the phone fails.
  if (!isPairingEnabled()) {
    console.error('');
    console.error('  Pairing is disabled (fail-closed default).');
    console.error('  Start the gateway with C3_MOBILE_PAIRING=on to permit claims.');
    console.error('');
    process.exit(2);
  }

  const dbPath = process.env.C3_DB_PATH || path.join(REPO_ROOT, 'data', 'c3.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  await runMigrations(db);

  const baseUrl = (opts.url || process.env.C3_MOBILE_PUBLIC_URL || 'http://127.0.0.1:3336').replace(/\/$/, '');

  const issued = createPairingCode(db, {
    scopes: opts.scopes || undefined,
    label: opts.label,
    ttlMs: Math.max(30, Math.min(900, opts.ttlSeconds || 300)) * 1000,
  });

  const pairUrl = `${baseUrl}/#pair=${encodeURIComponent(issued.code)}`;
  const qr = await QRCode.toString(pairUrl, { type: 'terminal', small: true, errorCorrectionLevel: 'M' });

  console.log(qr);
  console.log(`  Pairing URL : ${pairUrl}`);
  console.log(`  Scopes      : ${issued.scopes.join(', ')}`);
  console.log(`  Expires     : ${issued.expiresAt}  (single use)`);
  console.log('');
  console.log('  Scan from the phone. The code is consumed on first claim;');
  console.log('  a second scan returns 409 pairing_already_used.');
  console.log('');

  db.close();
}

main().catch(error => {
  console.error('mobile-pair failed:', error.message);
  process.exit(1);
});
