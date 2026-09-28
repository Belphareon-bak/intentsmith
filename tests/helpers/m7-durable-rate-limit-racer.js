#!/usr/bin/env node

import { existsSync, writeFileSync } from 'node:fs';

import Database from 'better-sqlite3';

import { createM7DurableRateLimiter } from '../../src/remote/m7-durable-rate-limiter.js';
import { createM7TransportAdmissionPolicy } from '../../src/remote/m7-transport-admission-policy.js';

const [databasePath, readyPath, startPath] = process.argv.slice(2);
if (![databasePath, readyPath, startPath].every(value => typeof value === 'string' && value !== '')) {
  throw new Error('m7 rate-limit racer arguments missing');
}

const database = new Database(databasePath);
database.pragma('busy_timeout = 5000');
const policy = createM7TransportAdmissionPolicy({
  listener: {
    bindAddress: '192.168.50.10',
    port: 7443,
    serverIdentityPin: `sha256:${'a'.repeat(64)}`,
    serverOrigin: 'https://intentsmith.home.arpa:7443',
    tlsMaximumVersion: 'TLSv1.3',
    tlsMinimumVersion: 'TLSv1.3',
    trustProxy: false,
  },
  peerIdentityKey: Buffer.from('11'.repeat(32), 'hex'),
});
const admission = policy.admit({
  httpVersion: '1.1',
  method: 'POST',
  rawHeaders: [
    'Host', 'intentsmith.home.arpa:7443',
    'Content-Type', 'application/json',
    'Content-Length', '128',
  ],
  remoteAddress: '192.168.50.22',
  socketEncrypted: true,
  target: '/remote/v1/invoke',
  tlsVersion: 'TLSv1.3',
});
const plan = policy.createRateLimitPlan(admission, { operationKind: 'mutation' });
const limiter = createM7DurableRateLimiter(database, { clock: () => 1_800_000_000_000 });

writeFileSync(readyPath, 'ready\n', { flag: 'wx', mode: 0o600 });
const waitCell = new Int32Array(new SharedArrayBuffer(4));
while (!existsSync(startPath)) Atomics.wait(waitCell, 0, 0, 5);

let allowed = 0;
let denied = 0;
for (let attempt = 0; attempt < 10; attempt += 1) {
  if (limiter.consume(plan).allowed) allowed += 1;
  else denied += 1;
}
database.close();
process.stdout.write(`${JSON.stringify({ allowed, denied })}\n`);
