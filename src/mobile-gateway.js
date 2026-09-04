#!/usr/bin/env node
// Mobile gateway process entrypoint — S-2.
// ==============================================================================
//
// Run with:  node src/mobile-gateway.js
//
// This process is deliberately *small*.  It opens the database, runs
// migrations, and serves /m1 — nothing else.  It does not import the chat
// pipeline, the specialist runtime, the tool registry, or anything else from
// the backend, because every module loaded into a network-facing process is
// code an attacker can try to reach.  Chat is delegated over loopback to the
// legacy server, which stays the single authority.
//
// Environment:
//   C3_MOBILE_HOST      bind host (default 127.0.0.1; non-loopback is refused
//                       unless C3_MOBILE_ALLOW_REMOTE is set — PLAN.md §8.1)
//   C3_MOBILE_PORT      bind port (default 3336; 0 = OS-assigned)
//   C3_URL              legacy server on loopback (default http://127.0.0.1:3335)
//   C3_MOBILE_PAIRING   'on' to permit pairing claims (default off, fail-closed)
//   C3_MOBILE_UI        'off' to disable serving the web client
//   C3_DB_PATH          database file
//
// ==============================================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMigrations } from './db/migrate.js';
import { startMobileGateway } from './mobile/gateway.js';
import { UpstreamClient } from './mobile/upstream.js';
import { OperationJournal } from './mobile/operation-journal.js';
import { purgePairingCodes } from './mobile/pairing.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function resolveDbPath() {
  if (process.env.C3_DB_PATH) return process.env.C3_DB_PATH;
  return path.join(REPO_ROOT, 'data', 'c3.db');
}

async function main() {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // The legacy server holds the same file; a short wait beats a spurious
  // SQLITE_BUSY on a concurrent write.
  db.pragma('busy_timeout = 5000');

  await runMigrations(db);

  const journal = new OperationJournal(db);
  const upstream = new UpstreamClient();

  const gateway = await startMobileGateway({
    rawDb: db,
    upstream,
    journal,
    logger: console,
  });

  // Machine-readable readiness line.  The test supervisor waits for this rather
  // than sleeping, which is what makes an OS-assigned port safe to read.
  console.log(`MOBILE_GATEWAY_LISTENING ${JSON.stringify({
    host: gateway.host,
    port: gateway.port,
    url: gateway.url,
    pairing: process.env.C3_MOBILE_PAIRING === 'on' ? 'enabled' : 'disabled',
  })}`);

  // Housekeeping.  Only *resolved* journal records and *unclaimed* pairing
  // codes are eligible — unresolved operations are never time-expired
  // (MD-19 §4.3).
  const housekeeping = setInterval(() => {
    try {
      journal.purgeResolved();
      purgePairingCodes(db);
    } catch (error) {
      console.error('[mobile-gateway] housekeeping failed:', error.message);
    }
  }, 10 * 60 * 1000);
  housekeeping.unref();

  const shutdown = async signal => {
    console.log(`[mobile-gateway] ${signal} — shutting down`);
    clearInterval(housekeeping);
    try { await gateway.stop(); } catch { /* already closing */ }
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });
}

main().catch(error => {
  console.error('[mobile-gateway] failed to start:', error.message);
  if (error.code) console.error(`[mobile-gateway] code: ${error.code}`);
  process.exit(1);
});
